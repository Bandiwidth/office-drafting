import {backup,DatabaseSync} from 'node:sqlite';
import {mkdirSync,existsSync,lstatSync,renameSync,unlinkSync,statfsSync,createWriteStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {Readable} from 'node:stream';
import {join,resolve,dirname} from 'node:path';
import {Worker} from 'node:worker_threads';
import {randomUUID} from 'node:crypto';

export function verifySnapshot(path,checksum,{timeout=120000}={}){
  return new Promise((resolveJob,reject)=>{
    let worker,settled=false;const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);Promise.resolve(worker?.terminate()).catch(()=>{}).then(()=>error?reject(error):resolveJob(value));};
    const timer=setTimeout(()=>finish(new Error('Backup verification timed out. Existing verified snapshots were kept.')),timeout);
    try{worker=new Worker(new URL('./snapshot-worker.mjs',import.meta.url),{workerData:{path,checksum},resourceLimits:{maxOldGenerationSizeMb:128}});worker.on('message',m=>finish(m.error?new Error(m.error):null,m.result));worker.on('error',()=>finish(new Error('Backup verification could not finish.')));worker.on('exit',()=>{if(!settled)finish(new Error('Backup verification stopped early.'));});}catch(error){finish(error);}
  });
}
export function localBackups(db,dataDir,{clock=()=>Date.now(),verifier=verifySnapshot,backupEngine=backup}={}){
  const folder=resolve(dataDir,'backups');mkdirSync(folder,{recursive:true});if(lstatSync(folder).isSymbolicLink())throw new Error('The managed backup folder must not be a symbolic link.');
  db.exec(`CREATE TABLE IF NOT EXISTS backup_settings(id INTEGER PRIMARY KEY CHECK(id=1),data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS local_backups(id TEXT PRIMARY KEY,created TEXT NOT NULL,status TEXT NOT NULL,checksum TEXT NOT NULL,bytes INTEGER NOT NULL,error TEXT NOT NULL,verified TEXT NOT NULL,counts TEXT NOT NULL);`);
  const defaults={enabled:true,intervalHours:24,keep:7,budgetMB:2048},leases=new Map(),pending=new Set();let active=null,timer=null,closed=false;
  const config=()=>({...defaults,...JSON.parse(db.prepare('SELECT data FROM backup_settings WHERE id=1').get()?.data||'{}')});
  const file=(id,partial=false)=>{if(!/^[a-f0-9]{8}-[a-f0-9-]{27}$/.test(id))throw new Error('Invalid backup ID.');const path=join(folder,id+'.sqlite'+(partial?'.partial':''));if(dirname(path)!==folder||existsSync(path)&&lstatSync(path).isSymbolicLink())throw new Error('Unsafe managed backup path.');return path;};
  const remove=id=>{for(const partial of [false,true]){const path=file(id,partial);if(existsSync(path))unlinkSync(path);}};
  for(const row of db.prepare("SELECT id FROM local_backups WHERE status='creating'").all()){remove(row.id);db.prepare("UPDATE local_backups SET status='failed',error='The app stopped before this backup was verified.' WHERE id=?").run(row.id);}
  const get=id=>{const row=db.prepare('SELECT * FROM local_backups WHERE id=?').get(id);if(!row)throw Object.assign(new Error('Local backup not found.'),{status:404});return {...row,counts:JSON.parse(row.counts)};};
  const list=()=>db.prepare('SELECT * FROM local_backups ORDER BY created DESC,id DESC').all().map(row=>({...row,counts:JSON.parse(row.counts)}));
  const prune=newest=>{
    const settings=config(),rows=list().filter(row=>row.status==='ready').sort((a,b)=>a.id===newest?-1:b.id===newest?1:0);let total=0;
    for(let i=0;i<rows.length;i++){const row=rows[i];if(i>0&&!leases.has(row.id)&&(i>=settings.keep||total+row.bytes>settings.budgetMB*1024*1024)){remove(row.id);db.prepare('DELETE FROM local_backups WHERE id=?').run(row.id);}else total+=row.bytes;}
    const failed=list().filter(row=>row.status==='failed');for(let i=0;i<failed.length;i++){const row=failed[i];if(leases.has(row.id))continue;remove(row.id);if(i>=20)db.prepare('DELETE FROM local_backups WHERE id=?').run(row.id);}
  };
  const api={folder,config,list,get,
    settings(input){if(typeof input.enabled!=='boolean'||!Number.isInteger(input.intervalHours)||input.intervalHours<1||input.intervalHours>168||!Number.isInteger(input.keep)||input.keep<1||input.keep>30||!Number.isInteger(input.budgetMB)||input.budgetMB<64||input.budgetMB>16384)throw new Error('Choose a 1–168 hour interval, 1–30 copies and a 64–16,384 MB budget.');const value={enabled:input.enabled,intervalHours:input.intervalHours,keep:input.keep,budgetMB:input.budgetMB};db.prepare('INSERT OR REPLACE INTO backup_settings VALUES(1,?)').run(JSON.stringify(value));return value;},
    status(){return {settings:config(),active:active?.id||null,progress:active?.progress||'',folder,backups:list()};},
    import(readable){return api.create({from:readable});},
    create({from}={}){
      if(closed)throw new Error('Backup service is closing.');if(active){if(from)throw Object.assign(new Error('Wait for the current backup operation to finish.'),{status:409});return active.promise;}
      const id=randomUUID(),created=new Date(clock()).toISOString(),settings=config();
      db.prepare("INSERT INTO local_backups VALUES(?,?,'creating','',0,'','','{}')").run(id,created);
      const current=active={id,progress:'Creating a consistent local snapshot',promise:null};
      current.promise=(async()=>{
        try{
          const size=db.prepare('PRAGMA page_count').get().page_count*db.prepare('PRAGMA page_size').get().page_size;
          if(!from&&size>settings.budgetMB*1024*1024)throw new Error('The database exceeds the local backup budget. Increase the budget in Jobs & backups.');
          const free=statfsSync(folder);if(Number(free.bavail)*Number(free.bsize)<size+64*1024*1024)throw new Error('Not enough free disk space for a new snapshot. Existing backups were kept.');
          if(from){current.progress='Reading the uploaded recovery snapshot';let received=0;const limit=settings.budgetMB*1024*1024;const bounded=async function*(){for await(const chunk of from){received+=chunk.length;if(received>limit)throw new Error('Snapshot exceeds the configured backup budget.');yield chunk;}if(!received)throw new Error('Choose a non-empty SQLite recovery snapshot.');};await pipeline(Readable.from(bounded()),createWriteStream(file(id,true),{flags:'wx'}));}
          else await backupEngine(db,file(id,true),{rate:64});current.progress='Checking snapshot checksum, records and database integrity';
          const verified=await verifier(file(id,true));renameSync(file(id,true),file(id));const bytes=lstatSync(file(id)).size;
          db.prepare("UPDATE local_backups SET status='ready',checksum=?,bytes=?,verified=?,counts=? WHERE id=?").run(verified.checksum,bytes,new Date(clock()).toISOString(),JSON.stringify(verified.counts),id);
          prune(id);return get(id);
        }catch(error){remove(id);db.prepare("UPDATE local_backups SET status='failed',error=? WHERE id=?").run(String(error.message||error).slice(0,600),id);throw error;}
        finally{if(active===current)active=null;}
      })();return current.promise;
    },
    lease(id){if(closed)throw new Error('Backup service is closing.');get(id);leases.set(id,(leases.get(id)||0)+1);let released=false;return ()=>{if(released)return;released=true;const count=leases.get(id)-1;if(count)leases.set(id,count);else leases.delete(id);};},
    verify(id){const release=api.lease(id),row=get(id);if(row.status!=='ready'){release();throw new Error('This snapshot did not complete. Create a new backup.');}const promise=(async()=>{try{const result=await verifier(file(id),row.checksum);db.prepare('UPDATE local_backups SET verified=?,counts=? WHERE id=?').run(new Date(clock()).toISOString(),JSON.stringify(result.counts),id);return get(id);}catch(error){db.prepare("UPDATE local_backups SET status='failed',error=? WHERE id=?").run(String(error.message||error).slice(0,600),id);throw error;}finally{release();}})();pending.add(promise);promise.then(()=>pending.delete(promise),()=>pending.delete(promise));return promise;},
    path(id){const row=get(id);if(row.status!=='ready')throw new Error('Only a verified snapshot can be downloaded.');return file(id);},
    async restore(id,restoreFn){const release=api.lease(id);let snapshot;try{await api.verify(id);snapshot=new DatabaseSync(file(id),{readOnly:true});const select=table=>()=>snapshot.prepare('SELECT * FROM '+table).iterate(),optional=table=>()=>snapshot.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)?select(table)():[];return restoreFn({tasks:select('tasks'),sources:select('sources'),templates:select('templates'),revisions:select('revisions'),workbooks:select('workbooks'),workbookRevisions:select('workbook_revisions'),pdfSessions:optional('pdf_sessions'),pdfVersions:optional('pdf_versions'),writingItems:optional('writing_items'),officeGlossary:optional('office_glossary'),officeTemplates:optional('office_templates'),officeTemplateEvents:optional('office_template_events'),officeRegister:optional('office_register'),officeIssues:optional('office_issues')});}finally{snapshot?.close();release();}},
    delete(id){if(active?.id===id||leases.has(id))throw new Error('Wait for backup creation, verification or download to finish.');get(id);remove(id);db.prepare('DELETE FROM local_backups WHERE id=?').run(id);},
    async tick(){if(closed||active||!config().enabled)return;const latest=db.prepare('SELECT created FROM local_backups ORDER BY created DESC LIMIT 1').get();if(!latest||clock()-Date.parse(latest.created)>=config().intervalHours*3600000)await api.create();},
    start(){if(timer)return;timer=setInterval(()=>api.tick().catch(()=>{}),60000);timer.unref();api.tick().catch(()=>{});},
    async close(){closed=true;clearInterval(timer);if(active)await active.promise.catch(()=>{});await Promise.allSettled([...pending]);}
  };return api;
}
