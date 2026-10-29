import {existsSync,readdirSync,readFileSync,mkdirSync,copyFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {referencePackages} from '../lib/references.mjs';
import {financePackages} from '../lib/finance.mjs';
const source=resolve('node_modules'),output=resolve('third-party-licenses');mkdirSync(output,{recursive:true});
const packages=[];
function collect(directory){
  if(!existsSync(directory))return;
  for(const entry of readdirSync(directory,{withFileTypes:true})){
    if(!entry.isDirectory()||entry.name.startsWith('.'))continue;
    const folder=join(directory,entry.name);
    if(entry.name.startsWith('@')){collect(folder);continue;}
    const manifest=join(folder,'package.json');if(!existsSync(manifest))continue;
    const p=JSON.parse(readFileSync(manifest,'utf8')),destination=join(output,p.name.replace(/[\\/@]/g,'_')+'-'+p.version);mkdirSync(destination,{recursive:true});
    const files=readdirSync(folder).filter(name=>/^(?:licen[cs]e|copying|notice)(?:\.|$)/i.test(name));
    for(const name of files)copyFileSync(join(folder,name),join(destination,name));
    // xlsx-calc publishes its MIT notice in README in some releases.
    if(p.name==='xlsx-calc'&&!files.length&&existsSync(join(folder,'README.md'))){const readme=readFileSync(join(folder,'README.md'),'utf8'),start=readme.search(/^#+\s*MIT LICENSE\s*$/im),notice=readme.slice(start);if(start>=0&&/Copyright/.test(notice)&&/Permission is hereby granted/.test(notice)){const name='LICENSE-from-README.txt';writeFileSync(join(destination,name),notice);files.push(name);}}
    // These published data archives omit their upstream LICENSE. Preserve the
    // exact upstream data licence plus the wrapper's supplied MIT declaration,
    // rather than inventing a wrapper copyright or failing every Windows update.
    if(['@tesseract.js-data/eng','@tesseract.js-data/tel'].includes(p.name)&&p.version==='1.0.0'&&!files.length){
      const name='TESSDATA-UPSTREAM-LICENSE.txt';copyFileSync(resolve('scripts/notices/tessdata-upstream-LICENSE.txt'),join(destination,name));files.push(name);
      copyFileSync(manifest,join(destination,'package-metadata.json'));files.push('package-metadata.json');
      if(existsSync(join(folder,'README.md'))){copyFileSync(join(folder,'README.md'),join(destination,'README.md'));files.push('README.md');}
      const note='UPSTREAM-NOTICE.md';writeFileSync(join(destination,note),`# ${p.name} ${p.version}\n\nThe npm archive supplies no separate LICENSE file. Its package metadata declares ${p.license}; the original metadata, author information and README are preserved here. No wrapper copyright notice has been fabricated.\n\nThe trained-data upstream is https://github.com/naptha/tessdata . Its Apache-2.0 licence is preserved as TESSDATA-UPSTREAM-LICENSE.txt, retrieved from https://raw.githubusercontent.com/naptha/tessdata/gh-pages/LICENSE on 2026-10-21. This distinguishes the trained data's upstream licence from the npm wrapper's supplied declaration.\n`);files.push(note);
    }
    packages.push({name:p.name,version:p.version,license:p.license||'See package license',files});
    collect(join(folder,'node_modules'));
  }
}
collect(source);writeFileSync(join(output,'manifest.json'),JSON.stringify(packages,null,2));console.log(`Preserved notices for ${packages.length} installed packages in third-party-licenses/.`);
const missing=['docxtemplater','pizzip','docx-preview','jszip',...referencePackages,...financePackages].filter(name=>!packages.some(p=>p.name===name&&p.files.length));
if(missing.length){console.error('Missing components or notices: '+missing.join(', '));process.exitCode=1;}
