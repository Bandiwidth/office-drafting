import {Worker} from 'node:worker_threads';
import {serialQueue} from './job-queue.mjs';
export {financeStatus,financePackages} from './finance-files.mjs';
const queue=serialQueue(3,'Too many spreadsheet jobs are queued. Wait for the current calculation.');
export function financeJob(operation,input,{signal,name='',report=false,timeout=15000}={}){
  return queue.submit(()=>new Promise((resolve,reject)=>{
    let worker,settled=false;
    const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);Promise.resolve(worker?.terminate()).catch(()=>{}).then(()=>error?reject(error):resolve(result));};
    const cancel=()=>finish(new DOMException('Spreadsheet operation cancelled.','AbortError'));
    const timer=setTimeout(()=>finish(new Error('Spreadsheet processing exceeded 15 seconds. Reduce the workbook size or simplify its formulas.')),timeout);
    signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted){cancel();return;}
    try{worker=new Worker(new URL('./finance-worker.mjs',import.meta.url),{workerData:{operation,input,name,report},resourceLimits:{maxOldGenerationSizeMb:256}});worker.on('message',message=>finish(message.error?new Error(message.error):null,message.result));worker.on('error',()=>finish(new Error('The spreadsheet engine stopped. Check the file or simplify its formulas.')));worker.on('exit',()=>{if(!settled)finish(new Error('Spreadsheet processing stopped before completion.'));});}catch(error){finish(error);}
  }),signal);
}
