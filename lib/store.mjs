import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { defaultSettings, newTask, cleanTask } from './core.mjs';
import { candidates } from './documents.mjs';
import {officeSchema} from './office-records.mjs';
export function openStore(dir) {
  mkdirSync(dir,{recursive:true}); const db = new DatabaseSync(join(dir,'office.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, data TEXT NOT NULL, version INTEGER NOT NULL, updated TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS revisions (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, data TEXT NOT NULL, label TEXT NOT NULL, created TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sources (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, name TEXT NOT NULL, mime TEXT NOT NULL, hash TEXT NOT NULL, content BLOB NOT NULL, extraction TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS templates (id TEXT PRIMARY KEY, name TEXT NOT NULL, content BLOB NOT NULL, approved INTEGER NOT NULL);
    PRAGMA user_version=1;`);
  officeSchema(db);
  const settings = () => ({...defaultSettings,...JSON.parse(db.prepare('SELECT data FROM settings WHERE id=1').get()?.data || '{}')});
  const get = id => { const row = db.prepare('SELECT * FROM tasks WHERE id=?').get(id); if (!row) throw Object.assign(new Error('Document not found.'),{status:404}); return {...JSON.parse(row.data),id:row.id,version:row.version,updated:row.updated}; };
  const revision = (id,data,label) => db.prepare('INSERT INTO revisions VALUES (?,?,?,?,?)').run(randomUUID(),id,JSON.stringify(data),label,new Date().toISOString());
  return {db, settings, get, revision,
    setSettings(data) { db.prepare('INSERT OR REPLACE INTO settings VALUES (1,?)').run(JSON.stringify(data)); },
    list() { return db.prepare('SELECT id,data,version,updated FROM tasks ORDER BY updated DESC').all().map(r=>({id:r.id,title:JSON.parse(r.data).title,type:JSON.parse(r.data).type,updated:r.updated})); },
    create() { const id=randomUUID(), t=newTask(settings()); db.prepare('INSERT INTO tasks VALUES (?,?,1,?)').run(id,JSON.stringify(t),new Date().toISOString()); revision(id,t,'Created'); return get(id); },
    save(id,input,label) { const old=get(id); if (input.version !== old.version) throw Object.assign(new Error('This document changed in another tab. Reopen it before editing.'),{status:409}); const t=cleanTask(input); db.exec('BEGIN'); try { db.prepare('UPDATE tasks SET data=?,version=version+1,updated=? WHERE id=?').run(JSON.stringify(t),new Date().toISOString(),id); if(label) revision(id,t,label); db.exec('COMMIT'); } catch(e){db.exec('ROLLBACK');throw e;} return get(id); },
    sources(id) { return db.prepare('SELECT id,name,mime,hash,extraction FROM sources WHERE task_id=?').all(id).map(s=>{const extraction=JSON.parse(s.extraction);return {...s,...extraction,candidates:candidates(extraction.blocks||[]),extraction:undefined};}); },
    deleteSource(taskId,sourceId) {
      const task=get(taskId);task.reviewed=false;
      for(const fact of Object.values(task.facts))if(fact.source.startsWith(sourceId+' | ')){fact.confirmed=false;fact.source='Deleted source · '+fact.source;}
      const data=cleanTask(task);db.exec('BEGIN');
      try{db.prepare('DELETE FROM sources WHERE id=? AND task_id=?').run(sourceId,taskId);db.prepare('UPDATE tasks SET data=?,version=version+1,updated=? WHERE id=?').run(JSON.stringify(data),new Date().toISOString(),taskId);revision(taskId,data,'Deleted reference');db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
    },
    updateExtraction(taskId,sourceId,extraction){
      const task=get(taskId),data=cleanTask(task);let linked=false;
      for(const fact of Object.values(data.facts))if(fact.source.startsWith(sourceId+' | ')){fact.confirmed=false;linked=true;}
      db.exec('BEGIN');try{const result=db.prepare('UPDATE sources SET extraction=? WHERE id=? AND task_id=?').run(JSON.stringify(extraction),sourceId,taskId);if(!result.changes)throw new Error('The reference was deleted while processing.');if(linked){data.reviewed=false;db.prepare('UPDATE tasks SET data=?,version=version+1,updated=? WHERE id=?').run(JSON.stringify(data),new Date().toISOString(),taskId);revision(taskId,data,'Reprocessed reference · verify linked facts');}db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
    },
    templates() { return db.prepare("SELECT t.id,t.name,t.approved,coalesce(m.number,1) number,coalesce(m.status,CASE WHEN t.approved=1 THEN 'approved' ELSE 'draft' END) status,m.family FROM templates t LEFT JOIN office_templates m ON m.id=t.id").all().map(t=>({...t,approved:!!t.approved})); }
  };
}
