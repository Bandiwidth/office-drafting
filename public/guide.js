const search=document.querySelector('#guide-search');
const entries=[...document.querySelectorAll('[data-guide-entry]')];
const questions=[...document.querySelectorAll('#faq details')];
const groups=[...document.querySelectorAll('.faq-group')];
const faq=document.querySelector('#faq');
const status=document.querySelector('#guide-search-status');
const normalise=value=>value.normalize('NFC').toLocaleLowerCase().replace(/\s+/g,' ').trim();
const textIndex=new Map(entries.map(entry=>[entry,normalise(entry.textContent)]));
let printState=null;
function filter(){
  const words=normalise(search.value).split(' ').filter(Boolean);
  let count=0;
  for(const entry of entries){const visible=words.every(word=>textIndex.get(entry).includes(word));entry.hidden=!visible;if(visible)count++;}
  for(const group of groups)group.hidden=![...group.querySelectorAll('details')].some(question=>!question.hidden);
  faq.hidden=groups.every(group=>group.hidden);
  document.querySelector('#guide-empty').hidden=count!==0;
  status.textContent=words.length?`${count} matching sections or questions. Search includes closed FAQ answers.`:`${entries.length-questions.length} step-by-step sections and ${questions.length} FAQs. Type words to narrow the guide.`;
}
function revealAnchor(){
  let target;try{target=document.getElementById(decodeURIComponent(location.hash.slice(1)));}catch{return;}
  if(!target)return;
  if(target.hidden||target.closest('[hidden]')){search.value='';filter();}
  if(target instanceof HTMLDetailsElement)target.open=true;
  target.closest('details')?.setAttribute('open','');
  requestAnimationFrame(()=>target.scrollIntoView({block:'start'}));
}
search.addEventListener('input',filter);
document.querySelector('#guide-clear').addEventListener('click',()=>{search.value='';filter();search.focus();});
document.querySelector('#guide-expand').addEventListener('click',()=>questions.forEach(question=>{question.open=true;}));
document.querySelector('#guide-collapse').addEventListener('click',()=>questions.forEach(question=>{question.open=false;}));
document.querySelector('#guide-print').addEventListener('click',()=>window.print());
// Printing always includes every answer; afterward restore the reader's exact screen state.
window.addEventListener('beforeprint',()=>{if(printState)return;printState={hidden:[...document.querySelectorAll('#guide-entries [hidden]')],open:questions.map(question=>question.open)};printState.hidden.forEach(entry=>{entry.hidden=false;});questions.forEach(question=>{question.open=true;});});
window.addEventListener('afterprint',()=>{if(!printState)return;printState.hidden.forEach(entry=>{entry.hidden=true;});questions.forEach((question,index)=>{question.open=printState.open[index];});printState=null;});
window.addEventListener('hashchange',revealAnchor);
// A repeated click on the current anchor must also clear a search that hid it.
document.querySelectorAll('a[href^="#"]').forEach(link=>link.addEventListener('click',()=>{if(link.hash===location.hash)revealAnchor();}));
document.querySelector('.guide-controls').hidden=false;
filter();
if(location.hash)revealAnchor();
