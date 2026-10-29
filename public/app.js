const $ = selector => document.querySelector(selector);
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const state = {token:'',task:null,tasks:[],sources:[],revisions:[],templates:[],settings:{},fields:{},dirty:0,saved:0,saving:null,tab:'preview',editing:false,proposal:null,undo:[],redo:[],abort:null};
let saveTimer,toastTimer,draftingTimer;
async function cancelWriting(){const controller=state.abort,task=state.aiTask,requestId=state.aiRequestId;controller?.abort();if(task&&requestId)await api('/tasks/'+task+'/assist-cancel',{method:'POST',body:{requestId}}).catch(()=>{});}
$('#cancel-writing').onclick=cancelWriting;
function toast(text,error=false){clearTimeout(toastTimer);$('#toast').textContent=text;$('#toast').classList.toggle('error',error);$('#toast').hidden=false;toastTimer=setTimeout(()=>$('#toast').hidden=true,error?12000:5000);}
async function api(path,options={}) {
  const headers={'X-Session-Token':state.token,...options.headers};
  if(options.body && typeof options.body!=='string'){headers['Content-Type']='application/json';options.body=JSON.stringify(options.body);}
  const r=await fetch('/api'+path,{...options,headers});
  if(!r.ok){let err;try{err=await r.json();}catch{}throw new Error(err?.error||'The local service is unavailable.');}
  return options.response?r:options.blob?r.blob():r.json();
}
function run(fn){return async event=>{try{await fn(event);}catch(e){toast(e.message,true);}};}
function dirty(){$('#task-diff').textContent='Document changed. Compare again after saving.';hideTemplatePreview();if(state.proposal){state.proposal=null;renderProposal();}state.dirty++;state.task.reviewed=false;$('#reviewed').checked=false;$('#save-status').textContent='Unsaved changes';clearTimeout(saveTimer);saveTimer=setTimeout(()=>flush().catch(e=>toast(e.message,true)),650);renderPaper();}
async function flush(checkpoint=false){
  clearTimeout(saveTimer);
  if(state.saving){await state.saving;if(state.dirty!==state.saved||checkpoint)return flush(checkpoint);return;}
  if(!state.task || (state.saved===state.dirty&&!checkpoint))return;
  state.saving=(async()=>{
    do {
      const captured=state.dirty, snapshot=structuredClone(state.task);$('#save-status').textContent='Saving…';
      const result=await api('/tasks/'+snapshot.id,{method:'PUT',body:{...snapshot,checkpoint}});
      state.task.version=result.version;state.task.updated=result.updated;state.task.issues=result.issues;state.task.writingGuidance=result.writingGuidance;state.saved=captured;
      if(state.dirty===captured){$('#save-status').textContent='Saved locally';renderIssues();renderWritingGuidance();}
      checkpoint=false;
    }while(state.saved!==state.dirty);
    const item=state.tasks.find(t=>t.id===state.task.id);if(item){item.title=state.task.title;item.type=state.task.type;item.updated=state.task.updated;}renderTasks();
  })();
  try{await state.saving;}catch(e){$('#save-status').textContent='Save failed · retry by editing';throw e;}finally{state.saving=null;}
}
async function loadTask(id){
  if(state.proposal&&!confirm('Discard the suggested letter and open another document? Accept it first to save it.'))return;
  const navigation=state.navigation=(state.navigation||0)+1;await flush();if(navigation!==state.navigation)return;
  const data=await api('/tasks/'+id);if(navigation!==state.navigation)return;
  state.abort?.abort();state.sourceAbort?.abort();state.sourceView=null;$('#source-dialog').close();state.task=data.task;state.sources=data.sources;state.revisions=data.revisions;state.saved=state.dirty=0;state.proposal=null;state.undo=[];state.redo=[];render();
}
async function applyMutationResult(result,snapshot){
  if(state.saving)await state.saving.catch(()=>{});
  if(state.task?.id!==snapshot.id||state.task.version>result.version)return false;
  const changed={};
  for(const key of ['title','type','language','role','templateId','body','bodyFormat','actionAtDraft','messages','reviewed'])if(JSON.stringify(state.task[key])!==JSON.stringify(snapshot[key]))changed[key]=structuredClone(state.task[key]);
  const facts=structuredClone(result.facts);let factChanged=false;
  for(const key of Object.keys(facts))if(JSON.stringify(state.task.facts[key])!==JSON.stringify(snapshot.facts[key])){facts[key]=structuredClone(state.task.facts[key]);factChanged=true;}
  state.task={...result,...changed,facts};state.dirty=state.saved=0;
  if(Object.keys(changed).length||factChanged){dirty();await flush();}
  return true;
}
async function newTask({edit=false}={}){
  if(state.creating)return;
  if(state.proposal&&!confirm('Discard the suggested letter and start a new document? Accept it first to save it.'))return;
  state.creating=true;
  const buttons=['#new-task','#new-task-main','#new-task-editor'].map($);buttons.forEach(button=>button.disabled=true);
  try{
    await flush();const task=await api('/tasks',{method:'POST'});state.tasks.unshift(task);state.proposal=null;await loadTask(task.id);
    if(state.task?.id!==task.id)return;
    $('#instruction').value='';switchTab('preview');state.editing=edit;hideTemplatePreview();$('#body-editor').hidden=!edit;$('#edit-toggle').textContent=edit?'Read preview':'Edit body';
    if(edit)$('#body-text').focus();
    toast(edit?'New document ready. Type or paste your text.':'New document created.');
  }finally{state.creating=false;buttons.forEach(button=>button.disabled=false);}
}
function render(){
  hideTemplatePreview();
  $('#task-title').value=state.task.title;$('#document-type').value=state.task.type;$('#language').value=state.task.language;$('#role').value=state.task.role;$('#body-text').value=state.task.body;$('#reviewed').checked=state.task.reviewed;$('#save-status').textContent='Saved locally';
  renderTasks();renderSources();renderFacts();renderPaper();renderIssues();renderHistory();renderMessages();renderProposal();renderProvider();renderTemplateLabel();renderWritingGuidance();switchTab(state.tab);window.officeWriting?.syncEditor();renderIssuedLock();
}
function renderIssuedLock(){
 const locked=!!state.task.issued,banner=$('#issued-banner');if(banner){banner.hidden=!locked;$('#issued-link').href='/office?tab=register&task='+state.task.id;}
 const selectors='#task-title,#document-type,#language,#role,#body-text,#generate,#generate-template,#send,#instruction,#undo,#redo,#edit-toggle,#reviewed,#checkpoint,#delete-task,#export-docx,#export-pdf,#review-export,#render-template,#history-list [data-revision],#upload,#templates-open,#writing-tools-open,#fact-fields input,#fact-fields textarea,#fact-fields [data-confirm],.remove-source,#rich-toggle,#rich-toolbar button,#rich-toolbar input';
 document.querySelectorAll(selectors).forEach(element=>{if(locked){if(!element.hasAttribute('data-issued-disabled'))element.setAttribute('data-issued-disabled',element.disabled?'yes':'no');element.disabled=true;}else if(element.hasAttribute('data-issued-disabled')){element.disabled=element.getAttribute('data-issued-disabled')==='yes';element.removeAttribute('data-issued-disabled');}});
 const rich=document.querySelector('#rich-body');if(rich)rich.contentEditable=locked?'false':'true';
}
function renderWritingGuidance(){const notes=state.task.writingGuidance||[];$('#writing-guidance').hidden=!notes.length;$('#writing-guidance').innerHTML=notes.length?'<strong>Details for a more useful letter</strong>'+notes.map(n=>'<p>'+escapeHTML(n)+'</p>').join(''):'';}
function renderTasks(){const query=$('#search').value.toLowerCase();$('#task-count').textContent=state.tasks.length;$('#task-list').innerHTML=state.tasks.filter(t=>t.title.toLowerCase().includes(query)).map(t=>`<button class="task-item ${t.id===state.task?.id?'selected':''}" data-task="${escapeHTML(t.id)}"><span class="file-glyph">▤</span><div><strong>${escapeHTML(t.title)}</strong><small>${escapeHTML(t.type)} · ${new Date(t.updated).toLocaleDateString(undefined,{month:'short',day:'numeric'})}</small></div></button>`).join('')||'<p class="empty-list">No documents found.</p>';}
function renderSources(){$('#source-count').textContent=state.sources.length;$('#source-list').innerHTML=state.sources.map(s=>`<div class="source-item"><span>▧</span><button data-source="${escapeHTML(s.id)}"><strong>${escapeHTML(s.name)}</strong><small>${escapeHTML(s.status)}</small></button><button class="remove-source" data-delete-source="${escapeHTML(s.id)}" aria-label="Delete ${escapeHTML(s.name)}">×</button></div>`).join('');}
function workbookEvidence(source){const match=/^Workbook ([a-f0-9-]+) \| v(\d+) \| (.*)!([A-Z]{1,2}[1-9]\d*) \| (text|money)$/.exec(source);return match?'<a class="text-button workbook-evidence" target="_blank" rel="noopener" href="/finance?workbook='+encodeURIComponent(match[1])+'&amp;sheet='+encodeURIComponent(match[3])+'&amp;cell='+encodeURIComponent(match[4])+'&amp;sourceVersion='+match[2]+'">View spreadsheet source →</a>':'';}
function renderFacts(){
  $('#fact-fields').innerHTML=Object.entries(state.fields).map(([key,label])=>{const f=state.task.facts[key];return `<div class="fact-card"><label>${escapeHTML(label)}${['action','attachments','approval'].includes(key)?`<textarea rows="3" data-fact="${key}">${escapeHTML(f.value)}</textarea>`:`<input data-fact="${key}" value="${escapeHTML(f.value)}" ${['date','priorDate'].includes(key)?'placeholder="YYYY-MM-DD"':''}>`}</label>${f.source?`<p class="fact-source">Source: ${escapeHTML(f.source)}</p>${workbookEvidence(f.source)}${state.sources.some(s=>f.source.startsWith(s.id+' | '))?`<button class="text-button" data-fact-source="${key}">View reference evidence →</button>`:''}`:''}<div class="fact-bottom"><span>${escapeHTML(f.provenance)}</span><button class="fact-confirm ${f.confirmed?'confirmed':''}" data-confirm="${key}" ${!f.value.trim()?'disabled':''}>${f.confirmed?'✓ Confirmed':'Confirm fact'}</button></div></div>`;}).join('');
  $('#facts-badge').textContent=Object.values(state.task.facts).filter(f=>f.confirmed&&f.value).length;
  $('#fact-fields').querySelectorAll('[data-fact]').forEach(showDateError);
}
function invalidDate(key,value){return ['date','priorDate'].includes(key)&&!!value&&(!/^\d{4}-\d{2}-\d{2}$/.test(value)||Number.isNaN(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value);}
function showDateError(el){const key=el.dataset.fact;if(!['date','priorDate'].includes(key))return;const bad=invalidDate(key,el.value);el.setAttribute('aria-invalid',String(bad));const card=el.closest('.fact-card');let warning=card.querySelector('.date-error');if(!warning){warning=document.createElement('p');warning.className='date-error';card.appendChild(warning);}warning.textContent=bad?'Invalid date. Enter a real YYYY-MM-DD date; month must be 01–12.':'';warning.hidden=!bad;card.querySelector('[data-confirm]').disabled=bad||!el.value.trim();}
function fact(key){const facts=state.proposal?.proposedFacts||state.task.facts;const v=facts[key]?.value?.trim();return v?escapeHTML(v):`<span class="placeholder">[${escapeHTML(state.fields[key]||key)}]</span>`;}
function renderPaper(){
  const t=state.proposal?.proposedFacts?{...state.task,facts:state.proposal.proposedFacts,type:state.proposal.proposedType,language:state.proposal.proposedLanguage||state.task.language}:state.task;if(!t)return;
  const displayed=state.proposal?.body??t.body;
  const body=displayed?(window.officeWriting?.renderBody(t,displayed,fact)||escapeHTML(displayed).replace(/\{\{(\w+)\}\}/g,(_,k)=>fact(k))):'<div class="empty-body">Your document starts here.<br>Add the facts, then create a template draft.</div>';
  $('#paper').innerHTML=`<div class="draft-tag">DRAFT · FOR YOUR REVIEW</div>${t.facts.office.value?`<div class="letter-office">${fact('office')}</div>`:''}<div class="letter-meta">From: ${fact('sender')}<br>To: ${fact('recipient')}<br>Date: ${fact('date')}${t.facts.reference.value?'<br>Ref: '+fact('reference'):''}</div><div class="letter-subject">Subject: ${fact('subject')}</div><div class="letter-body">${body}</div><div class="letter-sign">${fact('sender')}</div>${t.facts.attachments.value?'<div class="attachments">Enclosures:<br>'+fact('attachments')+'</div>':''}`;
}
function renderIssues(){const issues=state.task.issues||[];$('#issues-badge').textContent=issues.filter(i=>i.severity==='blocking').length;$('#issue-list').innerHTML=issues.map(i=>`<div class="issue ${i.severity==='warning'?'warning':''}"><small>${escapeHTML(i.severity==='blocking'?'Needs attention':'Review note')}</small>${escapeHTML(i.message)}</div>`).join('')||'<div class="issue warning">Automated checks passed. Verify the final Word/PDF layout before issue.</div>';$('#reviewed').checked=state.task.reviewed;}
function renderHistory(){$('#history-list').innerHTML=state.revisions.map(r=>`<div class="history-item"><div><strong>${escapeHTML(r.label)}</strong><small>${new Date(r.created).toLocaleString()}</small></div><button data-revision="${escapeHTML(r.id)}">Restore</button></div>`).join('');for(const key of ['from','to']){const select=$('#task-diff-'+key),old=select.value;select.innerHTML=(key==='to'?'<option value="current">Current saved document</option>':'')+state.revisions.map(r=>`<option value="${escapeHTML(r.id)}">${escapeHTML(r.label)} · ${escapeHTML(new Date(r.created).toLocaleString())}</option>`).join('');if(key==='from'&&state.revisions.some(r=>r.id===old))select.value=old;}$('#task-diff').textContent='';}
$('#compare-task').onclick=run(async()=>{const id=state.task.id;await flush();if(state.task.id!==id)return;const version=state.task.version,from=$('#task-diff-from').value,to=$('#task-diff-to').value||'current';if(!from)throw new Error('Save a checkpoint before comparing versions.');const diff=await api('/tasks/'+id+'/compare?from='+encodeURIComponent(from)+'&to='+encodeURIComponent(to));if(diff.version!==version)throw new Error('Document changed in another tab. Reopen it before comparing.');if(state.task.id!==id||state.task.version!==version||state.dirty!==state.saved)return;const value=fact=>escapeHTML((fact?.value||'[empty]')+' · '+(fact?.confirmed?'confirmed':'unconfirmed')+' ? '+(fact?.provenance||'source not set'));$('#task-diff').innerHTML='<h3>'+escapeHTML(diff.from)+' → '+escapeHTML(diff.to)+'</h3>'+(diff.changed?'':'<p>No changes between these versions.</p>')+diff.metadata.map(item=>'<p><strong>'+escapeHTML(item.field)+'</strong>: <del>'+escapeHTML(String(item.before))+'</del> → <ins>'+escapeHTML(String(item.after))+'</ins></p>').join('')+diff.facts.map(item=>'<div class="revision-change"><strong>'+escapeHTML(state.fields[item.field]?.label||item.field)+(item.protected?' · protected fact':'')+'</strong><p><del>'+value(item.before)+'</del> → <ins>'+value(item.after)+'</ins></p><small>Source: '+escapeHTML(item.before.source||'[none]')+' → '+escapeHTML(item.after.source||'[none]')+'</small></div>').join('')+'<h4>Body paragraphs</h4>'+diff.body.map(part=>'<div class="diff-'+part.type+'">'+escapeHTML(part.text||' ')+'</div>').join('');});
function renderMessages(){$('#messages').innerHTML=state.task.messages.map(m=>`<div class="message ${m.role==='user'?'user':''}"><strong>${m.role==='user'?'YOU':'OFFICE DRAFT'}</strong>${escapeHTML(m.text)}</div>`).join('');}
function renderProposal(){const p=state.proposal;$('#proposal').innerHTML=p?`<div class="proposal"><h3>${p.stage==='english'?'English wording · Telugu translation pending':'Your suggested letter is in the Document panel'}</h3><p class="hint">${p.translationMethod==='reviewed-text'?'Reviewed bilingual wording matched to the source':escapeHTML(p.provider)+' · '+escapeHTML(p.model)}. Review it, then accept to save and download.</p>${state.task.bodyFormat&&p.body!==state.task.body?'<p class="hint">Accepting new wording resets body formatting. The approved template still controls the page layout.</p>':''}<details><summary>Current wording</summary><pre>${escapeHTML(state.task.body)}</pre></details><div class="proposal-notes">${p.notes.map(n=>'<p>'+escapeHTML(n)+'</p>').join('')}New names or unsupported claims can still require correction.</div><div class="proposal-actions"><button id="accept-proposal" class="primary" ${p.stage==='english'&&state.submitting?'disabled':' '}>${p.stage==='english'?'Accept English wording':'Accept letter'}</button><button id="discard-proposal" class="secondary">Discard</button></div></div>`:'';$('#proposal-banner').hidden=!p;$('#export-docx').disabled=!!p;$('#export-pdf').disabled=!!p;renderPaper();}
function renderTemplateLabel(){const t=state.templates.find(t=>t.id===state.task.templateId);$('#template-label').textContent=t?t.name+(t.number?' · v'+t.number:'')+(t.status==='retired'?' · retired':t.approved?' · approved':' · unapproved'):'Starter format · draft only';renderLayoutAvailability();}
function renderLayoutAvailability(){
  const available=!!state.capabilities?.openSource?.docxPreview,button=$('#render-template');
  button.disabled=!available;button.textContent=available?'Layout preview':'Layout preview · setup needed';
  button.title=available?'View the generated Word document layout':'The bundled layout preview is missing. Stop the app, run npm ci --ignore-scripts and npm run setup in the project folder, then npm start.';
  const note=$('#layout-preview-note');note.hidden=available;
  note.textContent='The bundled page-layout component is unavailable. Stop the app, run npm ci --ignore-scripts and npm run setup in its folder, then npm start. You can still write, edit and download Word documents. '+(state.settings.provider==='off'?'Use “Create a template draft” to draft the text.':'Use “Write letter with AI” or send your request in the conversation to draft the text.');
}
function renderProvider(){const s=state.settings,local=['off','ollama','local-compatible'].includes(s.provider);$('#ai-badge').textContent=s.provider==='off'?'Template mode':local?'Local AI':'Cloud AI';$('#provider-label').textContent=s.provider==='off'?'Template mode · Enable AI':`${s.provider} · ${s.model||'select model'}`;$('#privacy-label').textContent=s.localOnly?'Local-only workspace':'Cloud AI available';$('#cloud-notice').hidden=local;$('#write-label').textContent=s.provider==='off'?'Create a template draft':'Write letter with AI';$('#write-hint').textContent=s.provider==='off'?'A starting point using your entered facts.':'Turn your details into a complete, polished letter.';$('#generate-template').hidden=s.provider==='off';$('#instruction').placeholder=s.provider==='off'?'Describe the letter to get a template draft. Add details as Recipient: …, Subject: …, Action: … on separate lines.':'Describe the letter you need, or ask for a revision or translation…';$('.composer-caption').textContent=s.provider==='off'?'Enter to create a template draft · Shift+Enter for a new line · AI is optional':'Enter to send · Shift+Enter for a new line · You confirm facts and approve the draft.';}
function switchTab(tab){state.tab=tab;document.querySelectorAll('[data-tab]').forEach(el=>{el.classList.toggle('active',el.dataset.tab===tab);el.setAttribute('aria-selected',String(el.dataset.tab===tab));});document.querySelectorAll('.tab-content').forEach(el=>el.hidden=el.id!=='view-'+tab);if(tab==='history')refreshHistory().catch(e=>toast(e.message,true));}
async function refreshHistory(){const d=await api('/tasks/'+state.task.id);state.revisions=d.revisions;renderHistory();}
function openSettings(){const form=$('#settings-form');for(const [k,v]of Object.entries(state.settings)){const el=form.elements.namedItem(k);if(el)el.type==='checkbox'?el.checked=!!v:el.value=v;}form.elements.apiKey.value='';form.elements.clearKey.checked=false;$('#key-status').textContent=state.keySaved?'A protected key is saved. Leave blank to keep it.':'Keys use Windows user-bound encryption and are excluded from backups.';$('#connection-status').textContent='';providerFields();$('#settings-dialog').showModal();}
function providerFields(){const p=$('#settings-form').elements.provider.value;$('#endpoint-row').hidden=!['ollama','local-compatible','compatible'].includes(p);$('#key-row').hidden=['off','ollama'].includes(p);}
async function saveSettings(close=true){const form=$('#settings-form'),data=Object.fromEntries(new FormData(form));data.localOnly=form.elements.localOnly.checked;data.clearKey=form.elements.clearKey.checked;const r=await api('/settings',{method:'PUT',body:data});state.settings=r.settings;state.keySaved=r.keySaved;form.elements.apiKey.value='';form.elements.clearKey.checked=false;renderProvider();if(close){$('#settings-dialog').close();toast('Settings saved locally.');}}
async function base64(file){const buffer=await file.arrayBuffer();let binary='';const bytes=new Uint8Array(buffer);for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(binary);}
async function uploadFiles(files){
  const batch=Array.from(files),taskId=state.task.id;if(!batch.length)return;if(state.uploading)throw new Error('A reference upload is already running. Wait for it to finish.');if(batch.length>20)throw new Error('Choose up to 20 references per batch.');
  const failures=[];let saved=0;state.uploading=true;$('#upload').disabled=true;$('#drop-zone').setAttribute('aria-busy','true');
  try{
    await flush();
    for(let i=0;i<batch.length;i++){
      const file=batch[i];toast(`Uploading ${i+1} of ${batch.length}: ${file.name}…`);
      try{
        if(!file.size||file.size>12*1024*1024)throw new Error('Choose a non-empty file up to 12 MB.');
        if(!/\.(docx|pdf|png|jpe?g|txt)$/i.test(file.name))throw new Error('Use DOCX, PDF, PNG, JPEG or TXT.');
        const sources=await api('/tasks/'+taskId+'/sources',{method:'POST',body:{name:file.name,base64:await base64(file)}});saved++;
        if(state.task.id===taskId){state.sources=sources;renderSources();}
      }catch(error){failures.push(file.name+': '+error.message);}
    }
    if(saved){const data=await api('/tasks/'+taskId);if(state.task.id===taskId){if(Array.isArray(data.sources)){state.sources=data.sources;renderSources();}state.task.issues=data.task.issues;renderIssues();}}
    toast(`Saved ${saved} of ${batch.length} references. `+(failures.length?'Failed: '+failures.join(' · '):'Review extracted facts before using them.'),!!failures.length);
    return {saved,total:batch.length,failures};
  }finally{state.uploading=false;$('#upload').disabled=false;$('#drop-zone').setAttribute('aria-busy','false');}
}
function showSource(id){
  const s=state.sources.find(s=>s.id===id);if(!s)return;state.sourceView=id;state.sourcePageVersion=(state.sourcePageVersion||0)+1;
  const cap=state.capabilities?.referenceProcessing||{},processable=['.pdf','.png','.jpg','.jpeg'].includes(s.mime),ready=s.mime==='.pdf'?cap.pdfText:cap.ocr;
  const view=(index,kind,item)=>item.page&&(s.mime==='.pdf'?cap.pdfPreview:cap.imagePreview)?`<button class="text-button" data-view-source="${id}" data-index="${index}" data-kind="${kind}">View page ${item.page} and highlight →</button>`:'';
  $('#source-title').textContent=s.name;
  $('#source-details').innerHTML=`<p>${escapeHTML(s.notice||'Extracted locally. Imported facts remain unconfirmed.')}</p><button class="secondary" data-download-source="${id}">Download original</button>${s.mime==='.pdf'?'<a class="secondary" href="/pdf?task='+encodeURIComponent(state.task.id)+'&amp;source='+encodeURIComponent(id)+'" target="_blank" rel="noopener">Open in PDF workspace</a>':''}${processable?`<div class="reference-controls"><label>Reference language<select id="reference-language"><option value="eng">English</option><option value="eng+tel">English + Telugu</option><option value="tel">Telugu</option></select></label><label>Processing<select id="reference-mode"><option value="auto">Read text; OCR scanned pages</option><option value="ocr">OCR every page</option></select></label><button class="primary" data-extract-source="${id}" ${ready?'':'disabled'}>Process reference locally</button>${!ready?'<p class="hint">A bundled reference component is missing. Stop the app, run npm ci --ignore-scripts and npm run setup in the project folder, then npm start. You can still download the original and enter facts manually.</p>':''}<p id="source-progress" class="hint" role="status"></p><button class="secondary" data-cancel-source hidden>Cancel processing</button></div>`:''}<div id="source-page-preview" hidden><p id="source-page-label" class="hint"></p><canvas id="source-canvas" aria-label="Original reference page with selected text highlighted"></canvas></div>${s.candidates?.length?'<h3>Candidate facts · unconfirmed</h3>':''}${(s.candidates||[]).map((c,i)=>{const conflict=state.task.facts[c.field]?.value&&state.task.facts[c.field].value!==c.value;return `<div class="candidate ${c.uncertain?'uncertain':''}"><strong>${escapeHTML(state.fields[c.field])}: ${escapeHTML(c.value)}</strong><small>${escapeHTML(c.source)}${c.confidence!=null?' · OCR '+Math.round(c.confidence)+'%':''}</small>${c.uncertain?'<p class="reference-warning">Uncertain OCR: check the original before confirming.</p>':''}${conflict?'<p class="reference-warning">Conflicts with entered value: '+escapeHTML(state.task.facts[c.field].value)+'</p>':''}${view(i,'candidate',c)}<button data-candidate="${i}" data-source-id="${id}">Use as unconfirmed fact →</button></div>`;}).join('')}<h3>Extracted content</h3>${(s.blocks||[]).map((b,i)=>`<div class="source-block ${b.uncertain?'uncertain':''}"><small>${escapeHTML(b.location)}${b.confidence!=null?' · OCR '+Math.round(b.confidence)+'%':''}</small><p>${b.words?.length?b.words.map(w=>`<span class="${w.uncertain?'ocr-uncertain':''}" title="${w.confidence==null?'Confidence unavailable':'OCR confidence '+Math.round(w.confidence)+'%'}">${escapeHTML(w.text)}</span>`).join(' '):escapeHTML(b.text)}</p>${view(i,'block',b)}</div>`).join('')||'<p>No text extracted. Process the reference or enter the facts manually.</p>'}`;
  const differences=[];
  for(const candidate of s.candidates||[])for(const other of state.sources.filter(source=>source.id!==id))for(const value of other.candidates||[])if(value.field===candidate.field&&value.value!==candidate.value)differences.push(state.fields[candidate.field]+': '+candidate.value+' here; '+value.value+' in '+other.name+'.');
  if(differences.length)$('#source-details').innerHTML='<div class="issue warning"><strong>Different values across references</strong><p>Select the correspondence relevant to this task; nothing is overwritten automatically.</p>'+[...new Set(differences)].slice(0,5).map(message=>'<p>'+escapeHTML(message)+'</p>').join('')+'</div>'+$('#source-details').innerHTML;
  if(processable)$('#reference-language').value=state.task.language==='te'?'eng+tel':'eng';
  if(!$('#source-dialog').open)$('#source-dialog').showModal();
}
async function showSourcePage(sourceId,item){
  const taskId=state.task.id,version=state.sourcePageVersion=(state.sourcePageVersion||0)+1;$('#source-page-preview').hidden=false;$('#source-page-label').textContent='Preparing page '+item.page+'…';
  const data=await api('/tasks/'+taskId+'/sources/'+sourceId+'/page?number='+item.page);
  if(state.task.id!==taskId||state.sourceView!==sourceId||state.sourcePageVersion!==version)return;
  const picture=new Image();await new Promise((resolve,reject)=>{picture.onload=resolve;picture.onerror=()=>reject(new Error('Could not display the reference page.'));picture.src='data:image/png;base64,'+data.image;});
  if(state.task.id!==taskId||state.sourceView!==sourceId||state.sourcePageVersion!==version)return;
  const canvas=$('#source-canvas');canvas.width=data.width;canvas.height=data.height;const ctx=canvas.getContext('2d');ctx.drawImage(picture,0,0);
  if(item.bbox){const [x,y,w,h]=item.bbox;ctx.fillStyle='rgba(255,192,0,0.25)';ctx.fillRect(x*data.width,y*data.height,w*data.width,h*data.height);ctx.strokeStyle='#b76a00';ctx.lineWidth=2;ctx.strokeRect(x*data.width,y*data.height,w*data.width,h*data.height);}
  $('#source-page-label').textContent='Page '+item.page+' · highlight is approximate; verify against the original.';canvas.scrollIntoView({behavior:'smooth',block:'nearest'});
}
async function processReference(sourceId,engine){
  if(state.capabilities?.backgroundJobs&&window.officeJobs)return processReferenceJob(sourceId,engine);
  if(state.sourceAbort)throw new Error('Wait for the current reference or cancel it first.');
  await flush();const snapshot=structuredClone(state.task),language=$('#reference-language').value,mode=$('#reference-mode').value,controller=new AbortController();state.sourceAbort=controller;let finished=false;
  $('#source-details').querySelectorAll('[data-extract-source]').forEach(button=>button.disabled=true);$('#source-progress').textContent='Starting local processing…';$('[data-cancel-source]').hidden=false;
  const poll=async()=>{while(!finished&&!controller.signal.aborted){try{const value=await api('/tasks/'+snapshot.id+'/sources/'+sourceId+'/progress',{signal:controller.signal});if(state.sourceView===sourceId)$('#source-progress').textContent=value.status+' · '+Math.round((value.progress||0)*100)+'%';}catch{return;}await new Promise(resolve=>setTimeout(resolve,800));}};
  poll().catch(()=>{});
  try{const result=await api('/tasks/'+snapshot.id+'/sources/'+sourceId+'/extract',{method:'POST',body:{language,mode,engine},signal:controller.signal});if(!result.cached&&state.task.id===snapshot.id)for(const fact of Object.values(state.task.facts))if(fact.source.startsWith(sourceId+' | '))fact.confirmed=false;if(!await applyMutationResult(result.task,snapshot))return;state.sources=result.sources;renderSources();renderFacts();renderIssues();if(state.sourceView===sourceId)showSource(sourceId);toast(result.cached?'Using the saved extraction. Imported facts still need confirmation.':'Reference processed locally. Check uncertain text and confirm imported facts.');}
  catch(error){if(error.name==='AbortError')toast('Reference processing cancelled. Existing extraction and facts were kept.');else throw error;}
  finally{finished=true;state.sourceAbort=null;if(state.task.id===snapshot.id&&state.sourceView===sourceId){showSource(sourceId);}}
}
async function processReferenceJob(sourceId,engine){
  if(state.sourceAbort)throw new Error('Wait for the current reference or cancel it first.');await flush();
  const snapshot=structuredClone(state.task),controller=new AbortController();state.sourceAbort=controller;
  const language=$('#reference-language').value,mode=$('#reference-mode').value;
  $('#source-details').querySelectorAll('[data-extract-source]').forEach(button=>button.disabled=true);$('[data-cancel-source]').hidden=false;
  try{
    const job=await window.officeJobs.run(api,{kind:'reference',taskId:snapshot.id,sourceId,language,mode,engine},{signal:controller.signal,onCreated:id=>{if(state.sourceAbort===controller)state.sourceJobId=id;},onProgress:job=>{if(state.task.id===snapshot.id&&state.sourceView===sourceId)$('#source-progress').textContent=job.message+' · '+Math.round(job.progress*100)+'%';}});
    const result=await api('/tasks/'+snapshot.id);if(state.task.id!==snapshot.id)return;
    if(!job.result.cached)for(const fact of Object.values(state.task.facts))if(fact.source.startsWith(sourceId+' | '))fact.confirmed=false;
    if(!await applyMutationResult(result.task,snapshot))return;state.sources=result.sources;renderSources();renderFacts();renderIssues();toast('Reference processed. Review extracted facts. The job is saved in Jobs & backups.');
  }catch(error){if(error.name==='AbortError')toast('Stopped waiting. Check Jobs & backups for the saved job status.');else throw error;}
  finally{if(state.sourceAbort===controller){state.sourceAbort=null;state.sourceJobId=null;}if(state.task.id===snapshot.id&&state.sourceView===sourceId&&$('#source-dialog').open)showSource(sourceId);}
}
async function backgroundDocumentExport(taskId,format,draft){
  const version=state.task.version,job=await window.officeJobs.run(api,{kind:'document-export',taskId,version,format,draft});
  if(state.task.id===taskId&&(state.task.version!==version||state.dirty!==state.saved))throw new Error('The document changed. Export again from the latest saved version. The earlier output is in Jobs & backups.');
  return api('/jobs/'+job.id+'/download',{blob:true});
}
async function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);}
async function exportDocument(format){
  if(state.proposal)throw new Error('Accept or discard the suggested letter before downloading.');
  // Open during the click gesture, before autosave/network work, so normal
  // browser popup rules do not discard the requested print preview.
  const preview=format==='pdf'?window.open('/document-print','_blank'):null;
  if(format==='pdf'&&!preview)throw new Error('Allow the document PDF preview to open for this local website, then try again.');
  let ready,detach=()=>{};
  if(preview)ready=new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{detach();reject(new Error('The PDF preview did not open. Close it and try again.'));},20000);
    const receive=e=>{if(e.source===preview&&e.origin===location.origin&&e.data?.type==='print-document-ready'){detach();resolve();}};
    detach=()=>{clearTimeout(timer);window.removeEventListener('message',receive);};window.addEventListener('message',receive);
  });
  // A failed export can occur before the preview loads; keep rejection handled.
  ready?.catch(()=>{});
  const button=$('#export-'+format),original=button.textContent;button.disabled=true;button.textContent='Preparing…';
  try{
    await flush();if(state.proposal)throw new Error('Accept or discard the suggested letter before downloading.');
    const taskId=state.task.id,title=state.task.title,final=$('#final-export').checked,exportFormat=preview?'docx':format;
    const blob=state.capabilities?.backgroundJobs&&window.officeJobs?await backgroundDocumentExport(taskId,exportFormat,!final):await api('/tasks/'+taskId+'/export',{method:'POST',body:{format:exportFormat,draft:!final},blob:true});
    if(preview){await ready;if(preview.closed)throw new Error('The PDF preview was closed. Use the PDF button again.');const bytes=await blob.arrayBuffer();preview.postMessage({type:'print-document',bytes,title},location.origin,[bytes]);toast('PDF preview opened. Review it, then choose Print / save PDF.');}
    else{await download(blob,(final?'':'draft-')+title.replace(/[^\p{L}\p{N} ._-]/gu,'').slice(0,80)+'.'+format);toast(format.toUpperCase()+' downloaded. Verify the exported layout before issue.');}
    if(state.task.id===taskId)await refreshHistory();
  }catch(error){preview?.close();throw error;}finally{detach();button.disabled=!!state.proposal;button.textContent=original;}
}
function bodySnapshot(){return {body:state.task.body,bodyFormat:state.task.bodyFormat??null,actionAtDraft:state.task.actionAtDraft};}
function exportReviewControls(){const review=state.exportReview,final=$('#export-review-mode').value==='final',stale=!review||review.id!==state.task?.id||review.version!==state.task.version||state.dirty!==state.saved;const blocking=review?.issues.filter(issue=>issue.severity==='blocking').length||0;$('#export-review-docx').disabled=$('#export-review-pdf').disabled=stale||!!state.proposal||(final&&blocking>0);$('#export-review-status').textContent=stale?'The document changed. Close and reopen this review.':state.proposal?'Accept or discard the suggested letter before exporting.':final&&blocking?blocking+' blocking checks must be resolved for a final copy.':final?'Final-copy checks passed. Verify the exported layout before issue.':'Draft download available. Unresolved details remain marked for review.';}
async function openExportReview(){await flush();const id=state.task.id,version=state.task.version,data=await api('/tasks/'+id);if(state.task.id!==id||state.task.version!==version||state.dirty!==state.saved)throw new Error('Document changed. Open the review again.');if(data.task.version!==version)throw new Error('This document changed in another tab. Reopen it before export.');state.exportReview={id,version,issues:data.task.issues};const facts=Object.values(state.task.facts).filter(f=>f.value.trim()),confirmed=facts.filter(f=>f.confirmed).length,attachments=state.task.facts.attachments.value.split('\n').map(s=>s.trim()).filter(Boolean);$('#export-review-summary').innerHTML='<h3>'+escapeHTML(state.task.title)+'</h3><p>'+confirmed+' of '+facts.length+' entered facts confirmed · '+attachments.length+' named attachments · '+data.sources.length+' uploaded references</p><p>Format: '+escapeHTML(state.templates.find(t=>t.id===state.task.templateId)?.name||'Starter format · draft only')+'</p>'+(data.task.issues.length?'<ul>'+data.task.issues.map(issue=>'<li><strong>'+escapeHTML(issue.severity==='blocking'?'Needs attention':'Review note')+':</strong> '+escapeHTML(issue.message)+'</li>').join('')+'</ul>':'<p>Automated checks passed. Review meaning, signatory authority and layout before issue.</p>');$('#export-review-mode').value=$('#final-export').checked?'final':'draft';exportReviewControls();$('#export-review-dialog').showModal();}
$('#review-export').onclick=run(openExportReview);$('#export-review-mode').onchange=exportReviewControls;
$('#export-review-facts').onclick=()=>{$('#export-review-dialog').close();switchTab('facts');};$('#export-review-issues').onclick=()=>{$('#export-review-dialog').close();switchTab('issues');};
for(const format of ['docx','pdf'])$('#export-review-'+format).onclick=run(async()=>{exportReviewControls();if($('#export-review-'+format).disabled)return;$('#final-export').checked=$('#export-review-mode').value==='final';$('#export-review-dialog').close();await exportDocument(format);});
function pushUndo(){state.undo.push(bodySnapshot());if(state.undo.length>60)state.undo.shift();state.redo=[];}

$('#new-task').onclick=run(newTask);$('#new-task-main').onclick=run(newTask);$('#new-task-editor').onclick=run(()=>newTask({edit:true}));$('#search').oninput=renderTasks;
$('#task-list').onclick=run(async e=>{const el=e.target.closest('[data-task]');if(el)await loadTask(el.dataset.task);});
$('#task-title').oninput=e=>{state.task.title=e.target.value;dirty();};
$('#document-type').onchange=e=>{state.task.type=e.target.value;if(state.task.type==='Employee representation')state.task.role='employee';else state.task.role='officer';$('#role').value=state.task.role;dirty();};
$('#language').onchange=e=>{state.task.language=e.target.value;dirty();toast('Language set. Generate a new draft or ask AI to translate the existing body.');};
$('#role').onchange=e=>{state.task.role=e.target.value;dirty();};
$('#facts-open').onclick=()=>switchTab('facts');document.querySelectorAll('[data-tab]').forEach(el=>el.onclick=()=>switchTab(el.dataset.tab));
$('#fact-fields').oninput=e=>{const key=e.target.dataset.fact;if(!key)return;const f=state.task.facts[key];if(f.source.startsWith('Workbook ')&&f.value!==e.target.value)f.source='Edited workbook value · '+f.source;f.value=e.target.value;f.confirmed=false;if(f.provenance==='extracted')f.provenance='user supplied';const button=e.target.closest('.fact-card').querySelector('[data-confirm]');button.textContent='Confirm fact';button.classList.remove('confirmed');button.disabled=!f.value.trim();showDateError(e.target);dirty();};
$('#fact-fields').onclick=run(async e=>{const link=e.target.closest('[data-fact-source]');if(link){const fact=state.task.facts[link.dataset.factSource],source=state.sources.find(s=>fact.source.startsWith(s.id+' | '));if(source){showSource(source.id);const evidence=(source.candidates||[]).find(c=>c.field===link.dataset.factSource&&c.value===fact.value);if(evidence?.page&&(source.mime==='.pdf'?state.capabilities?.referenceProcessing?.pdfPreview:state.capabilities?.referenceProcessing?.imagePreview))await showSourcePage(source.id,evidence);}return;}const el=e.target.closest('[data-confirm]');if(!el)return;const f=state.task.facts[el.dataset.confirm];if(invalidDate(el.dataset.confirm,f.value)){toast('Correct the invalid date before confirming it.',true);return;}f.confirmed=!f.confirmed;dirty();renderFacts();});
async function createTemplateDraft(){await flush();if(state.task.body&&!confirm('Replace the current body with a new template draft? A revision will be saved.'))return;const snapshot=structuredClone(state.task),result=await api('/tasks/'+snapshot.id+'/generate',{method:'POST'});if(!await applyMutationResult(result,snapshot))return;state.proposal=null;render();switchTab('preview');toast('Template draft created without AI.');}
$('#generate-template').onclick=run(createTemplateDraft);
$('#generate').onclick=run(async()=>{
  if(state.settings.provider==='off')return createTemplateDraft();
  if(!$('#instruction').value.trim())$('#instruction').value='Write this '+state.task.type.toLowerCase()+' in polished '+(state.task.language==='te'?'Telugu':'English')+' using the entered facts and requested action. Express the action as a proper sentence. Avoid generic filler and do not invent details.';
  return $('#chat-form').onsubmit({preventDefault(){}});
});
function hideTemplatePreview(){state.renderedBytes=null;$('#docx-frame').hidden=true;$('#paper').hidden=state.editing;}
$('#render-template').onclick=run(async()=>{
  if(!state.capabilities?.openSource?.docxPreview){renderLayoutAvailability();toast('The bundled layout preview is unavailable. Stop the app and run npm ci --ignore-scripts and npm run setup, then npm start; DOCX download remains available.');return;}
  await flush();const button=$('#render-template'),taskId=state.task.id,version=state.task.version,dirtyCount=state.dirty,proposal=state.proposal;button.disabled=true;
  try{const blob=await api('/tasks/'+taskId+'/preview',{method:'POST',body:{version,body:proposal?.body??state.task.body,instruction:proposal?.instruction||'',stage:proposal?.stage},blob:true});const bytes=await blob.arrayBuffer();if(state.task.id!==taskId||state.task.version!==version||state.dirty!==dirtyCount||state.proposal!==proposal)throw new Error('The document changed while the layout was being prepared. Open Layout preview again.');state.renderedBytes=bytes;state.editing=false;$('#body-editor').hidden=true;$('#paper').hidden=true;$('#edit-toggle').textContent='Edit body';switchTab('preview');$('#docx-frame').hidden=false;$('#docx-frame').src='/docx-frame.html';}finally{renderLayoutAvailability();}
});
window.addEventListener('message',event=>{const frame=$('#docx-frame');if(event.source===frame.contentWindow&&event.data?.type==='docx-preview-ready'&&state.renderedBytes)frame.contentWindow.postMessage({type:'render-docx',bytes:state.renderedBytes},'*');});
$('#edit-toggle').onclick=()=>{if(state.proposal){toast('Accept or discard the suggested letter before editing it.');return;}state.editing=!state.editing;hideTemplatePreview();switchTab('preview');$('#paper').hidden=state.editing;$('#body-editor').hidden=!state.editing;$('#edit-toggle').textContent=state.editing?'Read preview':'Edit body';$('#body-text').value=state.task.body;window.officeWriting?.syncEditor();};
$('#body-text').onfocus=pushUndo;$('#body-text').oninput=e=>{state.task.body=e.target.value;delete state.task.bodyFormat;state.task.actionAtDraft=state.task.facts.action.value;dirty();};
$('#undo').onclick=()=>{if(!state.undo.length)return;state.redo.push(bodySnapshot());Object.assign(state.task,state.undo.pop());$('#body-text').value=state.task.body;dirty();window.officeWriting?.syncEditor(true);};
$('#redo').onclick=()=>{if(!state.redo.length)return;state.undo.push(bodySnapshot());Object.assign(state.task,state.redo.pop());$('#body-text').value=state.task.body;dirty();window.officeWriting?.syncEditor(true);};
$('#reviewed').onchange=e=>{const checked=e.target.checked;dirty();state.task.reviewed=checked;$('#reviewed').checked=checked;};
$('#checkpoint').onclick=run(async()=>{await flush(true);await refreshHistory();toast('Checkpoint saved.');});
$('#history-list').onclick=run(async e=>{const el=e.target.closest('[data-revision]');if(!el)return;const taskId=state.task.id;await flush();if(state.task.id!==taskId)return;if(!confirm('Restore this revision? Current saved versions remain in history.'))return;const snapshot=structuredClone(state.task),result=await api('/tasks/'+taskId+'/revisions/'+el.dataset.revision,{method:'POST'});if(!await applyMutationResult(result,snapshot))return;state.undo=[];state.redo=[];state.proposal=null;render();toast('Revision restored. Recheck imported facts before final export.');});
$('#delete-task').onclick=run(async()=>{if(!confirm('Delete this document, its references, and revision history? Backups are unaffected.'))return;await flush();await api('/tasks/'+state.task.id,{method:'DELETE'});state.task=null;state.tasks=await api('/tasks');const requested=new URLSearchParams(window.location?.search||'').get('task');if(state.tasks.length)await loadTask(state.tasks.find(task=>task.id===requested)?.id||state.tasks[0].id);else await newTask();});
$('#settings-open').onclick=openSettings;$('#provider-shortcut').onclick=openSettings;document.querySelectorAll('[data-close]').forEach(el=>el.onclick=()=>$('#'+el.dataset.close).close());
$('#settings-form').onsubmit=run(async e=>{e.preventDefault();await saveSettings();});
$('#settings-form').elements.provider.onchange=()=>{const form=$('#settings-form'),p=form.elements.provider.value;form.elements.apiKey.value='';form.elements.clearKey.checked=false;if(p==='ollama')form.elements.endpoint.value='http://127.0.0.1:11434';if(p==='local-compatible')form.elements.endpoint.value='http://127.0.0.1:1234/v1';if(p==='compatible')form.elements.endpoint.value='';$('#key-status').textContent='Leave blank to keep any key saved for this provider.';providerFields();};
$('#test-provider').onclick=run(async()=>{await saveSettings(false);$('#connection-status').textContent='Testing connection…';try{const r=await api('/provider/test',{method:'POST'});$('#connection-status').textContent=r.message;}catch(e){$('#connection-status').textContent=e.message;}});
$('#drop-zone').onclick=()=>{if(!state.uploading)$('#upload').click();};$('#drop-zone').onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();if(!state.uploading)$('#upload').click();}};$('#upload').onchange=run(async e=>{try{await uploadFiles(e.target.files);}finally{e.target.value='';}});
$('#drop-zone').ondragover=e=>{e.preventDefault();$('#drop-zone').classList.add('drag');};$('#drop-zone').ondragleave=()=>$('#drop-zone').classList.remove('drag');$('#drop-zone').ondrop=run(async e=>{e.preventDefault();$('#drop-zone').classList.remove('drag');await uploadFiles(e.dataTransfer.files);});
$('#source-list').onclick=run(async e=>{const open=e.target.closest('[data-source]'),del=e.target.closest('[data-delete-source]');if(open)showSource(open.dataset.source);if(del&&confirm('Delete this reference? Any copied facts must be reviewed separately.')){await flush();const snapshot=structuredClone(state.task),result=await api('/tasks/'+snapshot.id+'/sources/'+del.dataset.deleteSource,{method:'DELETE'});if(!await applyMutationResult(result.task,snapshot))return;state.sources=result.sources;state.proposal=null;renderSources();renderFacts();renderIssues();renderProposal();}});
$('#source-details').onclick=run(async e=>{const candidate=e.target.closest('[data-candidate]'),extract=e.target.closest('[data-extract-source]'),down=e.target.closest('[data-download-source]'),view=e.target.closest('[data-view-source]');if(e.target.closest('[data-cancel-source]')){if(state.sourceJobId)await api('/jobs/'+state.sourceJobId+'/cancel',{method:'POST'});state.sourceAbort?.abort();return;}if(candidate){const s=state.sources.find(s=>s.id===candidate.dataset.sourceId),c=s.candidates[+candidate.dataset.candidate],old=state.task.facts[c.field];if(old.value&&old.value!==c.value&&!confirm('Conflicting value: '+old.value+' → '+c.value+'. Replace it with this unconfirmed candidate?'))return;state.task.facts[c.field]={value:c.value,confirmed:false,provenance:'extracted',source:s.id+' | '+s.name+' · '+c.source+(c.uncertain?' · uncertain OCR':'')};dirty();renderFacts();toast('Candidate added. Verify and confirm it in Facts.');}if(extract)await processReference(extract.dataset.extractSource,extract.dataset.engine);if(view){const s=state.sources.find(s=>s.id===view.dataset.viewSource),item=(view.dataset.kind==='candidate'?s.candidates:s.blocks)[+view.dataset.index];await showSourcePage(s.id,item);}if(down){const s=state.sources.find(s=>s.id===down.dataset.downloadSource);await download(await api('/tasks/'+state.task.id+'/sources/'+s.id+'/download',{blob:true}),s.name);}});
$('#templates-open').onclick=run(async()=>{state.templates=await api('/templates');renderTemplates();$('#templates-dialog').showModal();});
function renderTemplates(){$('#template-list').innerHTML=[{id:'',name:'Built-in starter',approved:false},...state.templates].map(t=>`<div class="template-option"><div><strong>${escapeHTML(t.name)}${t.number?' · v'+t.number:''}</strong><small>${t.status==='retired'?'Retired format':t.approved?'Office-approved format':'Draft format only'}</small></div><button data-template="${escapeHTML(t.id)}" ${t.status==='retired'?'disabled':''}>${state.task.templateId===t.id?'Selected ✓':'Select'}</button></div>`).join('');}
$('#template-list').onclick=run(async e=>{const el=e.target.closest('[data-template]');if(!el)return;state.task.templateId=el.dataset.template;dirty();await flush();renderTemplates();renderTemplateLabel();toast('Template selected. The browser shows content; downloaded files use the chosen format.');});
$('#download-template').onclick=run(async()=>download(await api('/template-starter',{blob:true}),'template-starter.docx'));
$('#upload-template').onclick=run(async()=>{const f=$('#template-file').files[0];if(!f)throw new Error('Choose a DOCX template.');if(f.size>12*1024*1024)throw new Error('Template exceeds 12 MB.');state.templates=await api('/templates',{method:'POST',body:{name:f.name,approved:$('#template-approved').checked,base64:await base64(f)}});renderTemplates();$('#template-file').value='';$('#template-approved').checked=false;toast('Template saved. Select it to apply it to this task.');});
async function templateRequest(instruction){
  const taskId=state.task.id;
  const hadBody=!!state.task.body.trim();
  // Model-off interpretation is deliberately limited to document-type keywords
  // and explicitly labelled facts. Never insert a whole command as outgoing prose.
  if(!hadBody){
    const choices=[[/\b(reminder|remind)\b/i,'Reminder'],[/\b(reply|respond)\b/i,'Reply'],[/\b(forward|forwarding)\b/i,'Forwarding letter'],[/\b(internal note|office note)\b/i,'Internal note'],[/\b(email|e-mail)\b/i,'Official email'],[/\b(application|representation|leave request)\b/i,'Employee representation'],[/\b(letter)\b/i,'Office letter']];
    const match=choices.find(([pattern])=>pattern.test(instruction));
    if(match){state.task.type=match[1];state.task.role=match[1]==='Employee representation'?'employee':'officer';}
    if(/\b(in Telugu|Telugu language)\b/i.test(instruction))state.task.language='te';
  }
  const labels={recipient:'recipient',to:'recipient',sender:'sender',from:'sender',subject:'subject',action:'action',purpose:'action',date:'date',reference:'reference','earlier reference':'priorReference','earlier date':'priorDate',office:'office',amount:'amount'};
  const conflicts=[];
  for(const line of instruction.split('\n')){
    const match=line.match(/^\s*([a-z ]+)\s*:\s*(.+)\s*$/i),key=match&&labels[match[1].trim().toLowerCase()];
    if(!key)continue;
    const value=match[2].trim(),old=state.task.facts[key];
    if(old.value&&old.value!==value){conflicts.push(state.fields[key]);continue;}
    if(!old.value)state.task.facts[key]={value,confirmed:false,provenance:'user supplied',source:''};
  }
  if(state.task.title==='Untitled correspondence'&&state.task.facts.subject.value)state.task.title=state.task.facts.subject.value.slice(0,200);
  state.task.messages.push({role:'user',text:instruction});dirty();await flush();
  if(state.task.id!==taskId)return;
  if(!hadBody){const snapshot=structuredClone(state.task),result=await api('/tasks/'+taskId+'/generate',{method:'POST'});if(!await applyMutationResult(result,snapshot))return;}
  const missing=['action','recipient','sender','date','subject',...(['Reminder','Reply'].includes(state.task.type)?['priorReference','priorDate']:[])].filter(k=>!state.task.facts[k].value.trim());
  let reply=hadBody?'I have kept your existing draft. In template mode, I can use labelled facts and the Facts form; free-form rewriting needs an AI provider.':'Your '+state.task.type.toLowerCase()+' draft is now in the Document panel. I used the template engine because AI is disabled.';
  if(missing.length)reply+='\n\nPlease add '+missing.slice(0,3).map(k=>state.fields[k].toLowerCase()).join(', ')+'. Open Add the facts, or send lines such as:\nRecipient: Depot Manager\nAction: Please provide the status of the pending request.\n\nMissing details stay as highlighted placeholders.';
  else reply+='\n\nConfirm the facts in the Facts tab and review the letter before downloading.';
  if(conflicts.length)reply+='\n\nThese values conflict with existing facts and were not replaced: '+conflicts.join(', ')+'. Review them in the Facts tab.';
  state.task.messages.push({role:'assistant',text:reply});dirty();await flush();$('#instruction').value='';render();switchTab('preview');$('#messages').scrollIntoView({behavior:'smooth',block:'nearest'});toast(hadBody?'Request recorded. Review the guidance in the conversation.':'Letter draft created. Add the highlighted missing details.');
}
$('#instruction').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();if(!$('#send').disabled)$('#chat-form').requestSubmit();}};
$('#chat-form').onsubmit=run(async e=>{
  e.preventDefault();if(state.abort){await cancelWriting();return;}
  if(state.submitting)return;
  const instruction=$('#instruction').value.trim();if(!instruction)return;if(instruction.length>5000)throw new Error('Keep the drafting request within 5,000 characters.');
  if(state.build&&state.build!=='source-v1')throw new Error('An older backend is running. Wait for saves, stop the old service with Ctrl+C in its terminal, run npm start in the current project folder and refresh the workspace.');
  const taskId=state.task.id;state.submitting=true;$('#send').disabled=true;$('#generate').disabled=true;
  try{
  await flush();if(state.task.id!==taskId)throw new Error('The selected document changed. Send your request again.');
  if(state.settings.provider==='off')return await templateRequest(instruction);
  const cloud=['openai','gemini','compatible'].includes(state.settings.provider);
  if(cloud&&!confirm('Send this request, the draft body, and entered facts (including unconfirmed facts) to '+state.settings.provider+'? Uploaded files are not sent.'))return;
  const requestedTask=state.task.id;let requestedVersion=state.task.version,englishProposal=null;
  state.abort=new AbortController();$('#send').disabled=false;$('#send').textContent='■';$('#send').ariaLabel='Cancel request';
  const started=Date.now(),translating=/\b(?:translate|(?:write|render)\s+(?:this|it)\s+(?:in|into|to)\s+(?:Telugu|English))\b/i.test(instruction),staged=/\b(?:translate(?:\s+(?:this|it|the (?:following|above)(?: text)?))?|(?:write|render)\s+(?:this|it))\s+(?:in|into|to)\s+(?:formal\s+)?Telugu\b/i.test(instruction);
  let progressLabel=staged?'Step 1/2 · Preparing English wording':translating?'Translating':'Writing your letter';
  let providerPhase='',polling=false;const controller=state.abort;
  const showProgress=()=>{$('#drafting-status').textContent=progressLabel+' with '+state.settings.model+' · '+Math.floor((Date.now()-started)/1000)+'s elapsed'+(providerPhase?' · '+providerPhase:'. Waiting for a complete response.')+' Use Cancel writing to stop.';};
  const pollProgress=async()=>{if(polling||state.abort!==controller||controller.signal.aborted)return;polling=true;try{const progress=await api('/tasks/'+requestedTask+'/assist-progress',{signal:controller.signal});if(state.abort===controller){providerPhase=progress.active?progress.phase:'';showProgress();}}catch{}finally{polling=false;}};
  $('#drafting-status').hidden=false;$('#writing-controls').hidden=false;showProgress();draftingTimer=setInterval(()=>{showProgress();pollProgress();},1000);
  switchTab('preview');state.editing=false;$('#paper').hidden=false;$('#body-editor').hidden=true;$('#edit-toggle').textContent='Edit body';
  try{
    const checkCurrent=()=>{if(state.task.id!==requestedTask||state.task.version!==requestedVersion||state.dirty!==state.saved||(englishProposal&&state.proposal!==englishProposal))throw new Error('The document changed while the model was writing. Send the request again to use the latest facts.');state.abort.signal.throwIfAborted();};
    const call=body=>{state.aiSerial=(state.aiSerial||0)+1;state.aiTask=requestedTask;state.aiRequestId='ui-'+Date.now()+'-'+state.aiSerial;return api('/tasks/'+requestedTask+'/assist',{method:'POST',body:{instruction,cloudConsent:cloud,...body,requestId:state.aiRequestId},signal:state.abort.signal});};
    let result=await call(staged?{stage:'english'}:{});checkCurrent();
    if(staged){
      if(result.stage!=='english'||!Array.isArray(result.sections)||!result.sections.length)throw new Error('The running server needs restarting to enable English-then-Telugu drafting.');
      // Save the intermediate as conversation history, not the outgoing body.
      const englishText=result.body.replace(/\{\{(\w+)\}\}/g,(_,key)=>state.task.facts[key]?.value||'['+key+']');
      state.task.messages.push({role:'assistant',text:'English wording prepared for Telugu translation (review required):\n\n'+englishText});dirty();
      englishProposal={...result,instruction,stage:'english',notes:[...result.notes,'English draft only. If translation fails, this wording remains in the conversation.']};
      state.proposal=englishProposal;renderProposal();renderMessages();await flush(true);
      if(state.task.id!==requestedTask||state.proposal!==englishProposal)throw new Error('The document changed after English preparation. The English wording remains in the conversation.');
      requestedVersion=state.task.version;englishProposal.baseVersion=requestedVersion;checkCurrent();
      const translated=[],translationNotes=new Set();let latest,reviewedSections=0;
      for(const [index,section] of result.sections.entries()){
        progressLabel='Step 2/2 · Translating section '+(index+1)+' of '+result.sections.length;showProgress();checkCurrent();
        const translationContext=[index?'Previous sentence: '+result.sections[index-1].source:'',index+1<result.sections.length?'Next sentence: '+result.sections[index+1].source:''].filter(Boolean).join('\n').slice(0,1200);
        latest=await call({stage:'translate',translationSource:section.source,translationContext});checkCurrent();
        for(const note of latest.notes)translationNotes.add(note);if(latest.translationMethod==='reviewed-text')reviewedSections++;
        translated.push(section.separator+latest.body);
        $('#proposal').innerHTML='<div class="proposal"><h3>English ready · Telugu '+(index+1)+'/'+result.sections.length+' sections complete</h3><p>The English wording is saved in the conversation. The full Telugu proposal will appear after all sections finish.</p><pre>'+escapeHTML(translated.join(''))+'</pre></div>';
      }
      result={...latest,body:translated.join(''),translationMethod:reviewedSections===result.sections.length?'reviewed-text':reviewedSections?'mixed':'model',notes:[...translationNotes,'English was prepared first and saved in the conversation. Telugu was prepared in '+result.sections.length+' sections ('+reviewedSections+' matched reviewed wording). Review meaning and paragraph transitions.']};
    }
    state.proposal={...result,instruction};hideTemplatePreview();renderProposal();switchTab('preview');
    $('#proposal').scrollIntoView({behavior:'smooth',block:'nearest'});toast('Your letter is visible in Document. Choose Accept letter to save it.');
  }catch(e){
    if(englishProposal&&state.task.id===requestedTask&&state.proposal===englishProposal){renderProposal();toast((e.name==='AbortError'?'Translation cancelled.':e.message)+' The English wording remains in the conversation and Document preview.',true);}
    else if(e.name==='AbortError')toast('Request cancelled. Your draft is unchanged.');else throw e;
  }
  }finally{clearInterval(draftingTimer);state.submitting=false;state.abort=null;$('#drafting-status').hidden=true;$('#writing-controls').hidden=true;$('#send').disabled=false;$('#generate').disabled=false;$('#send').textContent='↑';$('#send').ariaLabel='Send drafting request';if(state.proposal?.stage==='english')renderProposal();}
});
$('#proposal').onclick=run(async e=>{
  if(e.target.id==='discard-proposal'){if(state.proposal?.stage==='english')state.abort?.abort();state.proposal=null;hideTemplatePreview();renderProposal();return;}
  if(e.target.id!=='accept-proposal'||state.accepting||!state.proposal)return;
  const proposal=state.proposal;state.accepting=true;
  try{await flush();if(state.proposal!==proposal)throw new Error('The document changed. Request a new letter before accepting.');const snapshot=structuredClone(state.task),result=await api('/tasks/'+snapshot.id+'/accept',{method:'POST',body:proposal});if(state.proposal===proposal)state.proposal=null;if(!await applyMutationResult(result,snapshot))return;if($('#instruction').value.trim()===proposal.instruction)$('#instruction').value='';render();toast('Wording accepted. Review all claims before export.');}
  finally{state.accepting=false;}
});
$('#export-docx').onclick=run(()=>exportDocument('docx'));$('#export-pdf').onclick=run(()=>exportDocument('pdf'));
$('#backup').onclick=run(async()=>{await flush();await download(await api('/backup',{blob:true}),'office-backup-'+new Date().toISOString().slice(0,10)+'.json');toast('Backup downloaded. Store it securely.');});
$('#restore').onclick=()=>$('#restore-file').click();$('#restore-file').onchange=run(async e=>{const f=e.target.files[0];if(!f)return;if(f.size>150*1024*1024)throw new Error('Backup exceeds 150 MB.');await flush();const r=await api('/restore',{method:'POST',body:await f.text()});state.tasks=await api('/tasks');const boot=await api('/bootstrap');state.templates=boot.templates;renderTasks();toast(r.message);e.target.value='';});
window.addEventListener('beforeunload',e=>{if(state.dirty!==state.saved||state.proposal||state.submitting||state.sourceAbort){e.preventDefault();e.returnValue='';}});
async function start(){const boot=await api('/bootstrap');Object.assign(state,boot);$('#version-warning').hidden=boot.build==='source-v1';$('#document-type').innerHTML=boot.types.map(t=>'<option>'+escapeHTML(t)+'</option>').join('');$('#cloud-notice').textContent='Cloud mode: your request, draft body, and entered facts with their confirmation status will be sent to the selected provider.';const refs=boot.capabilities.referenceProcessing;$('#capabilities').textContent=`PDF export: ${boot.capabilities.pdf?'Browser print / Save as PDF':'unavailable'} · Template engine: ${boot.capabilities.openSource?.templateEngine||'basic fallback'} · DOCX preview: ${boot.capabilities.openSource?.docxPreview?'installed':'setup needed'} · PDF reference engine: ${refs?.pdfText?'installed':'setup needed'} · OCR: ${refs?.ocr?'engine installed':'setup needed'} · English data: ${refs?.languages.eng?'installed':'missing'} · Telugu data: ${refs?.languages.tel?'installed':'missing'} · No cloud fallback`;const requested=new URLSearchParams(window.location?.search||'').get('task');if(state.tasks.length)await loadTask(state.tasks.find(task=>task.id===requested)?.id||state.tasks[0].id);else await newTask();}
window.officeDraft={state,api,flush,dirty,render,renderTasks,renderPaper,loadTask,pushUndo,switchTab,toast,download};
start().catch(e=>toast('Could not start the workspace: '+e.message,true));
