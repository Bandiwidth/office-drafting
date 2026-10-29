import {randomUUID,createHash} from 'node:crypto';
import {cleanTask} from './core.mjs';
import {validateTemplate} from './documents.mjs';
import {pdfSessions,pdfSessionLimits,validPdfContent,pdfHash} from './pdf-sessions.mjs';
import {writingStore,cleanWritingData} from './writing-core.mjs';
import {restoreOffice,officeBackupKeys} from './office-backup.mjs';

// The same atomic, additive restore is used for JSON downloads and local SQLite
// snapshots. Snapshot tables are iterated one row at a time, avoiding base64
// expansion of the complete collection in memory. Operational jobs are excluded.
export function restoreRecords(store,finance,tables,{bytesFrom,safeName}){
  const pdfStore=pdfSessions(store.db);writingStore(store.db);
  const ids=new Map(),templateIds=new Map(),sourceIds=new Map(),revisionIds=new Set();
  const validId=(id,seen)=>{if(typeof id!=='string'||!id||seen.has(id))throw new Error('Backup contains missing or duplicate record IDs.');};
  for(const source of tables.sources()){validId(source.id,sourceIds);sourceIds.set(source.id,randomUUID());}
  const remapFacts=data=>{for(const fact of Object.values(data.facts)){const oldId=fact.source.split(' | ')[0];if(sourceIds.has(oldId))fact.source=sourceIds.get(oldId)+fact.source.slice(oldId.length);}return data;};
  const bytes=value=>typeof value==='string'?bytesFrom({base64:value}):bytesFrom({base64:Buffer.from(value).toString('base64')});
  store.db.exec('BEGIN');
  try{
    for(const row of tables.templates()){
      validId(row.id,templateIds);const content=bytes(row.content);validateTemplate(content);const id=randomUUID();templateIds.set(row.id,id);store.db.prepare('INSERT INTO templates VALUES(?,?,?,?)').run(id,safeName(row.name),content,row.approved?1:0);
    }
    for(const row of tables.tasks()){
      validId(row.id,ids);const data=remapFacts(cleanTask(JSON.parse(row.data)));if(data.templateId&&!templateIds.has(data.templateId))throw new Error('Backup references a missing template.');data.templateId=templateIds.get(data.templateId)||'';
      const id=randomUUID();ids.set(row.id,id);store.db.prepare('INSERT INTO tasks VALUES(?,?,1,?)').run(id,JSON.stringify(data),new Date().toISOString());store.revision(id,data,'Restored from backup');
    }
    for(const row of tables.sources()){
      if(!ids.has(row.task_id))throw new Error('Backup has an orphan source.');if(!['.docx','.pdf','.png','.jpg','.jpeg','.txt'].includes(row.mime))throw new Error('Unsupported source type in backup.');
      const content=bytes(row.content);if(createHash('sha256').update(content).digest('hex')!==row.hash)throw new Error('Source checksum mismatch.');
      const extraction=JSON.parse(row.extraction);if(!extraction||typeof extraction!=='object'||!Array.isArray(extraction.blocks)||!Array.isArray(extraction.candidates))throw new Error('Invalid reference extraction in backup.');
      store.db.prepare('INSERT INTO sources VALUES(?,?,?,?,?,?,?)').run(sourceIds.get(row.id),ids.get(row.task_id),safeName(row.name),row.mime,row.hash,content,row.extraction);
    }
    for(const row of tables.revisions()){
      validId(row.id,revisionIds);revisionIds.add(row.id);if(!ids.has(row.task_id))throw new Error('Backup has an orphan revision.');const data=remapFacts(cleanTask(JSON.parse(row.data)));data.templateId=templateIds.get(data.templateId)||'';store.revision(ids.get(row.task_id),data,'Restored: '+String(row.label).slice(0,100));
    }
    let workbookIds=new Map();const workbooks=finance.restore({workbooks:tables.workbooks(),workbookRevisions:tables.workbookRevisions()},mapped=>workbookIds=mapped);
    const remapWorkbooks=data=>{for(const fact of Object.values(data.facts)){const match=/^Workbook ([a-f0-9-]+) \| v\d+/.exec(fact.source);if(match){fact.confirmed=false;if(workbookIds.has(match[1]))fact.source=fact.source.replace(match[0],'Workbook '+workbookIds.get(match[1])+' | v1');}}return data;};
    for(const id of ids.values()){const task=store.get(id);store.db.prepare('UPDATE tasks SET data=? WHERE id=?').run(JSON.stringify(remapWorkbooks(cleanTask(task))),id);for(const revision of store.db.prepare('SELECT id,data FROM revisions WHERE task_id=?').all(id))store.db.prepare('UPDATE revisions SET data=? WHERE id=?').run(JSON.stringify(remapWorkbooks(cleanTask(JSON.parse(revision.data)))),revision.id);}
    const writingIds=new Set();for(const row of tables.writingItems?.()||[]){validId(row.id,writingIds);writingIds.add(row.id);if(store.db.prepare('SELECT count(*) n FROM writing_items').get().n>=500)throw new Error('Writing library restore exceeds its 500-item limit.');const data=cleanWritingData(row.kind,JSON.parse(row.data));if(row.kind==='preset')data.templateId=templateIds.get(data.templateId)||'';if('reviewed' in data)data.reviewed=false;store.db.prepare('INSERT INTO writing_items VALUES(?,?,?,?,1,?)').run(randomUUID(),row.kind,String(row.name||'Restored item').slice(0,140),JSON.stringify(data),new Date().toISOString());}
    const pdfIds=new Map(),pdfHeads=new Map(),pdfCounts=new Map(),pdfRevisionIds=new Set();let pdfBytes=pdfStore.used();
    for(const row of tables.pdfSessions?.()||[]){validId(row.id,pdfIds);if(pdfStore.list().length>=pdfSessionLimits.sessions)throw new Error('PDF session restore exceeds the 50-session limit.');if(!Number.isSafeInteger(row.version)||row.version<1)throw new Error('Invalid PDF session version.');const original=validPdfContent(bytes(row.original));pdfBytes+=original.length;if(pdfBytes>pdfSessionLimits.total)throw new Error('PDF recovery restore exceeds its 256 MB limit.');const id=randomUUID();pdfIds.set(row.id,id);pdfHeads.set(row.id,row.version);store.db.prepare('INSERT INTO pdf_sessions VALUES(?,?,?,?,?,?)').run(id,safeName(row.name),row.version,new Date().toISOString(),new Date().toISOString(),original);}
    const heads=new Set();
    for(const row of tables.pdfVersions?.()||[]){validId(row.id,pdfRevisionIds);pdfRevisionIds.add(row.id);if(!pdfIds.has(row.session_id)||!Number.isSafeInteger(row.version)||row.version<1||row.version>pdfHeads.get(row.session_id))throw new Error('Invalid or orphan PDF version.');const count=(pdfCounts.get(row.session_id)||0)+1;pdfCounts.set(row.session_id,count);if(count>pdfSessionLimits.revisions)throw new Error('Too many saved PDF versions.');const content=validPdfContent(bytes(row.content));if(pdfHash(content)!==row.hash)throw new Error('PDF version checksum mismatch.');pdfBytes+=content.length;if(pdfBytes>pdfSessionLimits.total)throw new Error('PDF recovery restore exceeds its 256 MB limit.');store.db.prepare('INSERT INTO pdf_versions VALUES(?,?,?,?,?,?,?)').run(randomUUID(),pdfIds.get(row.session_id),row.version,String(row.label||'Restored').slice(0,100),new Date().toISOString(),row.hash,content);if(row.version===pdfHeads.get(row.session_id))heads.add(row.session_id);}
    if(heads.size!==pdfIds.size)throw new Error('Backup is missing a current PDF version.');
    const officeRecords=restoreOffice(store,tables,ids,templateIds);
    store.db.exec('COMMIT');
    return {officeRecords,documents:ids.size,workbooks,pdfSessions:pdfIds.size,writingItems:writingIds.size,message:`Restored ${ids.size} documents and ${workbooks} workbooks as new copies. PDF sessions: ${pdfIds.size}. Writing items: ${writingIds.size}. API keys were not included.`};
  }catch(error){store.db.exec('ROLLBACK');throw error;}
}
export function jsonRestoreTables(payload){
  if(payload.format!=='office-drafting-backup'||payload.version!==1)throw new Error('Unsupported backup format.');
  for(const key of ['tasks','sources','templates','revisions'])if(!Array.isArray(payload[key]))throw new Error('Incomplete backup.');
  for(const key of ['workbooks','workbookRevisions','pdfSessions','pdfVersions','writingItems',...officeBackupKeys])if(payload[key]!==undefined&&!Array.isArray(payload[key]))throw new Error('Invalid workbook, PDF or writing library backup.');
  return Object.fromEntries(['tasks','sources','templates','revisions','workbooks','workbookRevisions','pdfSessions','pdfVersions','writingItems',...officeBackupKeys].map(key=>[key,()=>payload[key]||[]]));
}
