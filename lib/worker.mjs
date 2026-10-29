import { execFile } from 'node:child_process';
import { resolve, join,dirname } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import {serialQueue} from './job-queue.mjs';
const wordPath='C:/Program Files/Microsoft Office/root/Office16/WINWORD.EXE';
const powershell=join(process.env.SystemRoot||'C:/Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
export function capabilities(){return {word:process.platform==='win32'&&existsSync(wordPath),pdf:true,pdfEngine:'Browser print / Save as PDF',ocr:false,pdfExtraction:process.platform==='win32'&&existsSync(wordPath)};}
const queue=serialQueue(4,'Too many document conversion jobs are queued. Wait for the current conversion to finish.');
export function wordJob(dir,operation,bytes,extension,{signal}={}) {
  if(!['pdf','extract'].includes(operation)||!['docx','pdf'].includes(extension))return Promise.reject(new Error('Unsupported document conversion.'));
  const run=async()=>{
    signal?.throwIfAborted();
    if(operation==='pdf'){
      if(extension!=='docx')throw new Error('PDF export requires a DOCX document.');
      throw new Error('Use the document PDF button to open the local print preview, then choose Save as PDF in your browser. No desktop Office installation is required.');
    }
    if(!capabilities().word)throw new Error('Microsoft Word is required for this conversion on this build. DOCX downloads remain available.');
    const jobsRoot=resolve(dir,'jobs'),jobDir=resolve(jobsRoot,randomUUID());
    if(dirname(jobDir)!==jobsRoot)throw new Error('Invalid conversion workspace.');
    mkdirSync(jobDir,{recursive:true});
    const input=join(jobDir,'input.'+extension),output=join(jobDir,operation==='pdf'?'output.pdf':'output.txt');
    try {
      writeFileSync(input,bytes);
      await new Promise((res,rej)=>execFile(powershell,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',resolve('scripts/word.ps1'),operation,input,output],{windowsHide:true,timeout:60000,maxBuffer:1024*1024,signal},(err,stdout,stderr)=>err?rej(signal?.aborted?new DOMException('Request cancelled.','AbortError'):new Error(/80070005|E_ACCESSDENIED|Access is denied/.test(stderr||'')?'Windows denied access to the Word conversion service. Launch the application normally under your Windows user account and retry. DOCX export is available.':'Word conversion failed or timed out. Check that Word is activated and closes any first-run dialogs.')):res()));
      if(!existsSync(output))throw new Error('Word did not produce an output file.');
      const result=readFileSync(output);
      if(operation==='pdf'&&result.subarray(0,5).toString()!=='%PDF-')throw new Error('Invalid PDF output.');
      return result;
    } finally {rmSync(jobDir,{recursive:true,force:true});}
  };
  return queue.submit(run,signal);
}
