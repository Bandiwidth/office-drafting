// Recognise explicit translation commands at the edges of a supplied passage.
// Do not classify "write a letter in Telugu about ..." as translation.
export function translationRequest(instruction, fallback = '') {
  const command = '(?:translate(?:\\s+(?:this|it|the (?:following|above)(?: text)?))?|(?:write|render)\\s+(?:this|it))\\s+(?:in|into|to)\\s+(?:formal\\s+)?(Telugu|English)';
  const text = instruction.trim();
  const prefix = text.match(new RegExp('^(?:please\\s+)?' + command + '(?:\\s*[:—–-]\\s*|\\s*\\n+|[.!]?\\s*$)', 'i'));
  const suffix = text.match(new RegExp('(?:^|\\s+|[—–-]\\s*)(?:please\\s+)?' + command + '[.!]?\\s*$', 'i'));
  if (!prefix && !suffix) return null;
  const match = prefix || suffix;
  let source = (prefix ? text.slice(prefix[0].length) : text.slice(0, suffix.index)).trim().replace(/\s*[—–-]\s*$/, '').trim();
  if (!source) source = fallback.trim();
  if ((source.startsWith('"') && source.endsWith('"')) || (source.startsWith('“') && source.endsWith('”'))) source = source.slice(1, -1).trim();
  return {source, language: match[1].toLowerCase() === 'telugu' ? 'te' : 'en'};
}

// Keep a leading sign as part of a numeric fact. Dates, reference components,
// ranges and decimal formatting retain their existing exact comparisons.
export const numericFacts=text=>(text.match(/[+\-\u2212]?\d+(?:[,.\/-]\d+)*/g)||[]).map(value=>value.replace(/^\u2212/,'-'));

// Conservative reference/attachment forms. Ordinary hyphenated prose is not a
// reference. Existing application placeholders are handled separately.
export function translationIdentifiers(text){
  return text.replace(/\{\{\w+\}\}/g,'').match(/\b(?:[A-Z][A-Z0-9]*(?:[\/_-][A-Z0-9]+)+|(?:Annexure|Appendix|Schedule)[ -][A-Za-z0-9]+)\b/g)||[];
}
export function protectTranslationLiterals(source){
  const entries=[];let index=0;
  const values=new Set(translationIdentifiers(source));
  const mask=value=>{
    let token;do{token='{{literal'+index+++'}}';}while(source.includes(token));
    entries.push({token,value});return token;
  };
  let masked=source.split(/(\{\{\w+\}\})/g).map((part,i)=>i%2?part:part.replace(/\b(?:[A-Z][A-Z0-9]*(?:[\/_-][A-Z0-9]+)+|(?:Annexure|Appendix|Schedule)[ -][A-Za-z0-9]+)\b/g,value=>values.has(value)?mask(value):value)).join('');
  // The app owns literal dates, times, amounts, percentages and counts too.
  // The model translates the sentence around them, not their formatting.
  masked=masked.split(/(\{\{\w+\}\})/g).map((part,i)=>i%2?part:part.replace(/[+\-\u2212]?\d+(?:[,.\/:-]\d+)*%?/g,mask)).join('');
  return {source:masked,literals:entries.map(entry=>({...entry})),restore(body){
    if(typeof body!=='string')throw new Error('The translation changed a number or protected field. Your draft is unchanged.');
    // Exact expanded literals are also acceptable, just like expanded known
    // facts. Never infer a missing value or convert words/reformatted numbers.
    for(const {token,value}of entries){
      if(body.includes(token))continue;
      const pattern=new RegExp('(?<![A-Za-z0-9])'+value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?![A-Za-z0-9])','g');let replaced=false;
      body=body.split(/(\{\{\w+\}\})/g).map((part,i)=>i%2||replaced?part:part.replace(pattern,match=>{if(replaced)return match;replaced=true;return token;})).join('');
    }
    // Validate all markers before restoration, including repeated original
    // fields. Missing, duplicated or invented protected markers fail closed.
    const tokens=text=>(text.match(/\{\{\w+\}\}/g)||[]).sort();
    if(typeof body!=='string'||JSON.stringify(tokens(body))!==JSON.stringify(tokens(masked)))throw new Error('The translation changed a number or protected field. Your draft is unchanged.');
    for(const {token,value}of entries)body=body.replace(token,()=>value);
    return body;
  }};
}

export function validateTranslation(body, source, language) {
  if (typeof body !== 'string' || !body.trim() || body.length > 50000) throw new Error('The model returned an empty or invalid translation. Your draft is unchanged.');
  const tokens = text => text.match(/\{\{\w+\}\}/g) || [];
  const numbers = text => numericFacts(text.replace(/\{\{\w+\}\}/g, ''));
  for (const extract of [tokens, numbers]) {
    const before = [...extract(source)].sort(), after = [...extract(body)].sort();
    if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('The translation changed a number or protected field. Your draft is unchanged.');
  }
  if(JSON.stringify(translationIdentifiers(source).sort())!==JSON.stringify(translationIdentifiers(body).sort()))throw new Error('The translation changed a protected reference or attachment identifier. Your draft is unchanged.');
  if (language === 'te' && !/[\u0C00-\u0C7F]/u.test(body)) throw Object.assign(new Error('The model did not return Telugu. Your draft is unchanged. Try another model with Telugu support.'),{code:'TRANSLATION_LANGUAGE'});
  return body.trim();
}

// Keep calls small while retaining paragraph boundaries and complete sentences
// wherever possible. The separators rebuild the document after translation.
export function translationSections(text, limit=220) {
  const sections=[];
  for(const paragraph of text.trim().split(/\n\s*\n/)){
    let chunk='',first=true;
    const push=()=>{if(chunk.trim()){sections.push({source:chunk.trim(),separator:sections.length?(first?'\n\n':' '):''});first=false;chunk='';}};
    let start=0;const sentences=[];
    for(const match of paragraph.matchAll(/[.!?](?=\s|$)/g)){sentences.push(paragraph.slice(start,match.index+1));start=match.index+1;}
    if(start<paragraph.length)sentences.push(paragraph.slice(start));
    for(const sentence of sentences){
      if(chunk.length+sentence.length>limit)push();
      if(chunk&&/^\s/.test(sentence)&&! /\s$/.test(chunk))chunk+=' ';
      for(const word of sentence.match(/\S+\s*/g)||[]){if(chunk.length+word.length>limit)push();chunk+=word;}
      // Translate each sentence separately. Do not pack a whole paragraph into
      // one call: Telugu may consume many more tokens than its English source.
      push();
    }
    push();
  }
  return sections;
}
