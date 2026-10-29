import {parentPort,workerData} from 'node:worker_threads';
import {importXlsx,calculateWorkbook,exportXlsx} from './finance-files.mjs';
try{
  const {operation,input,name,report}=workerData;
  const result=operation==='import'?await importXlsx(input,name):operation==='export'?await exportXlsx(input,{report}):calculateWorkbook(input);
  parentPort.postMessage({result});
}catch(error){parentPort.postMessage({error:error.message});}
