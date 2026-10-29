import {createHash,randomUUID} from 'node:crypto';
import {financeStore} from './finance-store.mjs';
import {financeJob,financeStatus} from './finance.mjs';
import {cleanWorkbook,financialReport} from './finance-core.mjs';
import {validateXlsx} from './finance-files.mjs';
import {importGuide,applyImportGuide,categorySuggestions} from './import-guide.mjs';
import {sampleCatalog,sampleWorkbook} from './finance-samples.mjs';
import {workbookDiff} from './revision-diff.mjs';
import {formulaAudit} from './formula-audit.mjs';
import {comparePeriods,comparisonCsv} from './period-comparison.mjs';

export function financeRoutes(db,{json,readJSON,bytesFrom,safeName,processor=financeJob,onDelete=()=>{}}){
  const store=financeStore(db);
  db.exec('CREATE TABLE IF NOT EXISTS import_previews(id TEXT PRIMARY KEY,expires INTEGER NOT NULL,data TEXT NOT NULL,content BLOB,name TEXT NOT NULL,workbook_id TEXT REFERENCES workbooks(id) ON DELETE SET NULL,committed INTEGER NOT NULL DEFAULT 0);');
  const expirePreviews=()=>db.prepare('DELETE FROM import_previews WHERE expires<?').run(Date.now());expirePreviews();
  const download=(res,data,name)=>{res.writeHead(200,{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename="${name}"`,'Cache-Control':'no-store'});res.end(Buffer.from(data));};
  const run=(req,res,operation,input,options={})=>{const controller=new AbortController();res.on('close',()=>{if(!res.writableEnded)controller.abort();});return processor(operation,input,{...options,signal:controller.signal});};
  return {store,
    backupEstimate:()=>db.prepare('SELECT (SELECT coalesce(sum(length(CAST(data AS BLOB))*4+((coalesce(length(original),0)+2)/3)*4+2048),0) FROM workbooks)+(SELECT coalesce(sum(length(CAST(data AS BLOB))*4+2048),0) FROM workbook_revisions) AS bytes').get().bytes,
    backup:()=>({workbooks:db.prepare('SELECT * FROM workbooks').all().map(row=>({...row,original:row.original?Buffer.from(row.original).toString('base64'):null})),workbookRevisions:db.prepare('SELECT * FROM workbook_revisions').all()}),
    restore(payload,onIds){
      const rows=payload.workbooks??[],revisions=payload.workbookRevisions??[];
      if(!rows||typeof rows!=='object'||typeof rows[Symbol.iterator]!=='function'||!revisions||typeof revisions!=='object'||typeof revisions[Symbol.iterator]!=='function')throw new Error('Invalid workbook backup.');const ids=new Map(),seenRevisions=new Set();
      for(const row of rows){
        if(!row||typeof row.id!=='string'||!row.id||ids.has(row.id))throw new Error('Invalid or duplicate workbook ID in backup.');const data=cleanWorkbook(JSON.parse(row.data));data.mapping.confirmed=false;
        let original=null;const name=safeName(row.original_name||'');if(row.original!==null&&row.original!==undefined){original=bytesFrom({base64:typeof row.original==='string'?row.original:Buffer.from(row.original).toString('base64')});if(/\.pdf$/i.test(name)){if(original.subarray(0,5).toString()!=='%PDF-')throw new Error('Invalid original PDF source.');}else validateXlsx(original);if(createHash('sha256').update(original).digest('hex')!==row.original_hash)throw new Error('Workbook source checksum mismatch.');}
        const id=randomUUID();ids.set(row.id,id);db.prepare('INSERT INTO workbooks VALUES(?,?,1,?,?,?,?)').run(id,JSON.stringify(data),new Date().toISOString(),original,original?name:'',original?row.original_hash:'');store.revision(id,data,'Restored workbook — verify mapping');
      }
      for(const row of revisions){if(!row||typeof row.id!=='string'||!row.id||seenRevisions.has(row.id)||!ids.has(row.workbook_id))throw new Error('Invalid workbook history in backup.');seenRevisions.add(row.id);const data=cleanWorkbook(JSON.parse(row.data));data.mapping.confirmed=false;store.revision(ids.get(row.workbook_id),data,'Restored: '+String(row.label).slice(0,100));}
      onIds?.(ids);return ids.size;
    },
    async handle(req,res,p){
      const method=req.method;
      if(p==='/api/finance/status'&&method==='GET'){json(res,200,financeStatus());return true;}
      if(p==='/api/finance/samples'&&method==='GET'){json(res,200,sampleCatalog);return true;}
      if(p==='/api/finance/samples'&&method==='POST'){const input=await readJSON(req,1000);json(res,201,store.create(sampleWorkbook(input.id)));return true;}
      if(p==='/api/finance/comparison'&&method==='GET'){const query=new URL(req.url,'http://local').searchParams,result=comparePeriods(store.get(query.get('from')),store.get(query.get('to')));if(query.get('download')==='csv'){if(Number(query.get('fromVersion'))!==result.before.version||Number(query.get('toVersion'))!==result.after.version)throw Object.assign(new Error('A report changed. Compare the latest versions before downloading.'),{status:409});res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="period-comparison.csv"','Cache-Control':'no-store'});res.end(comparisonCsv(result));}else json(res,200,result);return true;}
      if(p==='/api/finance/import-preview'&&method==='POST'){
        expirePreviews();if(db.prepare('SELECT count(*) n FROM import_previews WHERE committed=0').get().n>=3)throw new Error('Finish or cancel an existing import preview before uploading another.');const input=await readJSON(req),bytes=bytesFrom(input),name=safeName(input.name);if(!/\.xlsx$/i.test(name))throw new Error('Choose a plain XLSX file.');const book=await run(req,res,'import',bytes,{name}),id=randomUUID();expirePreviews();if(db.prepare('SELECT count(*) n FROM import_previews WHERE committed=0').get().n>=3)throw new Error('Too many import previews. Cancel one and retry.');db.prepare('INSERT INTO import_previews(id,expires,data,content,name) VALUES(?,?,?,?,?)').run(id,Date.now()+30*60000,JSON.stringify(book),bytes,name);json(res,201,{id,...importGuide(book)});return true;
      }
      const suggestionMatch=/^\/api\/finance\/import-preview\/([a-f0-9-]+)\/suggest$/.exec(p);
      if(suggestionMatch&&method==='POST'){expirePreviews();const row=db.prepare('SELECT data FROM import_previews WHERE id=? AND committed=0').get(suggestionMatch[1]);if(!row)throw new Error('Preview unavailable. Upload the workbook again.');const input=await readJSON(req,5000),book=applyImportGuide(JSON.parse(row.data),input.mapping,false);json(res,200,categorySuggestions(book,book.mapping));return true;}
      const previewMatch=/^\/api\/finance\/import-preview\/([a-f0-9-]+)$/.exec(p);
      if(previewMatch){expirePreviews();const row=db.prepare('SELECT * FROM import_previews WHERE id=?').get(previewMatch[1]);if(!row)throw Object.assign(new Error('Import preview expired or was cancelled. Upload the file again.'),{status:404});if(method==='DELETE'){const imported=row.committed&&row.workbook_id?store.get(row.workbook_id):null;db.prepare('DELETE FROM import_previews WHERE id=?').run(row.id);json(res,200,{ok:true,imported});return true;}if(method==='POST'){const input=await readJSON(req,5000);if(input.confirmImport!==true||typeof input.applyCategories!=='boolean'||!input.mapping||typeof input.mapping!=='object'||Array.isArray(input.mapping))throw new Error('Review the preview and confirm the import first.');if(row.committed){if(!row.workbook_id)throw new Error('This imported workbook was deleted. Start a new upload.');json(res,200,store.get(row.workbook_id));return true;}json(res,201,store.create(applyImportGuide(JSON.parse(row.data),input.mapping,input.applyCategories),Buffer.from(row.content),row.name,{previewId:row.id}));return true;}}
      if(p==='/api/workbooks'&&method==='GET'){json(res,200,store.list());return true;}
      if(p==='/api/workbooks'&&method==='POST'){json(res,201,store.create());return true;}
      if(p==='/api/workbooks/import'&&method==='POST'){
        const input=await readJSON(req),bytes=bytesFrom(input),name=safeName(input.name);if(!/\.xlsx$/i.test(name))throw new Error('Choose a plain .xlsx workbook. XLS, XLSM and password-protected files are not supported.');
        const book=await run(req,res,'import',bytes,{name});json(res,201,store.create(book,bytes,name));return true;
      }
      const match=/^\/api\/workbooks\/([a-f0-9-]+)(?:\/(.*))?$/.exec(p);if(!match)return false;
      const [,id,action]=match,book=store.get(id);
      if(action==='audit'&&method==='GET'){const query=new URL(req.url,'http://local').searchParams;json(res,200,{...formulaAudit(book,query.get('sheet')||book.sheets[0].name,query.get('cell')||'A1'),version:book.version});return true;}
      if(action==='compare'&&method==='GET'){const query=new URL(req.url,'http://local').searchParams,read=key=>{const value=query.get(key)||'current';if(value==='current')return {data:book,label:'Current saved workbook v'+book.version};const row=db.prepare('SELECT data,label FROM workbook_revisions WHERE id=? AND workbook_id=?').get(value,id);if(!row)throw new Error('Workbook comparison revision not found.');return {data:JSON.parse(row.data),label:row.label};},from=read('from'),to=read('to');json(res,200,{...workbookDiff(from.data,to.data,{offset:Number(query.get('offset')||0),limit:200}),from:from.label,to:to.label,version:book.version});return true;}
      if(!action&&method==='GET'){json(res,200,{workbook:book,history:store.history(id)});return true;}
      if(!action&&method==='PUT'){json(res,200,store.save(id,await readJSON(req,3*1024*1024)));return true;}
      if(!action&&method==='DELETE'){onDelete(id);db.prepare('DELETE FROM workbooks WHERE id=?').run(id);json(res,200,{ok:true});return true;}
      if(action==='calculate'&&method==='POST'){
        const input=await readJSON(req,1000);if(input.version!==book.version)throw Object.assign(new Error('Workbook changed. Save and retry calculation.'),{status:409});
        const result=await run(req,res,'calculate',book);json(res,200,store.save(id,{...result,version:book.version},{calculated:true}));return true;
      }
      if(action==='confirm'&&method==='POST'){const input=await readJSON(req,1000);json(res,200,store.confirm(id,input.version));return true;}
      if(action==='report'&&method==='GET'){json(res,200,financialReport(book));return true;}
      if(action==='checkpoint'&&method==='POST'){const input=await readJSON(req,1000);if(input.version!==book.version)throw Object.assign(new Error('Workbook changed. Reopen it before saving history.'),{status:409});store.revision(id,book,'Saved checkpoint');json(res,200,store.history(id));return true;}
      if(action?.startsWith('revisions/')&&method==='POST'){
        const input=await readJSON(req,1000),row=db.prepare('SELECT * FROM workbook_revisions WHERE id=? AND workbook_id=?').get(action.slice(10),id);if(!row)throw Object.assign(new Error('Workbook revision not found.'),{status:404});
        json(res,200,store.save(id,{...JSON.parse(row.data),version:input.version},{label:'Restored checkpoint'}));return true;
      }
      if(action==='original'&&method==='GET'){const row=db.prepare('SELECT original,original_name FROM workbooks WHERE id=?').get(id);if(!row.original)throw new Error('This workbook has no original upload.');if(/\.pdf$/i.test(row.original_name)){res.writeHead(200,{'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="original-source.pdf"'});res.end(Buffer.from(row.original));}else download(res,row.original,'original-workbook.xlsx');return true;}
      if(action==='export'&&method==='POST'){
        const input=await readJSON(req,1000);if(input.version!==book.version)throw Object.assign(new Error('Workbook changed. Save and retry export.'),{status:409});if(input.report!==undefined&&typeof input.report!=='boolean')throw new Error('Invalid export type.');
        const data=await run(req,res,'export',book,{report:input.report===true});
        if(store.get(id).version!==book.version)throw Object.assign(new Error('Workbook changed during export. Retry with the saved version.'),{status:409});
        download(res,data,input.report?'financial-reports.xlsx':'edited-workbook.xlsx');return true;
      }
      return false;
    }
  };
}
