import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {parentPort,workerData} from 'node:worker_threads';
let db;
try{
  const hash=createHash('sha256');for await(const chunk of createReadStream(workerData.path))hash.update(chunk);
  const checksum=hash.digest('hex');if(workerData.checksum&&checksum!==workerData.checksum)throw new Error('Backup checksum does not match. The snapshot may be damaged.');
  db=new DatabaseSync(workerData.path,{readOnly:true});db.exec('PRAGMA query_only=ON;');
  if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok'||db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('Backup database integrity check failed.');
  const counts={};for(const table of ['tasks','sources','templates','revisions','workbooks','workbook_revisions'])counts[table]=db.prepare('SELECT count(*) AS count FROM '+table).get().count;
  for(const table of ['pdf_sessions','pdf_versions','writing_items','office_glossary','office_templates','office_template_events','office_register','office_issues'])if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))counts[table]=db.prepare('SELECT count(*) AS count FROM '+table).get().count;
  // Exercise real records as well as SQLite pages; no task is executed.
  for(const table of ['tasks','workbooks']){const row=db.prepare('SELECT data FROM '+table+' LIMIT 1').get();if(row)JSON.parse(row.data);}
  db.close();db=null;parentPort.postMessage({result:{checksum,counts}});
}catch(error){parentPort.postMessage({error:error.message});}finally{db?.close();}
