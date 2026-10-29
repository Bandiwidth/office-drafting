import http from 'node:http';
import { readFileSync, mkdirSync, existsSync, writeFileSync, renameSync, realpathSync } from 'node:fs';
import { resolve, join, extname } from 'node:path';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { openStore } from './lib/store.mjs';
import { fields, types, draft, validate, cleanTask, writingGuidance, instructionContext } from './lib/core.mjs';
import { makeDocx, extractDocx, validateTemplate, candidates } from './lib/documents.mjs';
import { cleanSettings, credential, credentialSlot, assist, testProvider } from './lib/providers.mjs';
import { wordJob, capabilities } from './lib/worker.mjs';
import {openSourceStatus,vendorFiles} from './lib/open-source.mjs';
import {codeFingerprint} from './lib/build.mjs';
import {referenceJob,referenceStatus} from './lib/references.mjs';
import {referenceOptions,referenceEngine,referenceLimits,imageDimensions} from './lib/reference-core.mjs';
import {financeRoutes} from './lib/finance-routes.mjs';
import {financeJob} from './lib/finance.mjs';
import {maintenance as createMaintenance} from './lib/maintenance.mjs';
import {restoreRecords,jsonRestoreTables} from './lib/restore-records.mjs';
import {runtimeLock} from './lib/runtime-lock.mjs';
import {diagnostics} from './lib/diagnostics.mjs';
import {taskDiff} from './lib/revision-diff.mjs';
import {pdfWorkspaceStatus,pdfStaticAsset} from './lib/pdf-workspace.mjs';
import {installPdfcraft,pdfcraftInstallError} from './scripts/install-pdfcraft.mjs';
import {pdfSessions} from './lib/pdf-sessions.mjs';
import {writingRoutes} from './lib/writing-routes.mjs';
import {officeRoutes} from './lib/office-routes.mjs';
import {officeBackup,officeEstimate} from './lib/office-backup.mjs';

const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
async function readJSON(req,limit=18*1024*1024) { let size=0;const chunks=[];for await(const c of req){size+=c.length;if(size>limit)throw Object.assign(new Error('Request exceeds this operation’s '+Math.ceil(limit/1024)+' KB limit.'),{status:413});chunks.push(c);}let value;try{value=JSON.parse(Buffer.concat(chunks).toString());}catch{throw new Error('Invalid JSON request.');}if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Request must be a JSON object.');return value; }
function bytesFrom(input){if(typeof input.base64!=='string'||!/^[A-Za-z0-9+/]*={0,2}$/.test(input.base64))throw new Error('Invalid upload.');const b=Buffer.from(input.base64,'base64');if(b.toString('base64').replace(/=+$/,'')!==input.base64.replace(/=+$/,''))throw new Error('Invalid upload encoding.');if(!b.length||b.length>12*1024*1024)throw new Error('Files must be between 1 byte and 12 MB.');return b;}
function safeName(name){return String(name||'document').split(/[\\/]/).pop().replace(/[\x00-\x1f]/g,'').slice(0,180);}
export function createApp({dataDir=resolve('data'),referenceProcessor=referenceJob,aiAssistant=assist,documentConverter=wordJob,financeProcessor=financeJob,pdfInstaller=installPdfcraft,backupOptions}={}) {
  mkdirSync(dataDir,{recursive:true});const store=openStore(dataDir),token=randomBytes(32).toString('hex'),buildFingerprint=codeFingerprint(),storageId=createHash('sha256').update(realpathSync(dataDir).toLowerCase()).digest('hex');
  const pdfRecovery=pdfSessions(store.db);
  const finance=financeRoutes(store.db,{json,readJSON,bytesFrom,safeName,processor:financeProcessor,onDelete:id=>maintenance.jobs.cancelOwner('workbook',id)});
  const maintenance=createMaintenance({store,finance,dataDir,referenceProcessor,documentConverter,financeProcessor,json,readJSON,bytesFrom,safeName,backupOptions});
  const templateFor=t=>t.templateId?store.db.prepare('SELECT * FROM templates WHERE id=?').get(t.templateId):null;
  const writing=writingRoutes(store,finance.store,{json,readJSON,referenceProcessor});
  const office=officeRoutes(store,finance,{json,readJSON,bytesFrom,safeName,referenceProcessor,check:writing.check});
  const responseTask=t=>({...t,issued:office.locked(t.id),writingGuidance:writingGuidance(t),issues:writing.check(t)});
  const referenceJobs=new Map();
  let activeAI=null;
  let pdfInstall={status:'idle',detail:''},pdfInstallPromise=null;
  const server=http.createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; frame-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    const address=server.address(), origin=`http://127.0.0.1:${address.port}`;
    if(req.headers.host!==`127.0.0.1:${address.port}`&&req.headers.host!==`localhost:${address.port}`)return json(res,403,{error:'Invalid local host.'});
    // Parse the untrusted request target inside a guard. An exception escaping
    // this async listener becomes an unhandled rejection and can stop Node.
    let url;
    try{
      if(typeof req.url!=='string'||!req.url.startsWith('/')||req.url.startsWith('//')||req.url.includes('\\'))throw new Error('Invalid request target.');
      url=new URL(req.url,origin);
      if(url.origin!==origin)throw new Error('Foreign request target.');
    }catch{return json(res,400,{error:'Invalid local request URL.'});}
    // These immutable public assets have no workspace data or API privileges.
    const publicPath=url.pathname;
    if(publicPath.startsWith('/pdfcraft/')&&req.method==='GET'){
      try{
      const asset=pdfStaticAsset(publicPath);if(!asset)return json(res,404,{error:'The bundled PDF editor is unavailable. Stop the app, run npm ci --ignore-scripts and npm run setup in the project folder, then npm start.'});
      res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('X-Frame-Options','SAMEORIGIN');
      const assetOrigin='http://'+req.headers.host;
      res.setHeader('Content-Security-Policy',`default-src 'none'; script-src ${assetOrigin} 'unsafe-inline' 'wasm-unsafe-eval' blob:; style-src ${assetOrigin} 'unsafe-inline'; img-src ${assetOrigin} data: blob:; font-src ${assetOrigin} data: blob:; connect-src ${assetOrigin}; worker-src ${assetOrigin} blob:; frame-ancestors 'self'; base-uri 'none'; form-action 'none'`);
      res.writeHead(200,{'Content-Type':asset.type,'Cache-Control':'no-cache'});return res.end(asset.body);
      }catch{return json(res,500,{error:'The local PDF editor component could not be read. Retry or reinstall it.'});}
    }
    if(req.headers.origin&&!['http://'+req.headers.host,origin].includes(req.headers.origin))return json(res,403,{error:'Cross-origin requests are blocked.'});
    if(req.headers['sec-fetch-site']==='cross-site')return json(res,403,{error:'Cross-site requests are blocked.'});
    const p=url.pathname;
    try {
      if(!p.startsWith('/api/')) {
        if(req.method==='GET'&&['/body-format.js','/translation.js'].includes(p)){res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-cache'});return res.end(readFileSync(resolve(p==='/translation.js'?'lib/translation.mjs':'lib/body-format.mjs')));}
        if(req.method==='GET'&&p.startsWith('/vendor/pdfjs/')){const asset=pdfStaticAsset(p);if(!asset)return json(res,404,{error:'PDF component is unavailable.'});res.writeHead(200,{'Content-Type':asset.type,'Cache-Control':'no-cache'});return res.end(asset.body);}
        if(req.method==='GET'&&vendorFiles[p]){
          if(!existsSync(vendorFiles[p]))return json(res,404,{error:'The bundled document component is missing. Stop the app, run npm ci --ignore-scripts and npm run setup in the project folder, then npm start.'});
          res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-cache'});return res.end(readFileSync(vendorFiles[p]));
        }
        const paths={'/document-print':'document-print.html','/document-print.js':'document-print.js','/document-print.css':'document-print.css','/guide':'guide.html','/guide.js':'guide.js','/guide.css':'guide.css','/office':'office.html','/office.js':'office.js','/office.css':'office.css','/writing-tools.js':'writing-tools.js','/writing-tools.html':'writing-tools.html','/writing-tools.css':'writing-tools.css','/pdf':'pdf.html','/pdf.js':'pdf.js','/pdf-recovery.js':'pdf-recovery.js','/pdf.css':'pdf.css','/diagnostics':'diagnostics.html','/diagnostics.js':'diagnostics.js','/':'index.html','/app.js':'app.js','/style.css':'style.css','/updates.css':'updates.css','/docx-frame.html':'docx-frame.html','/docx-frame.js':'docx-frame.js','/finance':'finance.html','/finance.js':'finance.js','/finance.css':'finance.css','/activity':'activity.html','/activity.js':'activity.js','/activity.css':'activity.css','/jobs-client.js':'jobs-client.js'};
        if(req.method!=='GET'||!paths[p])return json(res,404,{error:'Not found.'});
        if(p==='/docx-frame.html'||p==='/document-print'){
          // Template CSS requires inline styles. Keep this exception inside a
          // sandboxed renderer with no external resource or connection access.
          res.setHeader('Content-Security-Policy',`default-src 'none'; script-src http://${req.headers.host}; style-src http://${req.headers.host} 'unsafe-inline'; img-src data: blob:; font-src data: blob:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'`);
          res.setHeader('X-Frame-Options','SAMEORIGIN');
        }
        if(p==='/pdf')res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data: blob:; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
        const file=paths[p];res.writeHead(200,{'Content-Type':file.endsWith('html')?'text/html; charset=utf-8':file.endsWith('js')?'text/javascript; charset=utf-8':'text/css; charset=utf-8','Cache-Control':'no-cache'});res.end(readFileSync(resolve('public',file)));return;
      }
      if(p==='/api/health'&&req.method==='GET')return json(res,200,{service:'Office Drafting',status:'ready',buildFingerprint,storageId,pid:process.pid});
      if(p==='/api/bootstrap'&&req.method==='GET') {
        const settings=store.settings(),references=referenceStatus();return json(res,200,{build:'source-v1',buildFingerprint,token,settings,keySaved:await credential(dataDir,'has',credentialSlot(settings)),tasks:store.list(),templates:store.templates(),fields,types,capabilities:{...capabilities(),backgroundJobs:true,guidedImport:true,localSnapshots:true,ocr:references.ocr,referenceProcessing:references,openSource:openSourceStatus()}});
      }
      if(req.headers['x-session-token']!==token&&!maintenance.authorizeDownload(req,url))return json(res,403,{error:'Session expired. Refresh the page.'});
      const method=req.method;
      if(p.startsWith('/api/office/')&&await office.handle(req,res,p))return;
      if(p.startsWith('/api/writing/')&&await writing.handle(req,res,p))return;
      if(p==='/api/pdf/status'&&method==='GET')return json(res,200,pdfWorkspaceStatus());
      if(p==='/api/pdf/sessions'&&method==='GET')return json(res,200,pdfRecovery.list());
      if(p==='/api/pdf/sessions'&&method==='POST'){const input=await readJSON(req);return json(res,201,pdfRecovery.create(input.name,bytesFrom(input)));}
      const pdfMatch=p.match(/^\/api\/pdf\/sessions\/([a-f0-9-]+)(?:\/(versions|content|restore))?$/);
      if(pdfMatch){const [,id,action]=pdfMatch;
        if(!action&&method==='GET')return json(res,200,{session:pdfRecovery.get(id),versions:pdfRecovery.versions(id)});
        if(!action&&method==='PUT'){const input=await readJSON(req);return json(res,200,pdfRecovery.save(id,input.version,bytesFrom(input),input.checkpoint?'Saved checkpoint':'Autosave'));}
        if(!action&&method==='DELETE'){pdfRecovery.delete(id);return json(res,200,{ok:true});}
        if(action==='content'&&method==='GET'){const raw=url.searchParams.get('version'),version=raw==='original'?'original':raw===null?undefined:Number(raw);if(version!==undefined&&version!=='original'&&(!Number.isSafeInteger(version)||version<1))throw new Error('Invalid PDF version.');const bytes=pdfRecovery.content(id,version);res.writeHead(200,{'Content-Type':'application/pdf','Cache-Control':'no-store'});return res.end(bytes);}
        if(action==='restore'&&method==='POST'){const input=await readJSON(req,2000);return json(res,200,pdfRecovery.restore(id,input.version,input.restoreVersion));}
      }
      if(p==='/api/pdf/install'&&method==='GET')return json(res,200,pdfInstall);
      if(p==='/api/pdf/install'&&method==='POST'){
        if(!pdfWorkspaceStatus().allowInstall)return json(res,409,{error:'PdfCraft is bundled with this application. Stop the service and follow the setup instructions for that packaged release.'});
        if(!pdfInstallPromise){pdfInstall={status:'running',detail:'Downloading the pinned PdfCraft release. One-time internet access is required.'};pdfInstallPromise=Promise.resolve().then(()=>pdfInstaller(undefined,progress=>{if(pdfInstall.status==='running')pdfInstall.detail=progress.detail;})).then(()=>{pdfInstall={status:'completed',detail:'Setup completed. Open the advanced editor.'};},error=>{pdfInstall={status:'failed',detail:pdfcraftInstallError(error)+'. Stop the app and run npm run setup if the component remains unavailable'};}).finally(()=>{pdfInstallPromise=null;});}
        return json(res,202,pdfInstall);
      }
      if(p==='/api/diagnostics'&&method==='GET')return json(res,200,diagnostics(store,dataDir,buildFingerprint));
      if((p.startsWith('/api/jobs')||p.startsWith('/api/local-backups'))&&await maintenance.handle(req,res,p))return;
      if((p.startsWith('/api/workbooks')||p.startsWith('/api/finance/'))&&await finance.handle(req,res,p))return;
      if(p==='/api/settings'&&method==='PUT') {
        const input=await readJSON(req,20000),settings=cleanSettings(input);
        if(typeof input.apiKey==='string'&&input.apiKey.trim())await credential(dataDir,'set',credentialSlot(settings),input.apiKey.trim());
        if(input.clearKey)await credential(dataDir,'delete',credentialSlot(settings));
        store.setSettings(settings);return json(res,200,{settings,keySaved:await credential(dataDir,'has',credentialSlot(settings))});
      }
      if(p==='/api/provider/test'&&method==='POST'){const s=store.settings();return json(res,200,await testProvider(s,await credential(dataDir,'get',credentialSlot(s))));}
      if(p==='/api/tasks'&&method==='GET')return json(res,200,store.list());
      if(p==='/api/tasks'&&method==='POST')return json(res,201,responseTask(store.create()));
      if(p==='/api/templates'&&method==='GET')return json(res,200,store.templates());
      if(p==='/api/templates'&&method==='POST') {
        const input=await readJSON(req),b=bytesFrom(input);validateTemplate(b);const id=randomUUID();store.db.exec('BEGIN');try{store.db.prepare('INSERT INTO templates VALUES (?,?,?,0)').run(id,safeName(input.name),b);office.records.addTemplate(id,input);store.db.exec('COMMIT');}catch(error){store.db.exec('ROLLBACK');throw error;}return json(res,201,store.templates());
      }
      if(p==='/api/template-starter'&&method==='GET') {
        const task={facts:Object.fromEntries(Object.keys(fields).map(k=>[k,{value:'{{'+k+'}}'}])),body:'{{body}}'};
        // The starter is intended to be edited and approved in Word before upload.
        const b=makeDocx(task,null,false,true);res.writeHead(200,{'Content-Type':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','Content-Disposition':'attachment; filename="template-starter.docx"'});return res.end(b);
      }
      if(p==='/api/backup'&&method==='GET') {
        // Preflight before materializing every BLOB/base64/escaped JSON copy.
        // JSON backups must remain restorable through the 150 MB endpoint.
        const raw=store.db.prepare('SELECT (SELECT coalesce(sum(length(CAST(data AS BLOB))*4+1024),0) FROM tasks)+(SELECT coalesce(sum((length(CAST(data AS BLOB))+length(CAST(label AS BLOB)))*4+1024),0) FROM revisions)+(SELECT coalesce(sum(length(CAST(extraction AS BLOB))*4+((length(content)+2)/3)*4+2048),0) FROM sources)+(SELECT coalesce(sum(((length(content)+2)/3)*4+2048),0) FROM templates) AS bytes').get().bytes;
        if(raw+officeEstimate(store.db)+finance.backupEstimate()+pdfRecovery.used()*1.4+store.db.prepare('SELECT coalesce(sum(length(CAST(data AS BLOB))*4+1024),0) AS bytes FROM writing_items').get().bytes>140*1024*1024)throw Object.assign(new Error('This collection exceeds the JSON backup capacity. Use a local SQLite snapshot in Jobs & backups, or close the app and back up the data folder; no documents were changed.'),{status:413});
        let payload;store.db.exec('BEGIN');
        try{payload={format:'office-drafting-backup',version:1,created:new Date().toISOString(),settings:store.settings(),tasks:store.db.prepare('SELECT * FROM tasks').all(),revisions:store.db.prepare('SELECT * FROM revisions').all(),sources:store.db.prepare('SELECT * FROM sources').all().map(s=>({...s,content:Buffer.from(s.content).toString('base64')})),templates:store.db.prepare('SELECT * FROM templates').all().map(t=>({...t,content:Buffer.from(t.content).toString('base64')})),...finance.backup()};Object.assign(payload,officeBackup(store.db));payload.writingItems=store.db.prepare('SELECT * FROM writing_items').all();payload.pdfSessions=store.db.prepare('SELECT * FROM pdf_sessions').all().map(row=>({...row,original:Buffer.from(row.original).toString('base64')}));payload.pdfVersions=store.db.prepare('SELECT * FROM pdf_versions').all().map(row=>({...row,content:Buffer.from(row.content).toString('base64')}));store.db.exec('COMMIT');}catch(error){store.db.exec('ROLLBACK');throw error;}
        // Capture finance in the same read transaction as document records.
        const data=JSON.stringify(payload),encoded=JSON.stringify({checksum:createHash('sha256').update(data).digest('hex'),data});if(Buffer.byteLength(encoded)>150*1024*1024)throw Object.assign(new Error('Backup exceeds the 150 MB restore limit. Back up the data folder with the app closed instead.'),{status:413});res.writeHead(200,{'Content-Type':'application/json','Content-Disposition':'attachment; filename="office-backup.json"'});return res.end(encoded);
      }
      if(p==='/api/restore'&&method==='POST') {
        const input=await readJSON(req,150*1024*1024);
        if(typeof input.data!=='string'||createHash('sha256').update(input.data).digest('hex')!==input.checksum)throw new Error('Backup checksum is invalid.');
        return json(res,200,restoreRecords(store,finance,jsonRestoreTables(JSON.parse(input.data)),{bytesFrom,safeName}));
      }
      const match=p.match(/^\/api\/tasks\/([a-f0-9-]+)(?:\/(.*))?$/);
      if(match) {
        const [,id,action]=match;const task=store.get(id);
        if(!action&&method==='GET')return json(res,200,{task:responseTask(task),sources:store.sources(id),revisions:store.db.prepare('SELECT id,label,created FROM revisions WHERE task_id=? ORDER BY created DESC').all(id)});
        if(!action&&method==='PUT'){const input=await readJSON(req,2*1024*1024);return json(res,200,responseTask(store.save(id,input,input.checkpoint?'Saved checkpoint':undefined)));}
        if(!action&&method==='DELETE'){writing.cancelTask(id);maintenance.jobs.cancelOwner('task',id);if(activeAI?.taskId===id)activeAI.controller.abort();for(const [key,job]of referenceJobs)if(key.startsWith(id+':')){job.controller.abort();referenceJobs.delete(key);}store.db.prepare('DELETE FROM tasks WHERE id=?').run(id);return json(res,200,{ok:true});}
        if(action==='preview'&&method==='POST'){
          const input=await readJSON(req,512*1024);if(input.version!==task.version)throw Object.assign(new Error('Document changed. Refresh the preview.'),{status:409});
          if(input.instruction!==undefined&&(typeof input.instruction!=='string'||input.instruction.length>5000))throw new Error('Invalid preview request.');
          const context=input.instruction?instructionContext(task,input.instruction).task:structuredClone(task);
          if(input.stage==='english')context.language='en';
          const snapshot=cleanTask({...context,body:typeof input.body==='string'?input.body:task.body});
          const template=templateFor(task),docx=makeDocx(snapshot,template?Buffer.from(template.content):null,true);
          res.writeHead(200,{'Content-Type':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','Cache-Control':'no-store'});return res.end(docx);
        }
        if(action==='generate'&&method==='POST'){task.body=draft(task);task.reviewed=false;task.messages.push({role:'assistant',text:'Created a template draft. Confirm the facts, then review the document. No AI was used.'});return json(res,200,responseTask(store.save(id,task,'Template draft')));}
        if(action==='assist-progress'&&method==='GET')return json(res,200,activeAI?.taskId===id?{active:true,phase:activeAI.phase,started:activeAI.started,stage:activeAI.stage,requestId:activeAI.requestId}:{active:false});
        if(action==='assist-cancel'&&method==='POST'){const input=await readJSON(req,2000);const cancelled=Boolean(activeAI?.taskId===id&&activeAI.requestId===input.requestId);if(cancelled)activeAI.controller.abort();return json(res,200,{cancelled});}
        if(action==='assist'&&method==='POST') {
          const input=await readJSON(req,60000);if(typeof input.instruction!=='string'||!input.instruction.trim())throw new Error('Enter a drafting request.');if(input.instruction.length>5000)throw new Error('Keep the drafting request within 5,000 characters.');
          if(input.stage!==undefined&&!['english','translate'].includes(input.stage))throw new Error('Invalid drafting stage.');
          if(input.requestId!==undefined&&(typeof input.requestId!=='string'||!/^[a-zA-Z0-9-]{1,100}$/.test(input.requestId)))throw new Error('Invalid request identifier.');
          const s=store.settings();if(['openai','gemini','compatible'].includes(s.provider)&&input.cloudConsent!==true)throw new Error('Confirm cloud processing before sending document content.');
          if(activeAI)throw Object.assign(new Error('AI is already processing another request. Wait for it to finish or cancel it before sending another.'),{status:429});
          const controller=new AbortController();res.on('close',()=>{if(!res.writableEnded)controller.abort();});
          const job={taskId:id,controller,phase:'Preparing the request',started:Date.now(),stage:input.stage||'direct',requestId:input.requestId||randomUUID()};activeAI=job;
          try{
          const context=instructionContext(task,input.instruction);
          if(input.stage==='english'){context.task.language='en';context.changes=context.changes.filter(change=>!change.startsWith('Document language:'));context.changes.push('Document language: English (step 1 of 2)');}
          const result=await aiAssistant(s,await credential(dataDir,'get',credentialSlot(s)),context.task,input.instruction,fetch,controller.signal,{stage:input.stage,source:input.translationSource,context:input.translationContext,glossary:office.records.termsFor(input.translationSource||input.instruction),onProgress:phase=>{if(activeAI===job)job.phase=phase;}});
          controller.signal.throwIfAborted();
          if(store.get(id).version!==task.version)throw Object.assign(new Error('The document changed while AI was processing. Request a new draft using the current facts.'),{status:409});
          const warnings=validate({...context.task,body:result.body,messages:[...task.messages,{role:'user',text:input.instruction}]},store.sources(id),templateFor(context.task)).filter(i=>i.code.startsWith('unsupported:')||i.code==='placeholder-name').map(i=>i.message);
          return json(res,200,{...result,notes:[...result.notes,...context.changes,...warnings],proposedType:context.task.type,proposedLanguage:context.task.language,proposedFacts:context.task.facts,baseVersion:task.version,provider:s.provider,model:s.model});
          }finally{if(activeAI===job)activeAI=null;}
        }
        if(action==='accept'&&method==='POST') {
          const input=await readJSON(req,512*1024);if(input.baseVersion!==task.version)throw Object.assign(new Error('The document changed. Request a new revision.'),{status:409});
          // User acceptance is explicit; all normal validation runs again.
          if(typeof input.instruction!=='string'||!input.instruction.trim()||input.instruction.length>5000)throw new Error('The original drafting request is required (up to 5,000 characters).');
          const context=instructionContext(task,input.instruction);
          if(input.stage==='english')context.task.language='en';
          const updated=cleanTask({...context.task,body:input.body,actionAtDraft:context.task.facts.action.value,reviewed:false});updated.version=task.version;updated.messages=[...task.messages,{role:'user',text:input.instruction.slice(0,8000)},{role:'assistant',text:'Accepted AI wording. Review factual claims and language before export.'}];
          return json(res,200,responseTask(store.save(id,updated,'Accepted AI revision')));
        }
        if(action==='compare'&&method==='GET'){const read=key=>{const value=url.searchParams.get(key)||'current';if(value==='current')return {data:task,label:'Current saved document v'+task.version};const row=store.db.prepare('SELECT data,label FROM revisions WHERE id=? AND task_id=?').get(value,id);if(!row)throw new Error('Document comparison revision not found.');return {data:JSON.parse(row.data),label:row.label};},from=read('from'),to=read('to');return json(res,200,{...taskDiff(from.data,to.data),from:from.label,to:to.label,version:task.version});}
        if(action?.startsWith('revisions/')&&method==='POST') {
          const row=store.db.prepare('SELECT data FROM revisions WHERE id=? AND task_id=?').get(action.slice(10),id);if(!row)throw new Error('Revision not found.');
          const restored=JSON.parse(row.data);for(const fact of Object.values(restored.facts))if(fact.provenance==='extracted')fact.confirmed=false;
          return json(res,200,responseTask(store.save(id,{...restored,version:task.version,reviewed:false},'Restored revision')));
        }
        if(action==='sources'&&method==='POST') {
          const input=await readJSON(req),b=bytesFrom(input),name=safeName(input.name),ext=extname(name).toLowerCase(),hash=createHash('sha256').update(b).digest('hex');
          if(!['.docx','.pdf','.png','.jpg','.jpeg','.txt'].includes(ext))throw new Error('Use DOCX, PDF, PNG, JPEG or TXT.');
          const cached=store.db.prepare('SELECT extraction FROM sources WHERE hash=? AND mime=?').get(hash,ext);let extraction;
          if(cached)extraction=JSON.parse(cached.extraction);
          else if(ext==='.docx')extraction=extractDocx(b);
          else if(ext==='.txt'){let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(b);}catch{throw new Error('Text references must use UTF-8 encoding. Save the file as UTF-8 and upload it again.');}if(text.length>referenceLimits.text||text.split('\n').length>referenceLimits.blocks)throw new Error('Reference text exceeds the extraction limit. Split it into smaller references.');if(text.includes('\0'))throw new Error('Text reference contains binary data. Save it as UTF-8 plain text.');const blocks=text.split(/\r?\n/).map((text,i)=>({location:'Line '+(i+1),text})).filter(b=>b.text.trim());extraction={status:'extracted',blocks,candidates:candidates(blocks)};}
          else if(ext==='.pdf') {
            if(b.subarray(0,5).toString()!=='%PDF-')throw new Error('File is not a PDF.');
            extraction={status:'needs extraction',blocks:[],candidates:[],notice:'Process this reference to extract PDF text and OCR scanned pages locally. Select the language before processing.'};
          } else {if(ext==='.png'&&b.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||ext!=='.png'&&(b[0]!==255||b[1]!==216))throw new Error('Invalid image.');imageDimensions(b);extraction={status:'needs OCR',blocks:[],candidates:[],notice:'Process this image with local OCR. Review uncertain text and confirm imported facts.'};}
          store.db.prepare('INSERT INTO sources VALUES (?,?,?,?,?,?,?)').run(randomUUID(),id,name,ext,hash,b,JSON.stringify(extraction));return json(res,201,store.sources(id));
        }
        const sm=action?.match(/^sources\/([a-f0-9-]+)(?:\/(extract|download|progress|page))?$/);
        if(sm) {
          const source=store.db.prepare('SELECT * FROM sources WHERE id=? AND task_id=?').get(sm[1],id);if(!source)throw new Error('Source not found.');
          if(sm[2]==='download'&&method==='GET'){res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(source.name)}`});return res.end(Buffer.from(source.content));}
          const jobKey=id+':'+source.id;
          if(sm[2]==='progress'&&method==='GET'){const job=referenceJobs.get(jobKey);return json(res,200,job?{running:true,...job.progress}:{running:false,status:'Ready',progress:1});}
          if(sm[2]==='page'&&method==='GET'){
            const controller=new AbortController();res.on('close',()=>{if(!res.writableEnded)controller.abort();});
            const result=await referenceProcessor(Buffer.from(source.content),source.mime,{operation:'preview',page:Number(url.searchParams.get('number')||1)},()=>{},controller.signal);return json(res,200,result);
          }
          if(sm[2]==='extract'&&method==='POST') {
            if(!['.pdf','.png','.jpg','.jpeg'].includes(source.mime))throw new Error('Only PDFs and images use this extraction action.');
            const input=await readJSON(req,1000),options=referenceOptions(input),previous=JSON.parse(source.extraction);
            if(referenceJobs.has(jobKey))throw Object.assign(new Error('This reference is already processing.'),{status:409});
            if(input.engine!=='word'&&!options.force&&previous.engine===referenceEngine&&previous.language===options.language&&previous.mode===options.mode&&previous.status==='extracted')return json(res,200,{task:responseTask(store.get(id)),sources:store.sources(id),cached:true});
            const controller=new AbortController(),job={controller,progress:{status:'Queued for local processing',progress:0}};referenceJobs.set(jobKey,job);res.on('close',()=>{if(!res.writableEnded)controller.abort();});
            try{
              let extraction;
              if(input.engine==='word'){
                if(source.mime!=='.pdf')throw new Error('Word extraction supports PDF references only.');
                const text=(await documentConverter(dataDir,'extract',Buffer.from(source.content),'pdf',{signal:controller.signal})).toString('utf8'),blocks=text.split(/[\r\n]+/).map((text,i)=>({location:'Converted paragraph '+(i+1),text})).filter(b=>b.text.trim());
                extraction={status:blocks.length?'extracted':'needs OCR',blocks,candidates:candidates(blocks),notice:'Word-converted text. Page coordinates are unavailable; compare against the original PDF.'};
              }else extraction=await referenceProcessor(Buffer.from(source.content),source.mime,options,value=>{job.progress=value;},controller.signal);
              controller.signal.throwIfAborted();store.updateExtraction(id,source.id,extraction);return json(res,200,{task:responseTask(store.get(id)),sources:store.sources(id),cached:false});
            }finally{if(referenceJobs.get(jobKey)===job)referenceJobs.delete(jobKey);}
          }
          if(!sm[2]&&method==='DELETE'){maintenance.jobs.cancelOwner('source',source.id);referenceJobs.get(jobKey)?.controller.abort();store.deleteSource(id,source.id);return json(res,200,{task:responseTask(store.get(id)),sources:store.sources(id)});}
        }
        if(action==='export'&&method==='POST') {
          if(office.locked(id))throw new Error('Download the immutable issued copy from Office centre, or start a new revision.');
          const input=await readJSON(req,1000),isDraft=input.draft!==false;
          if(!['docx','pdf'].includes(input.format))throw new Error('Choose DOCX or PDF.');
          const template=templateFor(task),issues=writing.check(task);
          if(!isDraft&&issues.some(i=>i.severity==='blocking'))throw new Error('Resolve blocking issues or download a draft.');
          const docx=makeDocx(task,template?Buffer.from(template.content):null,isDraft);
          const controller=new AbortController();res.on('close',()=>{if(!res.writableEnded)controller.abort();});
          const data=input.format==='pdf'?await documentConverter(dataDir,'pdf',docx,'docx',{signal:controller.signal}):docx;
          controller.signal.throwIfAborted();
          if(store.get(id).version!==task.version)throw Object.assign(new Error('The document changed during export. Export the latest saved version.'),{status:409});
          if(!isDraft&&writing.check(store.get(id)).some(issue=>issue.severity==='blocking'))throw Object.assign(new Error('Final export checks changed during conversion. Review the latest document and spreadsheet sources.'),{status:409});
          store.revision(id,task,`Exported ${isDraft?'draft':'final'} ${input.format.toUpperCase()} · version ${task.version}`);
          res.writeHead(200,{'Content-Type':input.format==='pdf'?'application/pdf':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','Content-Disposition':`attachment; filename="${isDraft?'draft-':''}document-v${task.version}.${input.format}"`});return res.end(data);
        }
      }
      json(res,404,{error:'Not found.'});
    } catch(error) { if(!res.headersSent)json(res,error.status||400,{error:error.name==='AbortError'?'Request cancelled.':error.message||'Operation failed.'});else res.end(); }
  });
  return {server,store,maintenance};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const port=Number(process.env.OFFICE_PORT||4317);
  if(!Number.isInteger(port)||port<0||port>65535){
    console.error('OFFICE_PORT must be a whole number between 0 and 65535. Use 4317, another available port, or 0 to select an available port automatically.');
    process.exitCode=1;
  }else{
  const dataDir=resolve(process.env.OFFICE_DATA_DIR||'data'),release=runtimeLock(dataDir);process.on('exit',release);
  const {server,store,maintenance}=createApp({dataDir});
  server.on('error',e=>{console.error(e.code==='EADDRINUSE'?'Port '+port+' is occupied. Stop the service using it, or set OFFICE_PORT to another available port and run npm start again.':e.message);process.exitCode=1;store.db.close();});
  server.listen(port,'127.0.0.1',()=>{console.log(`Office Drafting: http://127.0.0.1:${server.address().port}`);maintenance.start();});
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await maintenance.close();server.close(()=>{store.db.close();process.exit(0);});});
  }
}
