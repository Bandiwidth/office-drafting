// Reviewed bilingual wording. Match complete sentences only, never similar text.
const pairs = [
  ['Wishing you a joyous Diwali!', 'మీకు ఆనందోత్సాహాలతో నిండిన దీపావళి శుభాకాంక్షలు!'],
  ['Diwali, also known as the Festival of Lights, is celebrated to mark the victory of light over darkness, good over evil, and knowledge over ignorance.', 'దీపాల పండుగగా ప్రసిద్ధి చెందిన దీపావళి, చీకటిపై వెలుగు, చెడుపై మంచి, అజ్ఞానంపై జ్ఞానం సాధించిన విజయానికి ప్రతీక.'],
  ['It is a time of reflection, renewal, and gratitude.', 'ఆత్మపరిశీలనకు, నూతనోత్సాహానికి, కృతజ్ఞతాభావాన్ని వ్యక్తం చేయడానికి ఇది ఒక చక్కని సందర్భం.'],
  ['May this festival bring you and your families peace, prosperity, and happiness.', 'ఈ పండుగ మీకు, మీ కుటుంబ సభ్యులకు శాంతి, సిరిసంపదలు, సంతోషాన్ని చేకూర్చాలని ఆకాంక్షిస్తున్నాము.'],
  ['Please ensure that all work is completed before leaving for the holiday to avoid any delays.', 'దయచేసి సెలవులకు వెళ్లే ముందు పనులన్నింటినీ పూర్తి చేసి, జాప్యం జరగకుండా చూసుకోండి.'],
  ["Let's make this Diwali a memorable one by maintaining our productivity and efficiency.", 'మన ఉత్పాదకతను, పనితీరులో సమర్థతను కొనసాగిస్తూ ఈ దీపావళిని మరింత స్మరణీయంగా చేసుకుందాం.']
];
const key=text=>text.normalize('NFC').trim().replace(/[’‘]/gu,"'").replace(/\s+/gu,' ').toLocaleLowerCase('en');
const memory=new Map(pairs.map(([source,translation])=>[key(source),translation]));
export function reviewedTelugu(source){return memory.get(key(source))||null;}
export const teluguStyleGuide='Use natural, respectful standard Telugu suitable for office communication. Translate meaning, not English word order. Write Telugu prose in Telugu script, never mixed with Devanagari/Hindi or other Indian scripts. Preserve original names, identifiers and placeholders exactly. Avoid invented greetings and literal calques. A festival greeting is "దీపావళి శుభాకాంక్షలు", not "శుభోచ్చీ". Introspection is "ఆత్మపరిశీలన". Victory over ignorance is "అజ్ఞానంపై జ్ఞానం సాధించిన విజయం". Preserve the source speaker, requested action, certainty and timing. Context is background only: translate only source without adding surrounding sentences.';
const foreign=word=>/[^\p{Script_Extensions=Telugu}\p{Script_Extensions=Latin}\p{Script_Extensions=Common}\p{Script_Extensions=Inherited}]/u.test(word);
// Send only vocabulary guidance relevant to the source sentence.
// Office-approved glossary entries take precedence.
const meaningRules=[
  {when:s=>/\bagainst\s+(?:the\s+)?reference\b/i.test(s),hint:'Against a reference means associated with that reference, not opposed to it or before the reference; before a date means strictly before that date.',bad:/వ్యతిరేకంగా|సూచన(?:కు|కి)\s+ముందు/},
  {when:s=>/\brepresentation\b/i.test(s)&&/\b(?:submitted|enclosed|forwarded|examination|examine|service record)\b/i.test(s)&&!/\b(?:political|parliament|assembly|council|board|union)\b/i.test(s),hint:'In this personnel correspondence, representation means a submitted petition (వినతిపత్రం), not political representation or employees collectively.',bad:/ప్రా?తినిధ్?య|ప్రతినిధ్య/},
  {when:s=>/\bmeeting\s+scheduled\b/i.test(s),hint:'A scheduled meeting is one planned to take place (జరగాల్సిన), not a meeting already held.',bad:/జరిగిన\s+సమావేశ/},
  {when:s=>/\b(?:communicated|informed|sent|provided|shared)\s+separately\b/i.test(s),hint:'Separately means విడిగా, not in a different way. Preserve the communication action without inventing a new method.',bad:/వేరే\s+విధంగా/},
  {when:s=>/\bdesignation\b/i.test(s)&&/\b(?:entry|service record)\b/i.test(s),hint:'Designation means job title/rank (హోదా), not personal identity or an instruction/direction. Service record means సేవా రికార్డు, not a record of servants.',bad:/గుర్తింపు|సేవకుల|నిర్దేశం/},
  {when:s=>/\bchange\s+of\s+posting\b/i.test(s)&&!/\bduties\b/i.test(s),hint:'A change of posting concerns posting/assignment location (పోస్టింగ్ మార్పు); do not change it into a change of duties.',bad:/విధుల(?:ను|్లో|లో)?\s*మార్చ|విధుల\s*మార్పు/},
  {when:(s,context)=>/\bverify\s+the\s+position\b/i.test(s)&&/\b(?:work|request|statement|status)\b/i.test(s+' '+context)&&!/\b(?:physical|location|valve|coordinates)\b/i.test(s+' '+context),hint:'Verify the position means independently verify the actual status (వాస్తవ స్థితి), not a physical location.',bad:/స్థాన(?:ాన్ని|ం|ానికి|ంలో)/},
  {when:s=>/\bservice\s+record\b/i.test(s),hint:'Service record means the employee service record (సేవా రికార్డు).',bad:/సేవకుల\s*రికార్డు/},
  {when:s=>/\bwith reference to\b/i.test(s)&&/\bdated\b/i.test(s),hint:'Keep the reference identifier and its date in their correct roles: the letter/reference is dated on the supplied date; the reference identifier is not a date.',bad:/\{\{(?:priorReference|reference)\}\}\s+తేదీ/},
  {when:s=>/\bdo not\b[\s\S]*\buntil\b/i.test(s),hint:'Do not act until a condition is met means no action BEFORE that condition. Use వరకు with the prohibition, or express permission only AFTER the condition. Never forbid action only after the condition.',bad:/తర్వాతే[\s\S]*వద్దు/},
  {when:s=>/\bwithout\s+(?:any\s+)?recommendation\b/i.test(s),hint:'Without recommendation means no recommendation (సిఫారసు / సిఫార్సు), not that the application was never examined.',missing:body=>!/సిఫార[స్స్]/.test(body)},
  {when:s=>/\bbefore leaving\b/i.test(s)&&/\bholiday\b/i.test(s)&&!/\bvisit\b/i.test(s),hint:'Leaving for the holiday means going on holiday/leave (సెలవులకు), not going for a visit (సందర్శనకు). Preserve the instruction to finish work before leaving.',bad:/సందర్శన/},
  {when:s=>/\bgood over evil\b/i.test(s)&&/\bvictory\b/i.test(s),hint:'The source describes good triumphing over evil, not separating good from bad. Preserve the victory relation.',bad:/మంచి[\s\S]{0,30}చెడు[\s\S]{0,30}వేరు/}
];
export function teluguMeaningGuidance(source,context=''){return meaningRules.filter(rule=>rule.when(source,typeof context==='string'?context:'')).map(rule=>rule.hint).join(' ');}
export function teluguQualityIssues(body, source,context=''){
  const sourceWords=new Set(source.normalize('NFC').match(/[\p{L}\p{M}]+/gu)||[]);
  const introduced=(body.normalize('NFC').replace(/\{\{\w+\}\}/g,'').match(/[\p{L}\p{M}]+/gu)||[]).filter(word=>foreign(word)&&!sourceWords.has(word));
  const issues=[];
  if(introduced.length)issues.push('The translation introduced another script in '+[...new Set(introduced)].slice(0,4).join(', ')+'. Write Telugu words entirely in Telugu script; preserve only names supplied in the source.');
  for(const phrase of ['శుభోచ్చీ','అజ్ఞానాన్ని పై'])if(body.includes(phrase)&&!source.includes(phrase))issues.push('Replace the unnatural wording “'+phrase+'” with idiomatic Telugu while retaining the source meaning.');
  if(/reflection,\s*renewal,?\s*and gratitude/i.test(source)&&/ప్రతిబింబించే/.test(body))issues.push('Here reflection means introspection, not a physical reflection. Use natural Telugu such as ఆత్మపరిశీలన.');
  for(const rule of meaningRules)if(rule.when(source,typeof context==='string'?context:'')&&((rule.bad&&rule.bad.test(body))||rule.missing?.(body)))issues.push(rule.hint);
  // Context is useful for disambiguation but must never become extra output.
  for(const label of ['తదుపరి వాక్యం:','మునుపటి వాక్యం:','Next sentence:','Previous sentence:'])if(body.includes(label)&&!source.includes(label))issues.push('Do not translate or repeat context labels or adjacent sentences. Return only the source sentence, once.');
  return issues;
}
