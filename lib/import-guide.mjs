import {cleanWorkbook,columnName,cellValue,financeCategories} from './finance-core.mjs';
const headers={account:['account','account name','ledger','ledger name','particulars','description'],debit:['debit','debit amount','dr'],credit:['credit','credit amount','cr'],category:['category','classification','account type','type']};
const patterns={asset:/\b(cash|bank|equipment|furniture|inventory|receivable|land|building)\b/i,liability:/\b(payable|loan|creditor|borrowing)\b/i,equity:/\b(capital|retained earnings|equity)\b/i,income:/\b(sales|revenue|service income|interest income)\b/i,expense:/\b(expense|costs?|salary|salaries|rent|wages|utilities)\b/i};
export function categorySuggestions(book,mapping){
  const sheet=book.sheets.find(s=>s.name===mapping.sheet),items=[];if(!sheet)return items;
  for(let row=mapping.startRow;row<=mapping.endRow;row++){const address=columnName(mapping.account)+row,categoryCell=columnName(mapping.category)+row,account=sheet.cells[address],existing=sheet.cells[categoryCell];if(!account||account.kind==='formula'||existing?.input.trim())continue;const text=String(cellValue(account)),matches=Object.keys(patterns).filter(key=>patterns[key].test(text));if(matches.length===1)items.push({row,account:text,category:matches[0],source:sheet.name+'!'+address,target:categoryCell});}
  return items;
}
export function importGuide(input){
  const book=cleanWorkbook(input),sheets=book.sheets.map(sheet=>{
    let best={score:0,row:1,columns:{}};
    for(let row=1;row<=Math.min(20,1000);row++){const found={};for(let column=1;column<=50;column++){const cell=sheet.cells[columnName(column)+row];if(!cell||cell.kind==='formula')continue;const text=String(cellValue(cell)).trim().toLowerCase().replace(/[_\s]+/g,' ');for(const [key,names] of Object.entries(headers))if(names.includes(text)){if(found[key])found[key]=-1;else found[key]=column;}}const columns=Object.fromEntries(Object.entries(found).filter(([,column])=>column>0));const score=Object.keys(columns).length;if(score>best.score)best={score,row,columns};}
    const last=Math.max(1,...Object.keys(sheet.cells).map(a=>Number(a.match(/\d+$/)[0]))),mapping={...book.mapping,sheet:sheet.name,startRow:best.score>=2?Math.min(1000,best.row+1):book.mapping.startRow,endRow:Math.max(last,best.score>=2?Math.min(1000,best.row+1):book.mapping.startRow)};
    if(best.score>=2){const used=new Set(Object.values(best.columns));for(const key of ['account','debit','credit','category']){if(best.columns[key])mapping[key]=best.columns[key];else{let column=1;while(used.has(column))column++;mapping[key]=column;used.add(column);}}}
    const warnings=[];if(best.score<4)warnings.push('Some report columns could not be identified. Review all four mappings.');
    const total=sheet.cells[columnName(mapping.account)+mapping.endRow];if(total&&total.kind!=='formula'&&/^(grand\s+)?totals?$/i.test(String(cellValue(total)).trim())){mapping.endRow=Math.max(mapping.startRow,mapping.endRow-1);warnings.push('A final totals row was excluded from the suggested range. Verify the range.');}
    const preview=[];for(let row=Math.max(1,best.score>=2?best.row:1);row<=Math.min(last,(best.score>=2?best.row:1)+11);row++)preview.push({row,cells:Array.from({length:Math.min(10,Math.max(4,...Object.keys(sheet.cells).map(a=>{let n=0;for(const c of a.match(/^[A-Z]+/)[0])n=n*26+c.charCodeAt(0)-64;return n;})))},(_,i)=>({address:columnName(i+1)+row,input:sheet.cells[columnName(i+1)+row]?.input||''}))});
    return {name:sheet.name,score:best.score,headerRow:best.score>=2?best.row:null,mapping,preview,warnings,categories:categorySuggestions(book,mapping)};
  });
  const chosen=[...sheets].sort((a,b)=>b.score-a.score)[0];return {name:book.name,selectedSheet:chosen.name,sheets,notice:'Suggestions are tentative. Import requires your confirmation; report approval is a separate step. Original file bytes are kept unchanged.'};
}
export function applyImportGuide(input,mapping,applyCategories){
  const book=cleanWorkbook({...input,mapping:{...input.mapping,...mapping,confirmed:false}});if(applyCategories)for(const item of categorySuggestions(book,book.mapping)){const sheet=book.sheets.find(s=>s.name===book.mapping.sheet);sheet.cells[item.target]={input:item.category,kind:'text'};}
  book.notices.push('Imported after mapping review. Suggested categories, if accepted, still require accounting review.');return cleanWorkbook(book);
}
