import { unzip, zip } from './zip.mjs';
import { fields, value, resolveBody } from './core.mjs';
import {templateEngineAvailable,renderApprovedTemplate} from './open-source.mjs';
import {referenceLimits} from './reference-core.mjs';
import {randomUUID} from 'node:crypto';
import {cleanBodyFormat,bodyFormatText,bodyFormatXml} from './body-format.mjs';
export const xml = s => {const text=String(s);if(/[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]/u.test(text))throw new Error('Document text contains unsupported control characters. Remove them before export.');return text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');};
const decode = s => s.replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16))).replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(+n)).replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&');
export function inspectDocx(buffer) {
  const entries = unzip(buffer);
  if (!entries.has('word/document.xml') || !entries.has('[Content_Types].xml')) throw new Error('This is not a DOCX document.');
  for (const [name,data] of entries) {
    if (/vbaProject|embeddings\/|activeX\//i.test(name)) throw new Error('Embedded programs and objects are not supported.');
    if (name.endsWith('.xml') && /<w:(?:instrText|fldSimple|altChunk)\b/i.test(data.toString())) throw new Error('Word fields and embedded content are not supported. Convert fields to plain text first.');
    if (name.endsWith('.rels') && /TargetMode\s*=\s*["']External/i.test(data.toString())) throw new Error('Remove external links and linked objects before uploading this DOCX.');
  }
  return entries;
}
export function extractDocx(buffer) {
  const entries = inspectDocx(buffer), blocks=[];let extractedLength=0;
  for (const [part,data] of entries) {
    if (!/^word\/(document|header\d+|footer\d+)\.xml$/.test(part)) continue;
    let index=0;
    for (const m of data.toString().matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)) {
      index++; const text=Array.from(m[0].matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:(tab|br|cr)\b[^>]*\/?\s*>/g),token=>token[2]?(token[2]==='tab'?'\t':'\n'):decode(token[1])).join('');
      if (text.trim()) {extractedLength+=text.trim().length;if(extractedLength>referenceLimits.text||blocks.length>=referenceLimits.blocks)throw new Error('Reference text exceeds the extraction limit. Split the document into smaller references.');blocks.push({location:`${part}, paragraph ${index}`,text:text.trim()});}
    }
  }
  return {status:'extracted',blocks,candidates:candidates(blocks),notice:'DOCX paragraph locations are used; page numbering depends on rendering.'};
}
export function candidates(blocks) {
  const found=[];
  for (const b of blocks) {
    // Require a complete label and a separator; "reference" must never
    // backtrack to "ref" and manufacture "erence" as a reference number.
    const ref=b.text.match(/\b(?:reference|ref|letter[ \t]+no|no)\b\.?(?:[ \t]*[:\-][ \t]*|[ \t]+)([A-Z0-9][A-Z0-9/._-]{3,})/i);
    const evidence={...(b.page?{page:b.page}:{}),...(b.bbox?{bbox:b.bbox}:{}),...(b.method?{method:b.method}:{}),...(b.confidence!=null?{confidence:b.confidence}:{}),uncertain:b.uncertain===true};
    if(ref&&(/[0-9/._-]/.test(ref[1])||/^[A-Z]{4,}$/.test(ref[1]))) found.push({field:'priorReference',value:ref[1],source:b.location,...evidence});
    const date=b.text.match(/\b(\d{4}-\d{2}-\d{2}|\d{1,2}[/.]\d{1,2}[/.]\d{2,4})\b/);
    if(date) found.push({field:'priorDate',value:date[1],source:b.location,...evidence});
  }
  return found.slice(0,50);
}
export function validateTemplate(buffer) {
  const entries=inspectDocx(buffer), allowed=new Set([...Object.keys(fields),'body']); let bodyCount=0;
  for(const [name,data] of entries) {
    if(!/^word\/.*\.xml$/.test(name)) continue;
    const raw=data.toString();
    const visible=Array.from(raw.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g),m=>decode(m[1])).join('');
    for(const token of visible.match(/\{\{[^}]+\}\}/g)||[]) {
      const key=token.slice(2,-2);
      if(!allowed.has(key)) throw new Error('Unsupported template placeholder: '+token);
      if(!raw.includes(token)&&!templateEngineAvailable) throw new Error('Placeholder '+token+' is split across Word formatting runs. Install the open-source document components or retype it with one style.');
      if(key==='body') bodyCount++;
    }
  }
  if(bodyCount!==1) throw new Error('A template needs exactly one {{body}} placeholder.');
  return entries;
}
function para(text,bold=false) { return `<w:p><w:pPr><w:spacing w:after="160" w:line="300" w:lineRule="auto"/></w:pPr><w:r><w:rPr>${bold?'<w:b/>':''}<w:rFonts w:ascii="Nirmala UI" w:hAnsi="Nirmala UI" w:cs="Nirmala UI"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr><w:t xml:space="preserve">${xml(text)}</w:t></w:r></w:p>`; }
export function makeDocx(task, templateBytes, isDraft = true, starter = false) {
  // Apply the XML text check before either template engine runs.
  xml(task.body);for(const fact of Object.values(task.facts))xml(fact.value);
  const format=!starter&&task.bodyFormat?cleanBodyFormat(task.bodyFormat):null,formatted=format&&bodyFormatText(format)===task.body;
  const resolve=text=>String(text).replace(/\{\{(\w+)\}\}/g,(_,key)=>fields[key]?value(task,key):'[UNKNOWN FIELD: '+key+']');
  const marker='OFFICE_BODY_'+randomUUID().replaceAll('-','');
  const insertFormatted=buffer=>{if(!formatted)return buffer;const entries=unzip(buffer);let count=0;for(const [name,data]of entries){if(!/^word\/.*\.xml$/.test(name))continue;const raw=data.toString().replace(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g,paragraph=>{if(!paragraph.includes(marker))return paragraph;const text=Array.from(paragraph.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g),m=>decode(m[1])).join('');if(text.trim()!==marker)throw new Error('Formatted bodies need {{body}} alone in its own template paragraph.');count++;return bodyFormatXml(format,resolve,{paragraphProperties:paragraph.match(/<w:pPr>([\s\S]*?)<\/w:pPr>/)?.[1]||'',runProperties:paragraph.match(/<w:rPr>([\s\S]*?)<\/w:rPr>/)?.[1]||''});});entries.set(name,Buffer.from(raw));}if(count!==1)throw new Error('The formatted body could not be placed in the approved template.');return zip(entries);};
  if(templateBytes) {
    const entries=validateTemplate(templateBytes);
    if(templateEngineAvailable){
      if(isDraft){const raw=entries.get('word/document.xml').toString();entries.set('word/document.xml',Buffer.from(raw.replace(/(<w:body[^>]*>)/,'$1'+para('DRAFT — FOR REVIEW',true))));}
      const context=Object.fromEntries(Object.keys(fields).map(k=>[k,value(task,k)]));context.body=formatted?marker:resolveBody(task);
      return insertFormatted(renderApprovedTemplate(zip(entries),context,[...Object.keys(fields),'body']));
    }
    for(const [name,data] of entries) if(/^word\/.*\.xml$/.test(name)) {
      let raw=data.toString().replace(/\{\{(\w+)\}\}/g,(_,key)=> {
        const text=key==='body' ? (formatted?marker:resolveBody(task)) : value(task,key);
        return xml(text).replace(/\r?\n/g,'</w:t><w:br/><w:t xml:space="preserve">');
      });
      if(isDraft && name==='word/document.xml') raw=raw.replace(/(<w:body[^>]*>)/,'$1'+para('DRAFT — FOR REVIEW',true));
      entries.set(name,Buffer.from(raw));
    }
    return insertFormatted(zip(entries));
  }
  const rows=[];
  if(isDraft) rows.push(para('DRAFT — FOR REVIEW',true));
  if(task.facts.office.value) rows.push(para(task.facts.office.value,true));
  rows.push(para('From: '+value(task,'sender')),para('To: '+value(task,'recipient')),para('Date: '+value(task,'date')));
  if(task.facts.reference.value) rows.push(para('Ref: '+task.facts.reference.value));
  rows.push(para('Subject: '+value(task,'subject'),true));
  if(formatted)rows.push(bodyFormatXml(format,resolve,{paragraphProperties:'<w:spacing w:after="160" w:line="300" w:lineRule="auto"/>',runProperties:'<w:rFonts w:ascii="Nirmala UI" w:hAnsi="Nirmala UI" w:cs="Nirmala UI"/><w:sz w:val="22"/>'}));else for(const p of (starter ? task.body : resolveBody(task)).split('\n')) rows.push(para(p));
  rows.push(para(''),para(value(task,'sender')));
  if(task.facts.attachments.value) rows.push(para('Enclosures: '+task.facts.attachments.value));
  return zip(new Map([
    ['[Content_Types].xml','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'],
    ['_rels/.rels','<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'],
    ['word/document.xml','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+rows.join('')+'<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>']
  ]));
}
