import {createRequire} from 'node:module';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,existsSync,renameSync,rmSync} from 'node:fs';
import {resolve,relative,isAbsolute,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {pdfcraftRelease} from '../lib/pdf-workspace.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),require=createRequire(import.meta.url);
const reportPath=resolve(process.env.OFFICE_DATA_DIR||resolve(root,'data'),'setup/pdfcraft-install.json');
export function pdfcraftInstallError(error){return error.message+(error.cause?.code?' ('+error.cause.code+')':'');}
export function recordPdfcraftInstall(status,detail){mkdirSync(dirname(reportPath),{recursive:true});writeFileSync(reportPath,JSON.stringify({updated:new Date().toISOString(),version:pdfcraftRelease.version,status,detail},null,2));}
export function safePdfcraftEntry(name){return !!name&&!name.includes('\\')&&!name.includes(':')&&!name.includes('\0')&&!name.startsWith('/')&&!name.split('/').some(part=>part==='.'||part==='..');}
export function verifyPdfcraftArchive(bytes){if(bytes.length>32*1024*1024||createHash('sha256').update(bytes).digest('hex')!==pdfcraftRelease.sha256)throw new Error('PdfCraft archive checksum does not match the pinned v'+pdfcraftRelease.version+' release. Nothing was installed.');}
async function fetchBytes(url,limit){const response=await fetch(url,{signal:AbortSignal.timeout(90000)});if(!response.ok)throw new Error('Download returned HTTP '+response.status);const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>limit)throw new Error('Download exceeds its size limit.');chunks.push(chunk);}return Buffer.concat(chunks);}
export async function installPdfcraft(archive,onProgress=()=>{}){
  const record=(status,detail)=>{recordPdfcraftInstall(status,detail);onProgress({status,detail});};
  record('running','Starting PDF editor setup');
  try{
  const parent=resolve(root,'vendor/pdfcraft'),destination=resolve(parent,pdfcraftRelease.version);
  if(existsSync(resolve(destination,'index.html'))){record('completed','PdfCraft is already installed');console.log('PdfCraft '+pdfcraftRelease.version+' is already installed.');return;}
  console.log('Installing the unmodified PdfCraft '+pdfcraftRelease.version+' browser build. Internet is needed only for setup.');
  record('running',archive?'Reading the local release archive':'Downloading the pinned release from GitHub');
  const bytes=archive?readFileSync(resolve(archive)):await fetchBytes(pdfcraftRelease.source+'/releases/download/v'+pdfcraftRelease.version+'/'+pdfcraftRelease.archive,32*1024*1024);verifyPdfcraftArchive(bytes);
  record('running','Checksum verified; unpacking the browser editor');
  const JSZip=require('jszip'),zip=await JSZip.loadAsync(bytes,{checkCRC32:true}),files=Object.values(zip.files),indexes=files.filter(file=>/(^|\/)index\.html$/.test(file.name));
  if(files.length>4000||indexes.length!==1)throw new Error('Unexpected PdfCraft web archive layout.');const prefix=indexes[0].name.slice(0,-10),stage=resolve(parent,'.setup-'+randomUUID());
  if(dirname(stage)!==parent)throw new Error('Invalid setup directory.');mkdirSync(stage,{recursive:true});
  try{
    let total=0;for(const file of files){if(!safePdfcraftEntry(file.unsafeOriginalName||file.name)||!safePdfcraftEntry(file.name)||(Number(file.unixPermissions)&0xf000)===0xa000)throw new Error('Unsafe PdfCraft archive entry.');if(file.dir||!file.name.startsWith(prefix))continue;const name=file.name.slice(prefix.length);if(!safePdfcraftEntry(name))throw new Error('Unsafe PdfCraft file path.');const output=resolve(stage,name),rel=relative(stage,output);if(!rel||rel.startsWith('..')||isAbsolute(rel))throw new Error('Invalid setup path.');const data=await file.async('nodebuffer');total+=data.length;if(total>256*1024*1024)throw new Error('Expanded PdfCraft archive exceeds its limit.');mkdirSync(dirname(output),{recursive:true});writeFileSync(output,data);}
    // Retain the entire verified release and its bundled notices. The official
    // web ZIP includes the three main notices but not ATTRIBUTION.md. Do not
    // force an extra network request when installing that ZIP offline.
    const noticeDir=resolve(stage,'upstream-notices');mkdirSync(noticeDir,{recursive:true});
    record('running','Preserving upstream licences and notices');
    for(const name of ['LICENSE-MIT','LICENSE-APACHE','NOTICE','ATTRIBUTION.md']){const bundled=files.find(file=>!file.dir&&file.name.endsWith('/'+name)||!file.dir&&file.name===name);if(!bundled&&name==='ATTRIBUTION.md')continue;const data=bundled?await bundled.async('nodebuffer'):await fetchBytes('https://raw.githubusercontent.com/storytold/pdfcraft/v'+pdfcraftRelease.version+'/'+name,4*1024*1024);writeFileSync(resolve(noticeDir,name),data);}
    writeFileSync(resolve(stage,'office-install.json'),JSON.stringify({...pdfcraftRelease,installed:new Date().toISOString(),modifiedUpstream:false},null,2));
    renameSync(stage,destination);record('completed','Installed; open the advanced editor in PDF workspace');console.log('Installed. Open PDF workspace and choose Open advanced editor. Normal use is offline.');
  }finally{if(dirname(stage)!==parent)throw new Error('Invalid setup cleanup path.');if(existsSync(stage))rmSync(stage,{recursive:true,force:true});}
  }catch(error){record('failed',pdfcraftInstallError(error));throw error;}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))installPdfcraft(process.argv[2]==='--archive'?process.argv[3]:undefined).catch(error=>{console.error('PDF editor setup could not complete: '+pdfcraftInstallError(error)+' Existing drafting and PDF review tools are unchanged. Check the setup log in the data folder under setup/pdfcraft-install.json.');process.exitCode=1;});
