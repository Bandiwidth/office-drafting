import {translationRequest,numericFacts} from './translation.mjs';
import {cleanBodyFormat,bodyFormatText} from './body-format.mjs';
export const types = ['Office letter', 'Official email', 'Employee representation', 'Reply', 'Reminder', 'Forwarding letter', 'Internal note'];
export const fields = {
  office: 'Office / organisation', sender: 'Sender name and designation', recipient: 'Recipient', date: 'Document date', reference: 'Outgoing reference',
  subject: 'Subject', priorReference: 'Earlier letter reference', priorDate: 'Earlier letter date', action: 'Requested action', amount: 'Amount (exact)', attachments: 'Attachments (one per line)', approval: 'Approval / sanction evidence'
};
export const defaultSettings = { provider: 'off', localOnly: true, model: '', endpoint: 'http://127.0.0.1:11434', office: '', sender: '', language: 'en' };
export function instructionContext(task,instruction){
  const result=structuredClone(task),changes=[];
  const translation=translationRequest(instruction,task.body);
  if(translation){if(result.language!==translation.language){result.language=translation.language;changes.push('Document language: '+(result.language==='te'?'Telugu':'English'));}return {task:result,changes};}
  const match=instruction.match(/\b(?:write|draft|prepare|compose|create)\s+(?:(?:me|us)\s+)?(?:(?:a|an|the|this)\s+)?(?:(?:formal|official|short|polite|detailed)\s+)*(e-?mail|internal note|forwarding letter|reminder|reply|application|representation|letter)\b/i);
  const names={'email':'Official email','e-mail':'Official email','internal note':'Internal note','forwarding letter':'Forwarding letter',reminder:'Reminder',reply:'Reply',application:'Employee representation',representation:'Employee representation',letter:'Office letter'};
  if(match&&names[match[1].toLowerCase()]!==result.type){result.type=names[match[1].toLowerCase()];result.role=result.type==='Employee representation'?'employee':result.role;changes.push('Document type: '+result.type);}
  if(!result.facts.action.value.trim()&&match){result.facts.action={value:instruction.trim(),confirmed:false,provenance:'user supplied',source:'Conversation request'};changes.push('Use your request as the unconfirmed drafting purpose.');}
  if(!result.facts.recipient.value.trim()){
    const recipient=instruction.match(/\b(?:to|for)\s+(?:the\s+)?(staff|team)\b/i);
    if(recipient){result.facts.recipient={value:recipient[1].toLowerCase()==='staff'?'Staff':'Team',confirmed:false,provenance:'user supplied',source:'Conversation request'};changes.push('Recipient: '+result.facts.recipient.value+' (unconfirmed)');}
  }
  const language=instruction.match(/\b(?:in|into|to)\s+(?:formal\s+)?(Telugu|English)\b/i)||(/తెలుగు\s*(?:లో|భాషలో)/u.test(instruction)?['','Telugu']:/ఇంగ్లీషు\s*లో|ఆంగ్లం\s*లో/u.test(instruction)?['','English']:null);
  if(language){const code=language[1].toLowerCase()==='telugu'?'te':'en';if(result.language!==code){result.language=code;changes.push('Document language: '+language[1]);}}
  return {task:result,changes};
}
export function protectExactFacts(text,task){
  const keys=['office','sender','recipient','date','reference','priorReference','priorDate','amount'];
  for(const key of keys.sort((a,b)=>(task.facts[b]?.value?.trim().length||0)-(task.facts[a]?.value?.trim().length||0))){
    const value=task.facts[key]?.value?.trim();if(!value)continue;
    const escaped=value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),pattern=new RegExp('(?<![\\p{L}\\p{N}_])'+escaped+'(?![\\p{L}\\p{N}_])','gu');
    // Never replace a value inside an existing placeholder (e.g. a name "date").
    text=text.split(/(\{\{[^{}]*\}\})/g).map((part,i)=>i%2?part:part.replace(pattern,()=>'{{'+key+'}}')).join('');
  }
  return text;
}
export function writingGuidance(task){
  const notes=[];
  if(/^(test|testing|letter|subject|sample|work)$/i.test(task.facts.subject.value.trim()))notes.push('What is the letter about? Replace the test subject with a specific subject.');
  if(/^(?:(?:please|kindly)\s+)?(?:complete|finish|review|inspect|fix|do|check)(?:\s+(?:the|all|this|pending))?\s+(?:work|issues?|matter|task|it|problems?)(?:\s+(?:immediately|asap|soon|urgently))?[.!]?$/i.test(task.facts.action.value.trim()))notes.push('What work or issue should the recipient deal with? A specific description will produce a more useful letter than “complete the work.”');
  return notes;
}
export function newTask(settings = defaultSettings) {
  return { title: 'Untitled correspondence', type: 'Reminder', language: settings.language || 'en', role: 'officer', templateId: '', facts: Object.fromEntries(Object.keys(fields).map(k => [k, { value: k === 'office' || k === 'sender' ? settings[k] || '' : '', provenance: 'user supplied', confirmed: false, source: '' }])), body: '', actionAtDraft: null, messages: [], reviewed: false };
}
export function cleanTask(input) {
  if (!input || typeof input !== 'object' || !types.includes(input.type) || !['en','te'].includes(input.language) || !['officer','employee'].includes(input.role)) throw new Error('Invalid document details.');
  const t = newTask();
  for (const k of ['title','templateId','body']) { if (typeof input[k] !== 'string' || input[k].length > (k === 'body' ? 50000 : 300)) throw new Error('Invalid ' + k); t[k] = input[k]; }
  t.type = input.type; t.language = input.language; t.role = input.role; t.reviewed = input.reviewed === true;
  if(input.bodyFormat!=null){const format=cleanBodyFormat(input.bodyFormat);if(bodyFormatText(format)===t.body)t.bodyFormat=format;}
  t.actionAtDraft=typeof input.actionAtDraft==='string'?input.actionAtDraft.slice(0,5000):null;
  for (const k of Object.keys(fields)) {
    const f = input.facts?.[k];
    if (!f || typeof f.value !== 'string' || f.value.length > 5000) throw new Error('Invalid fact: ' + k);
    t.facts[k] = { value: f.value, provenance: ['user supplied','extracted'].includes(f.provenance) ? f.provenance : 'user supplied', confirmed: f.confirmed === true, source: String(f.source || '').slice(0,300) };
  }
  t.messages = (Array.isArray(input.messages) ? input.messages : []).slice(-40).map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', text: String(m.text).slice(0,8000) }));
  return t;
}
export function value(task, k) { return task.facts[k]?.value?.trim() || '[' + fields[k].toUpperCase() + ' REQUIRED]'; }
export function draft(task) {
  const a = '{{action}}', ref = '{{priorReference}}', date = '{{priorDate}}';
  if (task.language === 'te') {
    const bodies = {
      Reminder: `పైన పేర్కొన్న ${ref}, తేదీ ${date} లేఖకు సంబంధించి ఈ జ్ఞాపికను సమర్పిస్తున్నాము.\n\n${a}\n\nఈ విషయాన్ని పరిశీలించి తగిన చర్య తీసుకోగలరు.`,
      'Employee representation': `క్రింది విషయాన్ని మీ పరిశీలనకు వినయపూర్వకంగా సమర్పిస్తున్నాను.\n\n${a}\n\nనా అభ్యర్థనను పరిశీలించి తగిన చర్య తీసుకోగలరు.`,
      Reply: `మీ లేఖ ${ref}, తేదీ ${date} కు సంబంధించి క్రింది విషయాన్ని తెలియజేస్తున్నాము.\n\n${a}`,
      'Forwarding letter': `మీ పరిశీలన మరియు తగిన చర్య నిమిత్తం సంబంధిత పత్రాలను పంపుతున్నాము.\n\n${a}`,
      'Internal note': `పరిశీలనకు సమర్పించిన విషయం:\n\n${a}\n\nతదుపరి సూచనల కోసం సమర్పించడమైనది.`
    }; return bodies[task.type] || `క్రింది విషయాన్ని మీ దృష్టికి తీసుకువస్తున్నాము.\n\n${a}\n\nతగిన చర్య తీసుకోగలరు.`;
  }
  const bodies = {
    Reminder: `With reference to letter ${ref}, dated ${date}, this reminder is submitted for your consideration.\n\n${a}\n\nKindly review the matter and communicate the action taken.`,
    'Employee representation': `I respectfully submit the following request for your consideration.\n\n${a}\n\nI request that the matter be examined and appropriate action taken.`,
    Reply: `With reference to your letter ${ref}, dated ${date}, the following is submitted in reply.\n\n${a}`,
    'Forwarding letter': `The accompanying correspondence is forwarded for your examination and appropriate action.\n\n${a}`,
    'Internal note': `The following matter is submitted for consideration.\n\n${a}\n\nSubmitted for further directions.`,
    'Official email': `Dear Sir / Madam,\n\n${a}\n\nThank you for your consideration.`
  }; return bodies[task.type] || `The following matter is brought to your attention.\n\n${a}\n\nKindly examine the matter and take appropriate action.`;
}
export function resolveBody(task) { return task.body.replace(/\{\{(\w+)\}\}/g, (_, k) => fields[k] ? value(task,k) : '[UNKNOWN FIELD: '+k+']'); }
export function validate(task, sources = [], template = null) {
  const issues = []; const add = (code, message, severity = 'blocking') => issues.push({code,message,severity});
  const outgoing=resolveBody(task);
  const required = ['sender','recipient','date','subject','action'];
  if (['Reminder','Reply'].includes(task.type)) required.push('priorReference','priorDate');
  for (const k of required) if (!task.facts[k].value.trim()) add('missing:'+k, fields[k] + ' is required.');
  for (const [k,f] of Object.entries(task.facts)) if (f.value.trim() && !f.confirmed) add('confirm:'+k, 'Confirm ' + fields[k].toLowerCase() + '.');
  for(const [k,f]of Object.entries(task.facts))if(f.value.trim()&&f.provenance==='extracted'){
    const sourceId=f.source.match(/^([a-f0-9-]{36}) \| /)?.[1];
    if(f.source.startsWith('Deleted source')||sourceId&&!sources.some(source=>source.id===sourceId))add('source:'+k,'The reference for '+fields[k].toLowerCase()+' is no longer available. Verify the fact against an available source.');
  }
  for (const k of ['date','priorDate']) {
    const v = task.facts[k].value;
    if (v && (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v)) || new Date(v).toISOString().slice(0,10) !== v)) add('date:'+k, fields[k]+' must be a valid YYYY-MM-DD date.');
  }
  if (task.facts.date.value && task.facts.priorDate.value > task.facts.date.value) add('chronology','Earlier letter date is after the document date.');
  if (!task.body.trim()) add('body','Generate or write the body.');
  if(task.actionAtDraft!=null&&!task.body.includes('{{action}}')&&task.actionAtDraft!==task.facts.action.value)add('action-changed','The requested action changed after this letter was written. Regenerate or edit the body to match before final export.');
  if (/\[[^\]]*(?:REQUIRED|TODO|INSERT)[^\]]*\]/i.test(resolveBody(task))) add('placeholder','The body contains unresolved placeholders.');
  if(/\[(?:your|sender|recipient)[ -]?(?:name|designation|address)\]/i.test(task.body))add('placeholder-name','The body contains a name or address placeholder. The app already supplies the sender block.');
  if (/\{\{(?!office\}\}|sender\}\}|recipient\}\}|date\}\}|reference\}\}|subject\}\}|priorReference\}\}|priorDate\}\}|action\}\}|amount\}\}|attachments\}\}|approval\}\})/.test(task.body)) add('token','Unknown protected field in the body.');
  const teluguOrder=/(?:మంజూరు\s*చేయబడింది|మంజూరైంది|మంజూరు\s*చేయడమైనది|ఆమోదించబడింది|ఆమోదించడమైనది|అనుమతించబడింది)/u.test(outgoing);
  if ((/\b(approved|sanctioned|approval has been|sanction is hereby|hereby sanction)\b/i.test(outgoing)||teluguOrder) && !task.facts.approval.value.trim()) add('approval','Approval or sanction language needs supporting evidence.');
  if (/\b(repeated reminders|several reminders|as per (the )?rules|rule \d)\b/i.test(outgoing)) add('claim','Verify the statement about earlier reminders or rules.');
  const supplied=[...Object.values(task.facts).map(f=>f.value),...(task.messages||[]).filter(m=>m.role==='user').map(m=>m.text)].join('\n');
  const support=supplied.split(/\n|(?<=[.!?;])\s+/).filter(sentence=>! /\b(?:do not|don't|never|avoid|without|no mention of)\b/i.test(sentence)).join('\n');
  for(const [code,pattern,label]of [['clients',/\bclients?\b/i,'clients'],['customers',/\bcustomers?\b/i,'customers'],['reputation',/\breputation(?:al)?\b/i,'reputational consequences'],['loss',/\bfinancial (?:loss|losses)\b/i,'financial losses'],['urgency',/\b(?:urgent(?:ly)?|immediate(?:ly)?)\b/i,'urgency'],['severity',/\b(?:critical (?:issues?|defects?|problems?)|significant (?:risks?|danger))\b/i,'a severity or risk assessment']])if(pattern.test(outgoing)&&!pattern.test(support))add('unsupported:'+code,'The draft introduces '+label+' without supporting task information. Remove or substantiate the statement.');
  if (task.role === 'employee' && task.type !== 'Employee representation') add('authority','Select Employee representation when drafting as an employee.');
  if (task.role === 'employee' && (/\b(hereby direct|hereby sanction|sanction is hereby|you are instructed)\b/i.test(outgoing)||teluguOrder)) add('authority-language','Employee requests must not issue officer instructions.');
  for (const name of task.facts.attachments.value.split('\n').map(s=>s.trim()).filter(Boolean)) if (!sources.some(s=>s.name === name)) add('attachment:'+name, 'Attachment not uploaded: '+name);
  if (!template?.approved) add('template','Use an office-approved DOCX template for final export. Starter formats are drafts.');
  if (!task.reviewed) add('review','Review the complete document before final export.');
  if (task.language === 'te') add('telugu','Have Telugu wording and rendering reviewed before issue.','warning');
  return issues;
}
export function draftContentIssues(task,body,instruction=''){
  const context={...task,body,messages:[...(task.messages||[]),{role:'user',text:instruction}]};
  return validate(context).filter(issue=>issue.code.startsWith('unsupported:')||['approval','authority-language','placeholder-name'].includes(issue.code));
}
export function checkModelBody(body, original) {
  if (typeof body !== 'string' || !body.trim() || body.length > 50000) throw new Error('The model did not return a valid body.');
  const oldTokens = original.match(/\{\{\w+\}\}/g) || [];
  for (const token of new Set(oldTokens)) if (!body.includes(token)) throw new Error('The response removed protected fact '+token+'. Your draft was not changed.');
  for (const token of body.match(/\{\{(\w+)\}\}/g) || []) if (!fields[token.slice(2,-2)]) throw new Error('The response introduced an unknown fact field.');
  const originalNumbers = new Set(numericFacts(original));
  const outputNumbers = new Set(numericFacts(body));
  for (const number of outputNumbers) if (!originalNumbers.has(number)) throw new Error('The response introduced a numeric claim. Add it as a confirmed fact first.');
  for (const number of originalNumbers) if (!outputNumbers.has(number)) throw new Error('The response removed an existing numeric fact. Your draft was not changed.');
  return body;
}

export function reconcileModelBody(body, original, task) {
  if(typeof body!=='string'||!body.trim()||body.length>50000)throw new Error('The model did not return a valid body.');
  const notes=[],keys=Object.keys(fields);
  body=body.replace(/\{\{\s*(\w+)\s*\}\}/g,(token,key)=>{const canonical=keys.find(k=>k.toLowerCase()===key.toLowerCase());return canonical?'{{'+canonical+'}}':token;});
  body=protectExactFacts(body,task);original=protectExactFacts(original,task);
  const required=[...new Set(original.match(/\{\{\w+\}\}/g)||[])];
  // Reattach exact known values if the model expanded a placeholder.
  for(const token of required){
    const value=task.facts[token.slice(2,-2)]?.value?.trim();
    if(body.includes(token)||!value)continue;
    const escaped=value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    body=body.replace(new RegExp('(?<![\\p{L}\\p{N}_])'+escaped+'(?![\\p{L}\\p{N}_])','gu'),()=>token);
  }
  // Required factual paragraphs belong to the app. Restore an omitted block
  // from the original rather than discarding the fact or the entire response.
  const paragraphs=body.split(/\n\s*\n/);
  for(const [index,source]of original.split(/\n\s*\n/).entries()){
    const tokens=[...new Set(source.match(/\{\{\w+\}\}/g)||[])];
    if(!tokens.length||tokens.every(t=>paragraphs.some(p=>p.includes(t))))continue;
    const existing=paragraphs.findIndex(p=>tokens.some(t=>p.includes(t)));
    if(existing>=0)paragraphs[existing]=source;
    else paragraphs.splice(Math.min(index,paragraphs.length),0,source);
    notes.push('The app retained the original '+tokens.map(t=>fields[t.slice(2,-2)]||t).join(' / ').toLowerCase()+' paragraph because the model omitted a protected field. Review the surrounding wording.');
  }
  return {body:checkModelBody(paragraphs.join('\n\n'),original),notes};
}
