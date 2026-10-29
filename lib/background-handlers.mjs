import {createHash} from 'node:crypto';
import {makeDocx,candidates} from './documents.mjs';
import {validate} from './core.mjs';
import {referenceOptions,referenceEngine} from './reference-core.mjs';
import {validateWorkbookFacts} from './writing-core.mjs';

export function backgroundHandlers({store,finance,dataDir,referenceProcessor,documentConverter,financeProcessor,safeName}){
  const currentTask=params=>{const task=store.get(params.taskId);if(task.version!==params.version)throw new Error('The document changed. Start a new export using its latest saved version.');return task;};
  const currentBook=params=>{const book=finance.store.get(params.workbookId);if(book.version!==params.version)throw new Error('The workbook changed. Start this operation again from the latest saved version.');return book;};
  const template=task=>task.templateId?store.db.prepare('SELECT * FROM templates WHERE id=?').get(task.templateId):null;
  const templateHash=value=>value?createHash('sha256').update(value.content).digest('hex'):'';
  const checks=(task,selected)=>[...validate(task,store.sources(task.id),selected),...validateWorkbookFacts(task,finance.store)];
  return {
    reference:{
      prepare(input){store.get(input.taskId);const source=store.db.prepare('SELECT id,name,mime,hash FROM sources WHERE id=? AND task_id=?').get(input.sourceId,input.taskId);if(!source||!['.pdf','.png','.jpg','.jpeg'].includes(source.mime))throw new Error('Choose a saved PDF or image reference.');const options=referenceOptions(input);if(input.engine&&input.engine!=='word')throw new Error('Unsupported extraction engine.');if(input.engine==='word'&&source.mime!=='.pdf')throw new Error('Word text conversion requires a PDF.');return {key:'reference:'+source.id,label:'Process '+source.name,taskId:input.taskId,sourceId:source.id,params:{taskId:input.taskId,sourceId:source.id,hash:source.hash,...options,engine:input.engine||''}};},
      async run(params,bytes,context){
        const source=store.db.prepare('SELECT * FROM sources WHERE id=? AND task_id=?').get(params.sourceId,params.taskId);if(!source||source.hash!==params.hash)throw new Error('The reference was deleted or changed.');const previous=JSON.parse(source.extraction);
        if(!params.force&&params.engine!=='word'&&previous.engine===referenceEngine&&previous.language===params.language&&previous.mode===params.mode&&previous.status==='extracted')return {value:{taskId:params.taskId,sourceId:params.sourceId,cached:true}};
        let extraction;
        if(params.engine==='word'){
          const text=(await documentConverter(dataDir,'extract',Buffer.from(source.content),'pdf',{signal:context.signal})).toString('utf8'),blocks=text.split(/[\r\n]+/).map((text,i)=>({location:'Converted paragraph '+(i+1),text})).filter(b=>b.text.trim());extraction={status:blocks.length?'extracted':'needs OCR',blocks,candidates:candidates(blocks),notice:'Word-converted text; compare against the original.'};
        }else extraction=await referenceProcessor(Buffer.from(source.content),source.mime,params,value=>context.progress(value),context.signal);
        context.guard();store.updateExtraction(params.taskId,params.sourceId,extraction);return {value:{taskId:params.taskId,sourceId:params.sourceId,cached:false}};
      }
    },
    'document-export':{
      prepare(input){const task=store.get(input.taskId);if(store.db.prepare('SELECT 1 FROM office_issues WHERE task_id=?').get(task.id))throw new Error('Download the locked issued copy from Office centre, or create a new revision.');if(input.version!==task.version)throw Object.assign(new Error('Save the latest document before exporting.'),{status:409});if(!['docx','pdf'].includes(input.format))throw new Error('Choose Word or PDF.');const selected=template(task),isDraft=input.draft!==false;if(!isDraft&&checks(task,selected).some(i=>i.severity==='blocking'))throw new Error('Resolve blocking issues or export a draft.');return {key:`document-export:${task.id}:${task.version}:${input.format}:${isDraft}`,label:`${isDraft?'Draft':'Final'} ${input.format.toUpperCase()} · ${task.title} · v${task.version}`,taskId:task.id,params:{taskId:task.id,version:task.version,format:input.format,draft:isDraft,templateHash:templateHash(selected)}};},
      async run(params,bytes,context){const task=currentTask(params),selected=template(task);if(templateHash(selected)!==params.templateHash)throw new Error('The selected template changed. Create a new export.');if(!params.draft&&checks(task,selected).some(i=>i.severity==='blocking'))throw new Error('Final export checks no longer pass.');context.progress({status:'Rendering the saved document',progress:.2});const docx=makeDocx(task,selected?Buffer.from(selected.content):null,params.draft),artifact=params.format==='pdf'?await documentConverter(dataDir,'pdf',docx,'docx',{signal:context.signal}):docx;context.guard();currentTask(params);if(!params.draft&&checks(store.get(task.id),selected).some(issue=>issue.severity==='blocking'))throw new Error('Final export checks changed during conversion. Review the spreadsheet sources.');store.revision(task.id,task,'Background export · '+params.format.toUpperCase()+' · version '+task.version);return {artifact,mime:params.format==='pdf'?'application/pdf':'application/vnd.openxmlformats-officedocument.wordprocessingml.document',filename:`${params.draft?'draft-':''}document-v${task.version}.${params.format}`,value:{taskId:task.id,version:task.version}};}
    },
    'workbook-calculate':{
      prepare(input){const book=finance.store.get(input.workbookId);if(input.version!==book.version)throw Object.assign(new Error('Save the latest workbook first.'),{status:409});return {key:`workbook-calculate:${book.id}:${book.version}`,label:'Calculate '+book.name+' · v'+book.version,workbookId:book.id,params:{workbookId:book.id,version:book.version}};},
      async run(params,bytes,context){const book=currentBook(params);context.progress({status:'Calculating locally',progress:.2});const result=await financeProcessor('calculate',book,{signal:context.signal});context.guard();currentBook(params);const saved=finance.store.save(book.id,{...result,version:book.version},{calculated:true});return {value:{workbookId:saved.id,version:saved.version}};}
    },
    'workbook-export':{
      prepare(input){const book=finance.store.get(input.workbookId);if(input.version!==book.version)throw Object.assign(new Error('Save the latest workbook first.'),{status:409});if(input.report!==undefined&&typeof input.report!=='boolean')throw new Error('Invalid report option.');return {key:`workbook-export:${book.id}:${book.version}:${!!input.report}`,label:(input.report?'Financial reports':'Excel workbook')+' · '+book.name+' · v'+book.version,workbookId:book.id,params:{workbookId:book.id,version:book.version,report:!!input.report}};},
      async run(params,bytes,context){const book=currentBook(params);context.progress({status:'Preparing Excel output',progress:.2});const artifact=await financeProcessor('export',book,{report:params.report,signal:context.signal});context.guard();currentBook(params);return {artifact,mime:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',filename:params.report?'financial-reports.xlsx':'edited-workbook.xlsx',value:{workbookId:book.id,version:book.version}};}
    },
    'workbook-import':{
      prepare(input,payload){const name=safeName(input.name);if(!/\.xlsx$/i.test(name)||!payload?.length||payload.length>12*1024*1024)throw new Error('Choose a plain XLSX file up to 12 MB.');const hash=createHash('sha256').update(payload).digest('hex');return {key:'workbook-import:'+hash,label:'Import '+name,params:{name,hash}};},
      async run(params,payload,context){if(!payload||createHash('sha256').update(payload).digest('hex')!==params.hash)throw new Error('Saved upload is missing or changed. Upload the workbook again.');context.progress({status:'Reading the saved Excel upload',progress:.2});const book=await financeProcessor('import',payload,{name:params.name,signal:context.signal});context.guard();const created=finance.store.create(book,payload,params.name,{jobId:context.id});return {workbookId:created.id,value:{workbookId:created.id,version:created.version}};}
    }
  };
}
