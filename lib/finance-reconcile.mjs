// Diagnostic suggestions only: never alter accounts, categories or totals.
export function reconciliation(rows,totals,{money,moneyText}){
  const hints=[],groups=new Map(),abs=value=>value<0n?-value:value,difference=money(totals.trialDifference),target=abs(difference);
  const add=(code,message,sources=[])=>{if(hints.length<20)hints.push({code,message,sources});};
  for(const row of rows){const key=JSON.stringify([row.account.normalize('NFC').trim().replace(/\s+/g,' ').toLowerCase(),row.category,row.debit,row.credit]);const group=groups.get(key)||[];group.push(row);groups.set(key,group);}
  for(const group of groups.values())if(group.length>1)add('possible-duplicate',group.length+' rows have the same account, category, debit and credit: '+group[0].account+'. Check the source ledger before treating any as a duplicate.',group.map(row=>row.source).slice(0,10));
  if(target){
    add('difference','Debit minus credit is '+moneyText(difference)+'. '+(difference>0n?'Debits exceed credits.':'Credits exceed debits.')+' These are supplied closing balances; no correction has been made.');
    for(const row of rows){const net=money(row.debit)-money(row.credit);if(abs(net)===target)add('matches-difference',row.account+' has a net balance equal to the absolute trial-balance difference ('+moneyText(target)+'). An omitted, repeated or incorrect entry could explain this; compare the ledger.',[row.source,row.debitSource,row.creditSource]);else if(abs(net)*2n===target)add('possible-reversal',row.account+' has a net balance of half the difference. Moving this balance to the opposite side would change the difference by '+moneyText(target)+'. Verify its debit/credit side; this is a possibility, not a finding.',[row.source,row.debitSource,row.creditSource]);}
  }
  for(const row of rows)if(money(row.balance)<0n)add('reverse-balance',row.account+' has a balance opposite to the usual side for '+row.category+'. It may be valid; verify classification and the source balance.',[row.source]);
  if(!hints.length)add('reconciled','No additional reconciliation candidates were found. A balanced trial balance can still contain omitted, misclassified or duplicated entries.');
  return {hints,limited:hints.length===20,basis:'Suggestions use the mapped trial-balance rows and exact minor-unit arithmetic. They do not identify a proven error or authorise an adjustment.'};
}
