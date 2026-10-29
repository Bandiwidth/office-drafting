// One document transferred from the opening workspace; no API token or saved
// files are exposed in the URL. This page never fetches business records.
const owner=window.opener,status=document.getElementById('print-status'),button=document.getElementById('print-document');
let received=false;
const timer=setTimeout(()=>{if(!received)status.textContent='No document received. Close this preview and use the PDF button in your saved document.';},30000);
window.addEventListener('message',async event=>{
  if(received||!owner||event.source!==owner||event.origin!==location.origin||event.data?.type!=='print-document'||!(event.data.bytes instanceof ArrayBuffer)||event.data.bytes.byteLength>60*1024*1024)return;
  received=true;clearTimeout(timer);window.opener=null;
  try{
    document.title=String(event.data.title||'Document').slice(0,100)+' - PDF';
    await window.docx.renderAsync(event.data.bytes,document.getElementById('render'),null,{renderAltChunks:false,renderComments:false,renderChanges:false,useBase64URL:true,breakPages:true,ignoreLastRenderedPageBreak:false});
    const sections=[...document.querySelectorAll('section.docx')];if(!sections.length)throw Error('No printable document pages were produced.');
    let css='';sections.forEach((section,i)=>{
      const width=section.style.width,height=section.style.minHeight,valid=value=>/^\d+(?:\.\d+)?pt$/.test(value);
      if(!valid(width)||!valid(height))throw Error('Unsupported template page size.');
      const [top,right,bottom,left]=['Top','Right','Bottom','Left'].map(side=>section.style['padding'+side]||'0pt');
      if(![top,right,bottom,left].every(valid))throw Error('Unsupported template page margins.');
      const name='office'+i;section.style.page=name;section.dataset.printPage=name;
      // Physical page margins repeat on automatic overflow pages. Padding on a
      // single tall HTML section only protects the first/last page.
      css+='@page '+name+'{size:'+width+' '+height+';margin:'+top+' '+right+' '+bottom+' '+left+'}';
      css+='@media print{section[data-print-page="'+name+'"]{width:calc('+width+' - '+left+' - '+right+')!important;min-height:calc('+height+' - '+top+' - '+bottom+' - 1pt)!important;padding:0!important;overflow:visible!important;display:flex!important}section.docx>article{margin-bottom:auto!important}section.docx>header{position:static!important;margin:0!important;min-height:0!important;padding-bottom:12pt}section.docx>footer{position:static!important;margin:0!important;min-height:0!important;padding-top:12pt}}';
    });
    const style=document.createElement('style');style.textContent=css;document.head.append(style);
    await document.fonts.ready;
    await Promise.all([...document.images].map(img=>img.complete?Promise.resolve():new Promise((done,reject)=>{img.onload=done;img.onerror=()=>reject(Error('A document image could not be rendered.'));})));
    if([...document.images].some(img=>!img.naturalWidth))throw Error('A document image could not be rendered.');
    status.textContent='Ready. Review the document, then choose Print / save PDF.';button.disabled=false;
    owner.postMessage({type:'print-document-result',ok:true},location.origin);
  }catch(error){status.textContent='PDF preview failed. '+error.message+' Download DOCX; if components are missing, stop the app and run npm ci --ignore-scripts, npm run setup and npm start.';owner.postMessage({type:'print-document-result',ok:false},location.origin);}
});
button.onclick=()=>window.print();
if(owner)owner.postMessage({type:'print-document-ready'},location.origin);else{clearTimeout(timer);status.textContent='Open this preview using the PDF button in a saved document.';}
