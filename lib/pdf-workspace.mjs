import {existsSync,readFileSync,realpathSync,statSync} from 'node:fs';
import {resolve,relative,isAbsolute,extname} from 'node:path';

export const pdfcraftRelease=Object.freeze({version:'0.13.0',archive:'pdfcraft-web-0.13.0.zip',sha256:'b16bb14222f371bc5c8da9dc2ee39c77c35f748ffd953d738e4cb3241287b3c8',source:'https://github.com/storytold/pdfcraft',license:'MIT OR Apache-2.0'});
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.wasm':'application/wasm','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.ico':'image/x-icon','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf','.otf':'font/otf','.json':'application/json','.txt':'text/plain; charset=utf-8','.bcmap':'application/octet-stream','.pfb':'application/octet-stream','.icc':'application/octet-stream'};
function inside(root,file){const rel=relative(root,file);return rel&&!rel.startsWith('..')&&!isAbsolute(rel);}
export function pdfWorkspaceStatus(root=resolve('.')){return {allowInstall:!existsSync(resolve(root,'release-manifest.json')),review:existsSync(resolve(root,'node_modules/pdfjs-dist/web/pdf_viewer.mjs')),pdfcraft:{...pdfcraftRelease,available:existsSync(resolve(root,'vendor/pdfcraft',pdfcraftRelease.version,'index.html')),alpha:true},limits:{bytes:12*1024*1024,pages:200}};}
export function pdfStaticAsset(pathname,root=resolve('.')){
  const craft=pathname.startsWith('/pdfcraft/'),pdfjs=pathname.startsWith('/vendor/pdfjs/');if(!craft&&!pdfjs)return null;
  let name;try{name=decodeURIComponent(pathname.slice(craft?10:14));}catch{return null;}
  if(craft&&!name)name='index.html';
  if(!name||name.includes('\\')||name.includes('\0')||name.split('/').some(p=>p==='..'||p==='.')||isAbsolute(name))return null;
  if(pdfjs&&!/^(?:build|web|cmaps|standard_fonts|wasm)\//.test(name))return null;
  const base=resolve(root,craft?'vendor/pdfcraft/'+pdfcraftRelease.version:'node_modules/pdfjs-dist'),file=resolve(base,name),type=types[extname(file)]||(craft?'application/octet-stream':null);
  if(!type||!inside(base,file)||!existsSync(file)||!statSync(file).isFile()||!inside(realpathSync(base),realpathSync(file)))return null;
  return {body:readFileSync(file),type,craft};
}
