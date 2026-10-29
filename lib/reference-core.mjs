export const referenceEngine='office-reference-v1';
export const referenceLimits={pages:30,pixels:16_000_000,text:200_000,blocks:10000,confidence:80};
export function referenceOptions(input={}){
  const language=input.language||'eng',mode=input.mode||'auto';
  if(!['eng','tel','eng+tel'].includes(language))throw new Error('Choose English, Telugu, or English + Telugu for extraction.');
  if(!['auto','ocr'].includes(mode))throw new Error('Choose automatic extraction or OCR.');
  return {language,mode,force:input.force===true};
}
export function imageDimensions(bytes){
  let width,height;
  if(bytes.length>=24&&bytes.subarray(0,8).toString('hex')==='89504e470d0a1a0a'&&bytes.subarray(12,16).toString()==='IHDR'){width=bytes.readUInt32BE(16);height=bytes.readUInt32BE(20);}
  else if(bytes[0]===255&&bytes[1]===216){
    let i=2;
    while(i+3<bytes.length){if(bytes[i++]!==255)throw new Error('Damaged JPEG header.');while(bytes[i]===255)i++;if(i+2>=bytes.length)throw new Error('Damaged JPEG header.');const marker=bytes[i++];if(marker===0xd9||marker===0xda)break;if(marker===0x01||marker>=0xd0&&marker<=0xd7)continue;const length=bytes.readUInt16BE(i);if(length<2||i+length>bytes.length)throw new Error('Damaged JPEG header.');if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)){if(length<8)throw new Error('Damaged JPEG dimensions.');height=bytes.readUInt16BE(i+3);width=bytes.readUInt16BE(i+5);break;}i+=length;}
  }
  if(!width||!height)throw new Error('The image dimensions could not be read. Use a valid PNG or JPEG.');
  if(width*height>referenceLimits.pixels||width>12000||height>12000)throw new Error('Image exceeds the 16-megapixel OCR limit. Resize it first.');
  return {width,height};
}
export function normalBox(x,y,width,height,pageWidth,pageHeight){
  if(![x,y,width,height,pageWidth,pageHeight].every(Number.isFinite)||pageWidth<=0||pageHeight<=0)throw new Error('Invalid source-page coordinates.');
  const clamp=n=>Math.max(0,Math.min(1,n)),x0=clamp(x/pageWidth),y0=clamp(y/pageHeight),x1=clamp((x+width)/pageWidth),y1=clamp((y+height)/pageHeight);
  return [x0,y0,Math.max(0,x1-x0),Math.max(0,y1-y0)];
}
export function pdfTextBlocks(items,viewport,page){
  const blocks=[];let line=[],lastY;
  const flush=()=>{if(!line.length)return;const text=line.map(i=>i.str).join(' ').replace(/\s+/g,' ').trim();if(text){const boxes=line.map(item=>{const t=item.transform,x=t[4],y=t[5],h=Math.abs(item.height||Math.hypot(t[2],t[3])||10),w=Math.abs(item.width||1);const r=typeof viewport.convertToViewportRectangle==='function'?viewport.convertToViewportRectangle([x,y,x+w,y+h]):[...viewport.convertToViewportPoint(x,y),...viewport.convertToViewportPoint(x+w,y+h)];return [Math.min(r[0],r[2]),Math.min(r[1],r[3]),Math.max(r[0],r[2]),Math.max(r[1],r[3])];});const x=Math.min(...boxes.map(b=>b[0])),y=Math.min(...boxes.map(b=>b[1])),right=Math.max(...boxes.map(b=>b[2])),bottom=Math.max(...boxes.map(b=>b[3]));blocks.push({text,page,location:'Page '+page+', line '+(blocks.length+1),method:'pdf-text',bbox:normalBox(x,y,right-x,bottom-y,viewport.width,viewport.height),confidence:null,uncertain:false});}line=[];};
  if(items.length>50000)throw new Error('PDF page contains too many text fragments. Split the document first.');
  for(const item of items){if(typeof item.str!=='string'||!Array.isArray(item.transform)||item.transform.length!==6||!item.transform.every(Number.isFinite))continue;const y=item.transform[5];if(lastY!==undefined&&Math.abs(lastY-y)>Math.max(3,Math.abs(item.height||10)*0.6))flush();line.push(item);lastY=y;if(item.hasEOL)flush();}flush();return blocks;
}
export function ocrBlocks(data,page,width,height){
  const lines=new Map();
  for(const row of String(data.tsv||'').split(/\r?\n/).slice(1)){
    const c=row.split('\t');if(c.length<12||c[0]!=='5')continue;
    const text=c.slice(11).join('\t').trim(),coords=c.slice(6,10).map(Number),raw=Number(c[10]),confidence=Number.isFinite(raw)&&raw>=0?Math.min(100,raw):null;if(!text||!coords.every(Number.isFinite))continue;
    const key=c.slice(1,5).join('/'),word={text,confidence,uncertain:confidence===null||confidence<referenceLimits.confidence,bbox:normalBox(...coords,width,height)};
    if(!lines.has(key))lines.set(key,[]);lines.get(key).push(word);
  }
  const blocks=[];
  for(const words of lines.values()){
    const x=Math.min(...words.map(w=>w.bbox[0])),y=Math.min(...words.map(w=>w.bbox[1])),right=Math.max(...words.map(w=>w.bbox[0]+w.bbox[2])),bottom=Math.max(...words.map(w=>w.bbox[1]+w.bbox[3]));
    const confidence=words.every(w=>w.confidence!==null)?Math.min(...words.map(w=>w.confidence)):null;
    blocks.push({text:words.map(w=>w.text).join(' '),page,location:'Page '+page+', OCR line '+(blocks.length+1),method:'ocr',bbox:[x,y,right-x,bottom-y],words,confidence,uncertain:words.some(w=>w.uncertain)});
  }
  if(!blocks.length&&String(data.text||'').trim())blocks.push({text:String(data.text).trim(),page,location:'Page '+page+', OCR text',method:'ocr',bbox:null,confidence:null,uncertain:true});
  return blocks;
}
export function finishExtraction(blocks,pages,options){
  if(blocks.length>referenceLimits.blocks||blocks.reduce((n,b)=>n+b.text.length,0)>referenceLimits.text)throw new Error('Extracted text exceeds the limit. Split the document first.');
  const unread=pages.filter(p=>p.method==='unread'),uncertain=blocks.filter(b=>b.uncertain).length;
  return {engine:referenceEngine,language:options.language,mode:options.mode,status:unread.length?'needs OCR':blocks.length?'extracted':'no text found',blocks,pages,notice:(unread.length?unread.length+' page(s) have no readable text. OCR components or the selected language data are unavailable. ':'')+(uncertain?uncertain+' OCR line(s) need particular attention. ':'')+'Extraction is not fact verification. All imported facts require confirmation; compare identifiers and dates against the original. PDF text boxes are approximate.'};
}
