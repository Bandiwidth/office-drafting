import {readFileSync,existsSync,readdirSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(import.meta.url);
export async function checkInstallation({includePdfcraft=true,syntax=false}={}){
  const results=[];
  const check=(name,fn)=>{try{fn();results.push({name,ready:true});}catch(error){results.push({name,ready:false,detail:error.message});}};
  check('Node.js 24 or newer',()=>{if(Number(process.versions.node.split('.')[0])<24)throw new Error('Install Node.js 24 LTS (64-bit).');});
  const pkg=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
  for(const [name,version]of Object.entries({...pkg.dependencies,...pkg.optionalDependencies}))check(name,()=>{
    const manifest=join(root,'node_modules',name,'package.json');
    if(!existsSync(manifest))throw new Error('Not installed. Run npm ci --ignore-scripts.');
    if(JSON.parse(readFileSync(manifest,'utf8')).version!==version)throw new Error('Version differs from package.json. Run npm ci --ignore-scripts.');
  });
  check('Native canvas engine',()=>{const canvas=require(join(root,'node_modules','@napi-rs/canvas')).createCanvas(2,2);if(!canvas.getContext('2d'))throw new Error('Native canvas could not start.');});
  for(const language of ['eng','tel'])check('OCR language: '+language,()=>{
    const path=join(root,'node_modules','@tesseract.js-data',language,'4.0.0_best_int',language+'.traineddata.gz');
    if(!existsSync(path))throw new Error('Missing local trained data. Run npm ci --ignore-scripts.');
  });
  for(const [name,file]of Object.entries({'Word preview':'node_modules/docx-preview/dist/docx-preview.min.js','Word ZIP reader':'node_modules/jszip/dist/jszip.min.js','PDF viewer':'node_modules/pdfjs-dist/web/pdf_viewer.mjs','OCR worker':'node_modules/tesseract.js/src/worker-script/node/index.js'}))check(name,()=>{if(!existsSync(join(root,file)))throw new Error('Missing asset. Run npm ci --ignore-scripts.');});
  try{const {DatabaseSync}=await import('node:sqlite');check('SQLite engine',()=>{const db=new DatabaseSync(':memory:');try{db.prepare('SELECT 1').get();}finally{db.close();}});}catch(error){results.push({name:'SQLite engine',ready:false,detail:error.message});}
  if(includePdfcraft){const {pdfcraftRelease}=await import('../lib/pdf-workspace.mjs');check('Advanced PDF editor '+pdfcraftRelease.version,()=>{if(!existsSync(join(root,'vendor/pdfcraft',pdfcraftRelease.version,'index.html')))throw new Error('Run npm run setup. This obtains the pinned editor, with internet needed only during setup.');});}
  if(syntax)check('Application source syntax',()=>{
    const files=['server.mjs',...['lib','public','scripts'].flatMap(dir=>readdirSync(join(root,dir)).filter(name=>/\.(?:mjs|js)$/.test(name)).map(name=>dir+'/'+name))];
    for(const file of files)try{execFileSync(process.execPath,['--check',join(root,file)],{windowsHide:true,stdio:'pipe'});}catch{throw new Error('JavaScript syntax check failed: '+file);}
  });
  return results;
}
export function printReadiness(results){for(const result of results)console.log((result.ready?'Ready: ':'Missing: ')+result.name+(result.detail?' — '+result.detail:''));}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const results=await checkInstallation({syntax:true});printReadiness(results);
  console.log('Installation readiness only. Review document output, calculations and model quality separately.');
  if(results.some(result=>!result.ready))process.exitCode=1;
}
