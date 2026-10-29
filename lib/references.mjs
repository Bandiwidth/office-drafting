import {createRequire} from 'node:module';
import {existsSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Worker} from 'node:worker_threads';
import {referenceOptions} from './reference-core.mjs';
import {serialQueue} from './job-queue.mjs';

const require=createRequire(import.meta.url),root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export const referencePackages=['pdfjs-dist','@napi-rs/canvas','tesseract.js','@tesseract.js-data/eng','@tesseract.js-data/tel'];
export const languageFile=code=>join(root,'node_modules','@tesseract.js-data',code,'4.0.0_best_int',code+'.traineddata.gz');
const installed=name=>{try{require.resolve(name+'/package.json');return true;}catch{return false;}};
export function referenceStatus(){
  let canvas=false;try{canvas=typeof require('@napi-rs/canvas').createCanvas==='function';}catch{}
  const pdf=installed('pdfjs-dist'),tesseract=installed('tesseract.js'),languages={eng:existsSync(languageFile('eng')),tel:existsSync(languageFile('tel'))};
  return {pdfText:pdf&&canvas,pdfPreview:pdf&&canvas,imagePreview:canvas,ocr:tesseract&&canvas,languages,packages:Object.fromEntries(referencePackages.map(name=>[name,installed(name)]))};
}
const queue=serialQueue(4,'Too many reference jobs are queued. Wait for the current job to finish.');
export function referenceJob(bytes,mime,input={},onProgress=()=>{},signal,{workerFactory=data=>new Worker(new URL('./reference-worker.mjs',import.meta.url),{workerData:data,resourceLimits:{maxOldGenerationSizeMb:512}}),timeout=120000}={}){
  const options=referenceOptions(input);if(!['.pdf','.png','.jpg','.jpeg'].includes(mime))return Promise.reject(new Error('Use PDF, PNG or JPEG for local extraction.'));
  if(['preview','table'].includes(input.operation)&&(!Number.isInteger(input.page)||input.page<1||input.page>30))return Promise.reject(new Error('Choose a page between 1 and 30.'));
  onProgress({status:'Queued for local processing',progress:0});
  const run=async()=>{
    signal?.throwIfAborted();
    return await new Promise((resolveJob,reject)=>{
      let worker,workspace,settled=false;
      const tempRoot=resolve(tmpdir());
      const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);Promise.resolve(worker?.terminate()).catch(()=>{}).then(()=>{if(workspace&&dirname(workspace)===tempRoot&&workspace.startsWith(join(tempRoot,'office-reference-')))rmSync(workspace,{recursive:true,force:true});}).then(()=>error?reject(error):resolveJob(result),()=>reject(new Error('Could not clean up the local reference workspace.')));};
      const cancel=()=>finish(new DOMException('Reference processing cancelled.','AbortError'));
      const timer=setTimeout(()=>finish(new Error('Reference processing timed out. Split a long PDF or resize the image and try again.')),timeout);
      signal?.addEventListener('abort',cancel,{once:true});
      try{workspace=mkdtempSync(join(tempRoot,'office-reference-'));worker=workerFactory({bytes:new Uint8Array(bytes),mime,...options,operation:input.operation||'extract',page:input.page,workspace});}catch(error){finish(error);return;}
      worker.on('message',message=>{if(message.type==='progress')onProgress(message.value);else if(message.type==='result')finish(null,message.value);else if(message.type==='error')finish(new Error(message.message));});
      worker.on('error',()=>finish(new Error('The local document engine could not process this reference. Check the file and installed components.')));
      worker.on('exit',()=>{if(!settled)finish(new Error('Reference processing stopped before completion. Try a smaller file.'));});
    });
  };
  return queue.submit(run,signal);
}
