import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {uptime} from 'node:os';

// Coordinate CLI services before initializing recovery. SQLite serializes the
// owner check/update, including simultaneous launches after an abrupt exit.
export function runtimeLock(dataDir){
  mkdirSync(dataDir,{recursive:true});const db=new DatabaseSync(join(dataDir,'runtime.sqlite')),token=randomUUID(),boot=Date.now()-uptime()*1000;let released=false;
  try{
    db.exec('PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS owner(id INTEGER PRIMARY KEY CHECK(id=1),pid INTEGER NOT NULL,boot REAL NOT NULL,token TEXT NOT NULL); BEGIN IMMEDIATE;');
    const previous=db.prepare('SELECT * FROM owner WHERE id=1').get();let alive=false;
    // A wall-clock correction must never allow a live owner's lock to be stolen.
    if(previous){try{process.kill(previous.pid,0);alive=true;}catch(error){if(error.code!=='ESRCH')alive=true;}}
    if(alive)throw new Error('Office Drafting is already using this data folder (process '+previous.pid+'). Stop the existing service with Ctrl+C in its terminal before starting another service.');
    db.prepare('INSERT OR REPLACE INTO owner VALUES(1,?,?,?)').run(process.pid,boot,token);db.exec('COMMIT');
  }catch(error){try{db.exec('ROLLBACK');}catch{}db.close();throw error;}
  return ()=>{if(released)return;released=true;try{db.prepare('DELETE FROM owner WHERE id=1 AND token=?').run(token);}finally{db.close();}};
}
