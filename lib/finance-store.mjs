import {randomUUID,createHash} from 'node:crypto';
import {cleanWorkbook,newWorkbook} from './finance-core.mjs';
export function financeStore(db){
  db.exec(`CREATE TABLE IF NOT EXISTS workbooks(id TEXT PRIMARY KEY,data TEXT NOT NULL,version INTEGER NOT NULL,updated TEXT NOT NULL,original BLOB,original_name TEXT NOT NULL,original_hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS workbook_revisions(id TEXT PRIMARY KEY,workbook_id TEXT NOT NULL REFERENCES workbooks(id) ON DELETE CASCADE,data TEXT NOT NULL,label TEXT NOT NULL,created TEXT NOT NULL);`);
  const get=id=>{const row=db.prepare('SELECT id,data,version,updated,original_name,original_hash FROM workbooks WHERE id=?').get(id);if(!row)throw Object.assign(new Error('Workbook not found.'),{status:404});return {...JSON.parse(row.data),id:row.id,version:row.version,updated:row.updated,originalName:row.original_name,originalHash:row.original_hash};};
  const revision=(id,data,label)=>db.prepare('INSERT INTO workbook_revisions VALUES(?,?,?,?,?)').run(randomUUID(),id,JSON.stringify(data),label,new Date().toISOString());
  return {get,revision,
    list:()=>db.prepare("SELECT id,json_extract(data,'$.name') AS name,version,updated,original_name FROM workbooks ORDER BY updated DESC").all().map(r=>({id:r.id,name:r.name,version:r.version,updated:r.updated,originalName:r.original_name})),
    create(input=newWorkbook(),original=null,name='',{jobId,previewId}={}){
      const data=cleanWorkbook(input),id=randomUUID();db.exec('BEGIN');try{db.prepare('INSERT INTO workbooks VALUES(?,?,1,?,?,?,?)').run(id,JSON.stringify(data),new Date().toISOString(),original,name,original?createHash('sha256').update(original).digest('hex'):'');revision(id,data,original?'Imported workbook':'Created workbook');if(jobId){const marker=db.prepare("UPDATE background_jobs SET workbook_id=? WHERE id=? AND kind='workbook-import' AND status='running'").run(id,jobId);if(marker.changes!==1)throw new Error('Import job is no longer active.');}if(previewId){const marker=db.prepare("UPDATE import_previews SET workbook_id=?,committed=1,content=NULL,data='{}' WHERE id=? AND committed=0").run(id,previewId);if(marker.changes!==1)throw new Error('Import preview was already used.');}db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}return get(id);
    },
    save(id,input,{calculated=false,label=''}={}){
      const old=get(id);if(input.version!==old.version)throw Object.assign(new Error('Workbook changed in another tab. Reopen it before saving.'),{status:409});
      const data=cleanWorkbook(input,{results:calculated});if(!calculated)data.mapping.confirmed=false;
      // A separate confirmation action allows review without edits invalidating it.
      db.exec('BEGIN');try{db.prepare('UPDATE workbooks SET data=?,version=version+1,updated=? WHERE id=?').run(JSON.stringify(data),new Date().toISOString(),id);if(label)revision(id,data,label);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}return get(id);
    },
    confirm(id,version){const book=get(id);if(book.version!==version)throw Object.assign(new Error('Workbook changed. Reopen it before confirming.'),{status:409});book.mapping.confirmed=true;return this.save(id,book,{calculated:true,label:'Confirmed trial balance and mapping'});},
    history:id=>db.prepare('SELECT id,label,created FROM workbook_revisions WHERE workbook_id=? ORDER BY created DESC').all(id)
  };
}
