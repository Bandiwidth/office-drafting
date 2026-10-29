// Runs inside an opaque-origin sandbox. Receives document bytes from the parent;
// no credential, API, file, navigation, or external network access is needed.
let renderVersion=0;
window.addEventListener('message',async event=>{
  if(event.source!==window.parent||event.data?.type!=='render-docx'||!(event.data.bytes instanceof ArrayBuffer)||event.data.bytes.byteLength>60*1024*1024)return;
  const current=++renderVersion,status=document.getElementById('status');
  status.textContent='Rendering the generated DOCX…';
  try{
    const body=document.getElementById('render');body.replaceChildren();
    await window.docx.renderAsync(event.data.bytes,body,null,{renderAltChunks:false,renderComments:false,renderChanges:false,useBase64URL:true,breakPages:true,ignoreLastRenderedPageBreak:false});
    if(current===renderVersion)status.textContent='DOCX preview · check the exported file and PDF print preview before issue.';
  }catch{status.textContent='This document could not be rendered in the browser. Use the Word download to review it.';}
});
window.parent.postMessage({type:'docx-preview-ready'},'*');
