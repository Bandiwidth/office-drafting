import {createReadStream} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {localBackups} from './local-backups.mjs';
import {durableJobs} from './durable-jobs.mjs';
import {backgroundHandlers} from './background-handlers.mjs';
import {restoreRecords} from './restore-records.mjs';

function drained(res){return new Promise((resolve,reject)=>{const cleanup=()=>{res.off('drain',done);res.off('close',done);res.off('error',failed);},done=()=>{cleanup();resolve();},failed=error=>{cleanup();reject(error);};res.once('drain',done);res.once('close',done);res.once('error',failed);if(res.destroyed)done();});}

export function maintenance({store,finance,dataDir,referenceProcessor,documentConverter,financeProcessor,json,readJSON,bytesFrom,safeName,backupOptions}){
  const jobs=durableJobs(store.db,backgroundHandlers({store,finance,dataDir,referenceProcessor,documentConverter,financeProcessor,safeName})),backups=localBackups(store.db,dataDir,backupOptions);
  const tickets=new Map(),ticketPath=id=>'/api/local-backups/'+id+'/download';
  return {jobs,backups,start:()=>backups.start(),async close(){await Promise.all([jobs.close(),backups.close()]);},
    authorizeDownload(req,url){const key=url.searchParams.get('ticket'),ticket=tickets.get(key);if(req.method!=='GET'||!ticket||ticket.path!==url.pathname||ticket.expires<Date.now())return false;tickets.delete(key);return true;},
    async handle(req,res,path){
      const method=req.method;
      if(path==='/api/jobs'&&method==='GET'){json(res,200,jobs.list());return true;}
      if(path==='/api/jobs'&&method==='POST'){const input=await readJSON(req),payload=input.kind==='workbook-import'?bytesFrom(input):null;json(res,202,jobs.create(input.kind,input,payload));return true;}
      const jobMatch=/^\/api\/jobs\/([a-f0-9-]+)(?:\/(cancel|retry|download))?$/.exec(path);
      if(jobMatch){const [,id,action]=jobMatch;
        if(!action&&method==='GET'){json(res,200,jobs.get(id));return true;}
        if(!action&&method==='DELETE'){jobs.delete(id);json(res,200,{ok:true});return true;}
        if(action==='cancel'&&method==='POST'){json(res,200,jobs.cancel(id));return true;}
        if(action==='retry'&&method==='POST'){json(res,202,jobs.retry(id));return true;}
        if(action==='download'&&method==='GET'){const data=jobs.download(id);res.writeHead(200,{'Content-Type':data.mime,'Content-Disposition':`attachment; filename="${data.filename}"`,'Cache-Control':'no-store'});res.end(data.bytes);return true;}
      }
      if(path==='/api/local-backups'&&method==='GET'){json(res,200,backups.status());return true;}
      if(path==='/api/local-backups/import'&&method==='POST'){json(res,201,await backups.import(req));return true;}
      if(path==='/api/local-backups/settings'&&method==='PUT'){backups.settings(await readJSON(req,5000));json(res,200,backups.status());return true;}
      if(path==='/api/local-backups'&&method==='POST'){backups.create().catch(()=>{});json(res,202,backups.status());return true;}
      const backupMatch=/^\/api\/local-backups\/([a-f0-9-]+)(?:\/(verify|restore|download|download-ticket))?$/.exec(path);
      if(backupMatch){const [,id,action]=backupMatch;
        if(action==='verify'&&method==='POST'){json(res,200,await backups.verify(id));return true;}
        if(action==='download-ticket'&&method==='POST'){await backups.verify(id);for(const [key,ticket] of tickets)if(ticket.expires<Date.now())tickets.delete(key);if(tickets.size>=20)tickets.delete(tickets.keys().next().value);const key=randomBytes(32).toString('hex'),downloadPath=ticketPath(id);tickets.set(key,{path:downloadPath,expires:Date.now()+60000});json(res,200,{url:downloadPath+'?ticket='+key});return true;}
        if(action==='restore'&&method==='POST'){const result=await backups.restore(id,tables=>restoreRecords(store,finance,tables,{bytesFrom,safeName}));json(res,200,result);return true;}
        if(action==='download'&&method==='GET'){
          const release=backups.lease(id);try{await backups.verify(id);const stream=createReadStream(backups.path(id));res.on('close',()=>stream.destroy());res.writeHead(200,{'Content-Type':'application/vnd.sqlite3','Content-Disposition':`attachment; filename="office-snapshot-${id}.sqlite"`,'Cache-Control':'no-store'});
          for await(const chunk of stream){if(res.destroyed)break;if(!res.write(chunk))await drained(res);}res.end();return true;}finally{release();}
        }
        if(!action&&method==='DELETE'){backups.delete(id);json(res,200,{ok:true});return true;}
      }
      return false;
    }
  };
}
