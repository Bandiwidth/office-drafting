import {createRequire} from 'node:module';
import {existsSync,readFileSync} from 'node:fs';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {referenceStatus,referencePackages} from './references.mjs';
import {financeStatus,financePackages} from './finance.mjs';

const require=createRequire(import.meta.url),root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
function optional(name){try{return require(name);}catch(e){if(e.code==='MODULE_NOT_FOUND')return null;throw e;}}
const Docxtemplater=optional('docxtemplater'),PizZip=optional('pizzip');
export const templateEngineAvailable=!!(Docxtemplater&&PizZip);
const packageDir=name=>join(root,'node_modules',name);
export const vendorFiles={
  '/vendor/jszip.min.js':join(packageDir('jszip'),'dist','jszip.min.js'),
  '/vendor/docx-preview.min.js':join(packageDir('docx-preview'),'dist','docx-preview.min.js')
};
export function openSourceStatus(){
  const packages=Object.fromEntries(['docxtemplater','pizzip','docx-preview','jszip',...referencePackages,...financePackages].map(name=>{
    const manifest=join(packageDir(name),'package.json');return [name,existsSync(manifest)?JSON.parse(readFileSync(manifest,'utf8')).version:null];
  }));
  return {templateEngine:templateEngineAvailable?'docxtemplater':'basic fallback',docxPreview:Object.values(vendorFiles).every(existsSync),references:referenceStatus(),finance:financeStatus(),packages};
}
export function renderApprovedTemplate(buffer,context,allowedFields){
  if(!templateEngineAvailable)throw new Error('Install the open-source document components first.');
  const allowed=new Set(allowedFields);
  const document=new Docxtemplater(new PizZip(buffer),{
    delimiters:{start:'{{',end:'}}'},paragraphLoop:true,linebreaks:true,
    // Only direct, approved field names. No expression evaluator or raw XML.
    parser:tag=>{if(!allowed.has(tag))throw new Error('Unsupported template field: '+tag);return {get:scope=>Object.hasOwn(scope,tag)?scope[tag]:''};},
    nullGetter:()=>''
  });
  document.render(context);
  return document.getZip().generate({type:'nodebuffer',compression:'DEFLATE'});
}
