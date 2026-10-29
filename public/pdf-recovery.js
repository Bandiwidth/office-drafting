const $=selector=>document.querySelector(selector);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const base64=bytes=>{let text='';for(let i=0;i<bytes.length;i+=8192)text+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(text);};
export function pdfRecovery({api,current,open,serialize,renderPage}){
  let session=null,serial=0,changes=0,saved=0,timer,pending=null,disabled=false,comparing=0,opening=0,comparisonBusy=false;
  const status=text=>$('#pdf-recovery-status').textContent=text;
  const action=fn=>async()=>{try{await fn();}catch(error){status(error.message);}};
  const list=async()=>{const rows=await api('/pdf/sessions');$('#pdf-session-list').innerHTML=rows.length?rows.map(row=>`<div class="pdf-session"><button data-session="${esc(row.id)}">${esc(row.name)}<small>v${row.version} · ${esc(new Date(row.updated).toLocaleString())}</small></button><button data-delete-session="${esc(row.id)}" aria-label="Delete saved PDF session ${esc(row.name)}">Delete</button></div>`).join(''):'<p class="hint">Saved PDFs appear here. Originals are retained.</p>';};
  const versions=async()=>{const mine=session?.id;if(!mine){$('#pdf-versions').innerHTML='';return;}const data=await api('/pdf/sessions/'+mine);if(session?.id!==mine)return;$('#pdf-versions').innerHTML=data.versions.map(row=>`<option value="${row.version}">v${row.version} · ${esc(row.label)}</option>`).join('');$('#pdf-checkpoint').disabled=false;$('#pdf-compare').disabled=false;$('#pdf-restore-version').disabled=false;};
  const schedule=()=>{clearTimeout(timer);timer=setTimeout(()=>save().catch(error=>status('Autosave failed: '+error.message+' Download a copy before closing.')),1400);};
  const changed=()=>{if(!session||disabled)return;changes++;status('PDF edits waiting to autosave…');schedule();};
  async function save(checkpoint=false){
    clearTimeout(timer);if(pending){await pending;return save(checkpoint);}if(!session||disabled||(!checkpoint&&saved===changes))return;
    if(current().busy){schedule();return;}
    if(!checkpoint&&document.activeElement?.closest('.freeTextEditor,.inkEditor')){schedule();return;}
    const generation=serial,id=session.id,version=session.version,captured=changes;
    pending=(async()=>{status('Saving PDF recovery copy…');const bytes=await serialize(checkpoint);if(generation!==serial)return;const updated=await api('/pdf/sessions/'+id,{method:'PUT',body:{version,base64:base64(bytes),checkpoint}});if(generation!==serial)return;session=updated;saved=captured;if(saved===changes)current().pdf?.annotationStorage.resetModified();status(saved===changes?'Saved locally · v'+session.version:'New edits waiting to autosave…');await versions();await list();if(saved!==changes)schedule();})();
    try{await pending;}finally{pending=null;}
  }
  async function opened(bytes,name,{existing,encrypted=false}={}){
    clearTimeout(timer);serial++;changes=saved=0;session=null;disabled=encrypted;$('#pdf-checkpoint').disabled=true;$('#pdf-compare').disabled=true;$('#pdf-restore-version').disabled=true;$('#pdf-versions').innerHTML='';$('#pdf-comparison').hidden=true;comparing++;
    if(encrypted){status('Password-protected PDF: recovery is disabled to avoid saving an unencrypted copy. Use Download.');return;}
    try{session=existing||await api('/pdf/sessions',{method:'POST',body:{name,base64:base64(bytes)}});status('Saved locally · v'+session.version);await versions();await list();}catch(error){status('Recovery unavailable: '+error.message+' Download your edits before closing.');}
  }
  async function resume(id){const navigation=++opening;await save();const generation=serial,data=await api('/pdf/sessions/'+id),bytes=new Uint8Array(await api('/pdf/sessions/'+id+'/content?version='+data.session.version,{bytes:true})),original=new Uint8Array(await api('/pdf/sessions/'+id+'/content?version=original',{bytes:true}));if(navigation!==opening||generation!==serial)return;await open(bytes,data.session.name,{existing:data.session,original});}
  $('#pdf-session-list').onclick=async event=>{try{const selected=event.target.closest('[data-session]'),deleted=event.target.closest('[data-delete-session]');if(selected)await resume(selected.dataset.session);if(deleted&&confirm('Delete this PDF recovery session and its saved versions? Downloaded files and letter references remain.')){await api('/pdf/sessions/'+deleted.dataset.deleteSession,{method:'DELETE'});if(session?.id===deleted.dataset.deleteSession){serial++;clearTimeout(timer);session=null;disabled=true;status('Recovery session deleted. Reopen the PDF to start a new session.');$('#pdf-checkpoint').disabled=true;$('#pdf-compare').disabled=true;$('#pdf-restore-version').disabled=true;$('#pdf-comparison').hidden=true;}await list();}}catch(error){status(error.message);}};
  $('#pdf-checkpoint').onclick=action(()=>save(true));
  $('#pdf-restore-version').onclick=action(async()=>{if(!session)return;if(!confirm('Restore the selected saved version? Current edits will be checkpointed first.'))return;const selected=Number($('#pdf-versions').value);await save(true);const updated=await api('/pdf/sessions/'+session.id+'/restore',{method:'POST',body:{version:session.version,restoreVersion:selected}});await resume(updated.id);});
  $('#pdf-compare').onclick=action(async()=>{
    if(!session||comparisonBusy)return;comparisonBusy=true;$('#pdf-compare').disabled=true;
    try{const selected=Number($('#pdf-versions').value);await save();if(!session)return;const mine=++comparing,id=session.id,version=session.version,page=Number($('#pdf-page').value)||1;
    const before=new Uint8Array(await api('/pdf/sessions/'+id+'/content?version='+selected,{bytes:true})),after=new Uint8Array(await api('/pdf/sessions/'+id+'/content',{bytes:true}));
    const panel=$('#pdf-comparison');panel.hidden=false;$('#pdf-compare-note').textContent='Rendering page '+page+' · saved v'+selected+' and current saved v'+version+'…';
    const results=await Promise.all([renderPage(before,page,$('#pdf-before')),renderPage(after,page,$('#pdf-after'))]);if(mine!==comparing)return;
    $('#pdf-compare-note').textContent='Page '+page+' · v'+selected+' → v'+version+'. '+(results[0].text===results[1].text?'Extracted page text is unchanged.':'Extracted page text differs.')+' Compare the page images for forms, annotations and layout. This is not a complete document diff.';
    }finally{comparisonBusy=false;$('#pdf-compare').disabled=!session;}
  });
  $('#pdf-compare-close').onclick=()=>{comparing++;$('#pdf-comparison').hidden=true;};
  window.addEventListener('pagehide',()=>{clearTimeout(timer);});
  return {changed,opened,save,list,resume,hasUnsaved:()=>session&&!disabled?changes!==saved||!!pending:current().dirty};
}
