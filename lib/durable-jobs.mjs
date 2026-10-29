import {randomUUID} from 'node:crypto';

export function durableJobs(db,handlers,{concurrency=2,capacity=12,clock=()=>Date.now()}={}){
  db.exec(`CREATE TABLE IF NOT EXISTS background_jobs(
    id TEXT PRIMARY KEY,kind TEXT NOT NULL,label TEXT NOT NULL,job_key TEXT NOT NULL,params TEXT NOT NULL,payload BLOB,
    task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,source_id TEXT REFERENCES sources(id) ON DELETE CASCADE,workbook_id TEXT REFERENCES workbooks(id) ON DELETE CASCADE,
    status TEXT NOT NULL,progress REAL NOT NULL,message TEXT NOT NULL,error TEXT NOT NULL,result TEXT,artifact BLOB,mime TEXT NOT NULL,filename TEXT NOT NULL,created TEXT NOT NULL,updated TEXT NOT NULL);
    CREATE UNIQUE INDEX IF NOT EXISTS active_background_key ON background_jobs(job_key) WHERE status IN ('queued','running');`);
  const now=()=>new Date(clock()).toISOString(),active=new Map();let closed=false,pumping=false;
  // An import and its ownership marker commit together. A crash after that commit
  // must not turn Retry into a second copy of the imported workbook.
  for(const row of db.prepare("SELECT j.id,j.workbook_id,w.version FROM background_jobs j JOIN workbooks w ON w.id=j.workbook_id WHERE j.kind='workbook-import' AND j.status IN ('queued','running','interrupted','failed')").all())db.prepare("UPDATE background_jobs SET status='completed',progress=1,message='Recovered completed import',error='',payload=NULL,result=?,updated=? WHERE id=?").run(JSON.stringify({workbookId:row.workbook_id,version:row.version}),now(),row.id);
  db.prepare("UPDATE background_jobs SET status='interrupted',message='The application stopped. Retry to restart this local operation.',updated=? WHERE status IN ('queued','running')").run(now());
  const raw=id=>db.prepare('SELECT * FROM background_jobs WHERE id=?').get(id),metadata='id,kind,label,status,progress,message,error,result,filename,created,updated,task_id,source_id,workbook_id,CASE WHEN artifact IS NOT NULL THEN zeroblob(1) END AS artifact';
  const present=row=>{if(!row)throw Object.assign(new Error('Job not found or its saved output has expired.'),{status:404});return {id:row.id,kind:row.kind,label:row.label,status:row.status,progress:row.progress,message:row.message,error:row.error,result:row.result?JSON.parse(row.result):null,filename:row.filename,created:row.created,updated:row.updated,taskId:row.task_id,sourceId:row.source_id,workbookId:row.workbook_id,hasDownload:!!row.artifact?.length};};
  const prune=()=>{
    const rows=db.prepare("SELECT id,updated FROM background_jobs WHERE status IN ('completed','failed','cancelled','interrupted') ORDER BY updated DESC,rowid DESC").all();
    for(let i=0;i<rows.length;i++)if(i>=50||clock()-Date.parse(rows[i].updated)>7*86400000)db.prepare('DELETE FROM background_jobs WHERE id=?').run(rows[i].id);
  };
  prune();
  const pump=()=>{
    if(closed||pumping)return;pumping=true;
    try{while(active.size<concurrency){
      const row=db.prepare("SELECT * FROM background_jobs WHERE status='queued' ORDER BY rowid LIMIT 1").get();if(!row)break;
      const controller=new AbortController();db.prepare("UPDATE background_jobs SET status='running',message='Starting local processing',updated=? WHERE id=?").run(now(),row.id);
      let progressAt=-Infinity,progressMessage='';const context={id:row.id,signal:controller.signal,
        guard(){controller.signal.throwIfAborted();if(closed||db.prepare('SELECT status FROM background_jobs WHERE id=?').get(row.id)?.status!=='running')throw new DOMException('Job is no longer active.','AbortError');},
        progress(value){if(closed||controller.signal.aborted)return;const message=String(value.status||value.message||'Working locally').slice(0,250),progress=Math.max(0,Math.min(1,Number(value.progress)||0));if(message===progressMessage&&clock()-progressAt<250&&progress<1)return;progressAt=clock();progressMessage=message;db.prepare("UPDATE background_jobs SET progress=?,message=?,updated=? WHERE id=? AND status='running'").run(progress,message,now(),row.id);}
      };
      const promise=Promise.resolve().then(()=>handlers[row.kind].run(JSON.parse(row.params),row.payload?Buffer.from(row.payload):null,context)).then(result=>{
        context.guard();const artifact=result?.artifact?Buffer.from(result.artifact):null;if(artifact?.length>32*1024*1024)throw new Error('Generated output exceeds the 32 MB saved-output limit.');const retained=db.prepare('SELECT coalesce(sum(coalesce(length(payload),0)+coalesce(length(artifact),0)),0) bytes FROM background_jobs WHERE id<>?').get(row.id).bytes;if(retained+(artifact?.length||0)>256*1024*1024)throw new Error('Saved job files reached 256 MB. Remove older jobs and retry this export.');
        db.prepare("UPDATE background_jobs SET status='completed',progress=1,message='Completed locally',error='',result=?,artifact=?,payload=NULL,mime=?,filename=?,workbook_id=coalesce(?,workbook_id),updated=? WHERE id=?").run(JSON.stringify(result?.value||{}),artifact,result?.mime||'',result?.filename||'',result?.workbookId||null,now(),row.id);
      }).catch(error=>{
        if(closed)return;const current=raw(row.id);if(!current||current.status!=='running')return;
        const cancelled=error.name==='AbortError';db.prepare('UPDATE background_jobs SET status=?,message=?,error=?,updated=? WHERE id=?').run(cancelled?'cancelled':'failed',cancelled?'Cancelled':'Local operation failed',cancelled?'':String(error.message||error).slice(0,700),now(),row.id);
      }).finally(()=>{active.delete(row.id);if(!closed){prune();pump();}});
      active.set(row.id,{controller,promise});
    }}finally{pumping=false;}
  };
  const api={
    get:id=>present(db.prepare('SELECT '+metadata+' FROM background_jobs WHERE id=?').get(id)),
    list:()=>{prune();return db.prepare('SELECT '+metadata+' FROM background_jobs ORDER BY rowid DESC LIMIT 100').all().map(present);},
    create(kind,input,payload=null){
      if(closed)throw new Error('The job service is closing.');if(!Object.hasOwn(handlers,kind))throw new Error('Unsupported background operation.');
      const prepared=handlers[kind].prepare(input,payload),existing=db.prepare("SELECT id FROM background_jobs WHERE job_key=? AND status IN ('queued','running')").get(prepared.key);if(existing)return api.get(existing.id);
      if(db.prepare("SELECT count(*) n FROM background_jobs WHERE status IN ('queued','running')").get().n>=capacity)throw Object.assign(new Error('Too many local jobs are waiting. Finish or cancel an existing job.'),{status:429});
      prune();const used=db.prepare('SELECT coalesce(sum(coalesce(length(payload),0)+coalesce(length(artifact),0)),0) bytes FROM background_jobs').get().bytes;if(used+(payload?.length||0)>256*1024*1024)throw new Error('Saved job files reached 256 MB. Remove older jobs in Jobs & backups.');
      const id=randomUUID();db.prepare("INSERT INTO background_jobs VALUES(?,?,?,?,?,?,?,?,?,'queued',0,'Waiting for local processing','',NULL,NULL,'','',?,?)").run(id,kind,String(prepared.label).slice(0,180),prepared.key,JSON.stringify(prepared.params),payload,prepared.taskId||null,prepared.sourceId||null,prepared.workbookId||null,now(),now());
      queueMicrotask(pump);return api.get(id);
    },
    cancel(id){const row=raw(id);present(row);if(['queued','running'].includes(row.status)){db.prepare("UPDATE background_jobs SET status='cancelled',message='Cancelled by you',payload=NULL,updated=? WHERE id=?").run(now(),id);active.get(id)?.controller.abort();queueMicrotask(pump);}return api.get(id);},
    retry(id){const row=raw(id);present(row);if(!['interrupted','failed'].includes(row.status))throw new Error('Only failed or interrupted local jobs can be retried.');return api.create(row.kind,JSON.parse(row.params),row.payload?Buffer.from(row.payload):null);},
    delete(id){present(raw(id));api.cancel(id);db.prepare('DELETE FROM background_jobs WHERE id=?').run(id);},
    cancelOwner(type,id){const key={task:'task_id',source:'source_id',workbook:'workbook_id'}[type];if(!key)return;for(const row of db.prepare("SELECT id FROM background_jobs WHERE "+key+"=? AND status IN ('queued','running')").all(id))api.cancel(row.id);},
    download(id){const row=raw(id);present(row);if(row.status!=='completed'||!row.artifact)throw new Error('This job has no completed file to download.');return {bytes:Buffer.from(row.artifact),mime:row.mime,filename:row.filename};},
    async close(){if(closed)return;closed=true;db.prepare("UPDATE background_jobs SET status='interrupted',message='The application stopped. Retry to restart this local operation.',updated=? WHERE status IN ('queued','running')").run(now());for(const value of active.values())value.controller.abort();await Promise.allSettled([...active.values()].map(value=>value.promise));}
  };return api;
}
