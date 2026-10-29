import {parentPort,workerData} from 'node:worker_threads';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdirSync,unlinkSync,rmdirSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {referenceOptions,referenceLimits,imageDimensions,pdfTextBlocks,ocrBlocks,finishExtraction,normalBox} from './reference-core.mjs';
import {languageFile,referenceStatus} from './references.mjs';
import {candidates} from './documents.mjs';

const require=createRequire(import.meta.url),options=referenceOptions(workerData),bytes=Buffer.from(workerData.bytes),status=referenceStatus();
const progress=value=>parentPort.postMessage({type:'progress',value});
let ocr,pdfTask,languageDir,currentPage=1,pageCount=1;
const canOcr=status.ocr&&options.language.split('+').every(code=>status.languages[code]);
async function recognize(image,width,height){
  if(!canOcr)throw new Error('The bundled OCR language component is missing. Stop the app, run npm ci --ignore-scripts and npm run setup in the project folder, then npm start.');
  if(!ocr){const {createWorker}=require('tesseract.js');languageDir=join(workerData.workspace,'languages');mkdirSync(languageDir);
    // Tesseract 7 initializes object-form languages using their data as a name.
    // Use language codes and a local directory for both English and Telugu.
    for(const code of options.language.split('+'))writeFileSync(join(languageDir,code+'.traineddata'),gunzipSync(readFileSync(languageFile(code)),{maxOutputLength:64*1024*1024}));
    ocr=await createWorker(options.language,1,{cacheMethod:'none',gzip:false,langPath:languageDir,errorHandler:()=>{},logger:event=>progress({status:'Page '+currentPage+': '+event.status,progress:(currentPage-1+Math.max(0,Math.min(1,event.progress||0)))/pageCount})});
  }
  const {data}=await ocr.recognize(image,{}, {text:true,tsv:true});return ocrBlocks(data,currentPage,width,height);
}
async function loadPdf(){
  if(!status.pdfText)throw new Error('The bundled PDF component is missing. Stop the app, run npm ci --ignore-scripts and npm run setup in the project folder, then npm start.');
  const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs'),base=dirname(require.resolve('pdfjs-dist/package.json'));
  const localDirectory=name=>join(base,name).replaceAll('\\','/')+'/';
  pdfTask=pdfjs.getDocument({data:new Uint8Array(bytes),isEvalSupported:false,enableXfa:false,useWorkerFetch:false,useSystemFonts:true,maxImageSize:referenceLimits.pixels,canvasMaxAreaInBytes:referenceLimits.pixels*4,cMapUrl:localDirectory('cmaps'),cMapPacked:true,standardFontDataUrl:localDirectory('standard_fonts'),wasmUrl:localDirectory('wasm'),disableAutoFetch:true,disableStream:true});
  const pdf=await pdfTask.promise;if(pdf.numPages>referenceLimits.pages)throw new Error('PDF exceeds the 30-page limit. Split it into smaller files.');pageCount=pdf.numPages;return pdf;
}
async function render(page,preview=false){
  const basic=page.getViewport({scale:1});if(!Number.isFinite(basic.width)||!Number.isFinite(basic.height)||basic.width<=0||basic.height<=0)throw new Error('Invalid PDF page dimensions.');
  const scale=Math.min(preview?1.5:3,Math.sqrt((preview?2_000_000:referenceLimits.pixels)/(basic.width*basic.height)),6000/basic.width,6000/basic.height),viewport=page.getViewport({scale});
  const {createCanvas}=require('@napi-rs/canvas'),canvas=createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height));
  try{await page.render({canvasContext:canvas.getContext('2d'),viewport,background:'rgb(255,255,255)'}).promise;return {image:canvas.toBuffer('image/png'),width:canvas.width,height:canvas.height};}finally{canvas.width=canvas.height=1;}
}
async function main(){
  if(workerData.operation==='table'){
    if(workerData.mime!=='.pdf')throw new Error('Choose a PDF reference.');const pdf=await loadPdf();if(workerData.page>pdf.numPages)throw new Error('That page is not in the PDF.');currentPage=workerData.page;const page=await pdf.getPage(currentPage);try{const viewport=page.getViewport({scale:1});let words=[],method='pdf-text';if(options.mode!=='ocr')for(const item of (await page.getTextContent()).items){if(!item.str?.trim()||!Array.isArray(item.transform))continue;const t=item.transform,h=Math.abs(item.height||Math.hypot(t[2],t[3])||10),rect=[...viewport.convertToViewportPoint(t[4],t[5]),...viewport.convertToViewportPoint(t[4]+Math.abs(item.width||1),t[5]+h)],x=Math.min(rect[0],rect[2]),y=Math.min(rect[1],rect[3]);words.push({text:item.str,bbox:normalBox(x,y,Math.abs(rect[2]-rect[0]),Math.abs(rect[3]-rect[1]),viewport.width,viewport.height),uncertain:false});}if(!words.length){if(!canOcr)throw new Error('This page needs the selected local OCR language components.');const image=await render(page),blocks=await recognize(image.image,image.width,image.height);words=blocks.flatMap(block=>block.words?.length?block.words:[block]);method='ocr';}if(words.length>20000||words.reduce((n,word)=>n+word.text.length,0)>referenceLimits.text)throw new Error('Table text exceeds the bounded extraction limit. Split the page first.');return {page:currentPage,method,words};}finally{page.cleanup();}
  }
  if(workerData.operation==='searchable'){
    if(!canOcr)throw new Error('Install the selected local OCR language components first.');const {PDFDocument,loadImage,createCanvas}=require('@napi-rs/canvas');if(!PDFDocument)throw new Error('Update the local canvas components for searchable PDF generation.');
    const output=new PDFDocument({title:'Searchable OCR copy',creator:'Office Drafting · local OCR',encodingQuality:101,compressionLevel:6});let total=0,uncertain=0;
    const addPage=async(image,blocks,width,height)=>{const context=output.beginPage(width,height);context.fillStyle='#000';context.textBaseline='top';for(const block of blocks){uncertain+=block.uncertain?1:0;for(const word of block.words?.length?block.words:[block]){if(!word.bbox||!word.text.trim())continue;const [x,y,w,h]=word.bbox;context.font=Math.max(2,h*height*1.15)+'px "Nirmala UI", "Segoe UI", sans-serif';context.fillText(word.text,x*width,y*height,Math.max(1,w*width));total+=word.text.length;}}
      // Keep the scan visually intact: the searchable text is beneath its
      // opaque page image, rather than painted over the original lettering.
      const bitmap=await loadImage(image.image),opaque=createCanvas(bitmap.width,bitmap.height),paint=opaque.getContext('2d');try{paint.fillStyle='white';paint.fillRect(0,0,opaque.width,opaque.height);paint.drawImage(bitmap,0,0);context.drawImage(opaque,0,0,width,height);output.endPage();}finally{opaque.width=opaque.height=1;}};
    if(workerData.mime==='.pdf'){const pdf=await loadPdf();if(pdf.numPages>10)throw new Error('Searchable copies support up to 10 pages. Split this scan first.');const fields=await pdf.getFieldObjects();if(fields&&(fields.size||Object.keys(fields).length))throw new Error('Use a scanned PDF without interactive forms or signature fields.');for(currentPage=1;currentPage<=pdf.numPages;currentPage++){const page=await pdf.getPage(currentPage);try{const basic=page.getViewport({scale:1}),image=await render(page),blocks=await recognize(image.image,image.width,image.height);await addPage(image,blocks,basic.width,basic.height);}finally{page.cleanup();}}}
    else{const size=imageDimensions(bytes),blocks=await recognize(bytes,size.width,size.height),scale=Math.min(1,1200/Math.max(size.width,size.height));await addPage({image:bytes},blocks,size.width*scale,size.height*scale);}
    if(!total)throw new Error('OCR found no readable text. Check the scan and selected language.');const pdfBytes=output.close();if(pdfBytes.length>32*1024*1024)throw new Error('Searchable copy exceeds 32 MB. Split or resize the scan.');return {pdfBytes:new Uint8Array(pdfBytes),uncertain};
  }
  if(workerData.operation==='preview'){
    let image;
    if(workerData.mime==='.pdf'){const pdf=await loadPdf();if(workerData.page>pdf.numPages)throw new Error('That page is not in this PDF.');const page=await pdf.getPage(workerData.page);try{image=await render(page,true);}finally{page.cleanup();}}
    else{if(workerData.page!==1)throw new Error('An image has only one page.');imageDimensions(bytes);const {loadImage,createCanvas}=require('@napi-rs/canvas'),original=await loadImage(bytes),scale=Math.min(1,1100/original.width),canvas=createCanvas(Math.ceil(original.width*scale),Math.ceil(original.height*scale));try{canvas.getContext('2d').drawImage(original,0,0,canvas.width,canvas.height);image={image:canvas.toBuffer('image/png'),width:canvas.width,height:canvas.height};}finally{canvas.width=canvas.height=1;}}
    if(image.image.length>12*1024*1024)throw new Error('Page preview is too large. Download the original to review it.');
    return {...image,image:image.image.toString('base64')};
  }
  const blocks=[],pages=[];
  if(workerData.mime==='.pdf'){
    const pdf=await loadPdf();
    for(currentPage=1;currentPage<=pdf.numPages;currentPage++){
      progress({status:'Reading page '+currentPage+' of '+pageCount,progress:(currentPage-1)/pageCount});
      const page=await pdf.getPage(currentPage);let pageBlocks=[],method='pdf-text';
      try{
        if(options.mode!=='ocr')pageBlocks=pdfTextBlocks((await page.getTextContent()).items,page.getViewport({scale:1}),currentPage);
        if(!pageBlocks.some(block=>block.text.trim())){if(canOcr){const image=await render(page);pageBlocks=await recognize(image.image,image.width,image.height);method='ocr';}else method='unread';}
        blocks.push(...pageBlocks);pages.push({page:currentPage,method});finishExtraction(blocks,pages,options);
      }finally{page.cleanup();}
    }
  }else{const size=imageDimensions(bytes);blocks.push(...await recognize(bytes,size.width,size.height));pages.push({page:1,method:'ocr'});}
  const result=finishExtraction(blocks,pages,options);result.candidates=candidates(blocks);return result;
}
let result,failure;
try{result=await main();}
catch(error){failure=error.name==='PasswordException'?'This PDF is password protected. Upload an unlocked copy.':error.message||'Reference processing failed.';}
finally{try{await ocr?.terminate();}catch{}try{await pdfTask?.destroy();}catch{}if(languageDir){for(const code of options.language.split('+'))try{unlinkSync(join(languageDir,code+'.traineddata'));}catch{}try{rmdirSync(languageDir);}catch{}}}
parentPort.postMessage(failure?{type:'error',message:failure}:{type:'result',value:result});
