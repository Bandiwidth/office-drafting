// Financial totals use integer minor units. Spreadsheet formula evaluation is
// delegated to xlsx-calc in a bounded worker, never to JavaScript eval or an LLM.
import {reconciliation} from './finance-reconcile.mjs';
export const financeLimits={sheets:10,rows:1000,columns:50,cells:20000,formulas:2000,input:2000};
export const financeCategories=['asset','liability','equity','income','expense'];
export function columnName(index){let name='';for(let n=index;n>0;n=Math.floor((n-1)/26))name=String.fromCharCode(65+(n-1)%26)+name;return name;}
export function addressParts(address){const match=/^([A-Z]{1,2})([1-9]\d{0,3})$/.exec(address);if(!match)throw new Error('Invalid cell address.');let column=0;for(const c of match[1])column=column*26+c.charCodeAt(0)-64;const row=Number(match[2]);if(column>financeLimits.columns||row>financeLimits.rows)throw new Error('Keep worksheets within 1,000 rows and 50 columns.');return {row,column};}
export function cellKind(input){if(input.startsWith('='))return 'formula';if(input.startsWith("'"))return 'text';return /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d{1,3})?$/.test(input)&&Number.isFinite(Number(input))?'number':'text';}
export function cleanWorkbook(input,{results=false}={}){
  if(!input||typeof input!=='object'||!Array.isArray(input.sheets)||!input.sheets.length||input.sheets.length>financeLimits.sheets)throw new Error('A workbook needs between 1 and 10 worksheets.');
  const names=new Set();let count=0,formulas=0;
  const sheets=input.sheets.map(sheet=>{
    if(!sheet||typeof sheet.name!=='string'||!sheet.name.trim()||sheet.name.length>31||/[\[\]:*?/\\\x00-\x1f]/.test(sheet.name)||sheet.name.startsWith("'")||sheet.name.endsWith("'")||['__proto__','constructor','prototype'].includes(sheet.name.toLowerCase()))throw new Error('Use a valid, unique Excel worksheet name (up to 31 characters).');
    if(names.has(sheet.name.toLowerCase()))throw new Error('Worksheet names must be unique.');names.add(sheet.name.toLowerCase());
    if(!sheet.cells||typeof sheet.cells!=='object'||Array.isArray(sheet.cells))throw new Error('Invalid worksheet cells.');
    const cells={};
    for(const [address,cell]of Object.entries(sheet.cells)){
      addressParts(address);if(!cell||typeof cell.input!=='string'||cell.input.length>financeLimits.input||/\x00/.test(cell.input))throw new Error('Cell text must be within 2,000 characters.');
      if(!cell.input.length)continue;if(++count>financeLimits.cells)throw new Error('Workbook exceeds 20,000 populated cells.');
      const kind=cellKind(cell.input);if(kind==='formula'&&++formulas>financeLimits.formulas)throw new Error('Workbook exceeds 2,000 formulas.');
      cells[address]={input:cell.input,kind};
      if(results&&kind==='formula'){
        if(['string','boolean'].includes(typeof cell.result)||(typeof cell.result==='number'&&Number.isFinite(cell.result)))cells[address].result=cell.result;
        if(cell.error)cells[address].error=String(cell.error).slice(0,250);
      }
    }
    return {name:sheet.name,cells};
  });
  const mapping=input.mapping||{},integer=(key,fallback,max)=>{const n=mapping[key]??fallback;if(!Number.isInteger(n)||n<1||n>max)throw new Error('Invalid report row or column mapping.');return n;};
  const defaultSheet=sheets.find(s=>s.name===mapping.sheet)||sheets[0],lastRow=Math.max(25,...Object.keys(defaultSheet.cells).map(a=>addressParts(a).row));
  const startRow=integer('startRow',2,1000),endRow=integer('endRow',Math.max(lastRow,startRow),1000);if(endRow<startRow)throw new Error('Report end row must follow its start row.');
  const columns=Object.fromEntries(['account','debit','credit','category'].map((key,i)=>[key,integer(key,i+1,50)]));if(new Set(Object.values(columns)).size!==4)throw new Error('Map account, debit, credit and category to different columns.');
  const reportSheet=mapping.sheet||sheets[0].name;if(!sheets.some(s=>s.name===reportSheet))throw new Error('Report worksheet not found.');
  const date=key=>{const value=String(mapping[key]||'');if(value&&(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value))throw new Error('Use valid YYYY-MM-DD report dates.');return value;};
  const from=date('from'),to=date('to');if(from&&to&&from>to)throw new Error('The report start date must precede its end date.');
  const currency=String(mapping.currency||'INR').toUpperCase();if(!/^[A-Z]{3}$/.test(currency))throw new Error('Use a three-letter currency code.');
  const book={name:String(input.name||'Untitled workbook').trim().slice(0,140)||'Untitled workbook',sheets,mapping:{sheet:reportSheet,...columns,startRow,endRow,from,to,currency,organisation:String(mapping.organisation||'').slice(0,200),confirmed:mapping.confirmed===true},notices:Array.isArray(input.notices)?input.notices.map(n=>String(n).slice(0,350)).slice(0,20):[],calculatedAt:results&&typeof input.calculatedAt==='string'?input.calculatedAt:''};
  if(Buffer.byteLength(JSON.stringify(book))>2*1024*1024)throw new Error('Workbook cell data exceeds 2 MB. Split it into smaller workbooks.');return book;
}
export function newWorkbook(){return cleanWorkbook({name:'Financial workbook',sheets:[{name:'Trial balance',cells:Object.fromEntries(['Account','Debit','Credit','Category'].map((input,i)=>[columnName(i+1)+'1',{input}]))}]});}
export function cellValue(cell){if(!cell)return '';if(cell.kind==='formula'){if(cell.error||!Object.hasOwn(cell,'result'))throw new Error(cell.error||'Recalculate this formula first.');return cell.result;}return cell.kind==='number'?cell.input:cell.input.replace(/^'/,'');}
export function money(value){
  // Reject ambiguous separators, extra decimals and silently rounded amounts.
  if(typeof value==='number'){if(!Number.isFinite(value))throw new Error('Invalid amount.');const rounded=value.toFixed(2);if(Math.abs(Number(rounded)-value)>1e-8)throw new Error('Amounts must have at most two decimal places.');value=rounded;}
  const text=String(value??'').trim();if(!text)return 0n;if(!/^-?\d{1,12}(?:\.\d{1,2})?$/.test(text))throw new Error('Use amounts up to 12 digits and two decimals, without commas or currency symbols.');
  const [whole,fraction='']=text.replace(/^-/,'').split('.');return (text.startsWith('-')?-1n:1n)*(BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0')));
}
export function moneyText(value){const sign=value<0n?'-':'';value=value<0n?-value:value;return sign+(value/100n).toString()+'.'+(value%100n).toString().padStart(2,'0');}
export function financialReport(input){
  const book=cleanWorkbook(input,{results:true}),m=book.mapping,sheet=book.sheets.find(s=>s.name===m.sheet),issues=[],rows=[],totals=Object.fromEntries(financeCategories.map(k=>[k,0n]));let debit=0n,credit=0n;const seen=new Set();
  const issue=(message,location='',severity='blocking')=>issues.push({message,location,severity});
  if(!m.organisation.trim())issue('Enter the organisation name.');if(!m.from||!m.to)issue('Enter the period start and end dates.');if(!m.confirmed)issue('Confirm the mapping and the trial-balance basis before exporting reports.');
  for(let row=m.startRow;row<=m.endRow;row++){
    const addresses=Object.fromEntries(['account','debit','credit','category'].map(key=>[key,columnName(m[key])+row]));
    if(Object.values(addresses).every(address=>!sheet.cells[address]?.input.trim()))continue;
    const location=sheet.name+'!'+addresses.account;let account,category,d,c;
    try{account=String(cellValue(sheet.cells[addresses.account])).trim();category=String(cellValue(sheet.cells[addresses.category])).trim().toLowerCase();d=money(cellValue(sheet.cells[addresses.debit]));c=money(cellValue(sheet.cells[addresses.credit]));}catch(error){issue(error.message,location);continue;}
    if(!account){issue('Account name is missing.',location);continue;}if(!financeCategories.includes(category)){issue('Choose asset, liability, equity, income or expense for '+account+'.',sheet.name+'!'+addresses.category);continue;}
    if(!sheet.cells[addresses.debit]?.input.trim()&&!sheet.cells[addresses.credit]?.input.trim()){issue('Enter a debit or credit amount for '+account+'; enter 0 for an explicit zero balance.',location);continue;}
    if(d<0n||c<0n){issue('Debit and credit amounts must be non-negative. Use the opposite column for a reverse balance.',location);continue;}
    if(d&&c)issue('Both debit and credit are populated; verify this closing balance.',location,'warning');
    if(seen.has(account.toLowerCase()))issue('Repeated account name: '+account+'. Verify that this is not a duplicate.',location,'warning');seen.add(account.toLowerCase());
    const balance=['asset','expense'].includes(category)?d-c:c-d;totals[category]+=balance;debit+=d;credit+=c;
    rows.push({account,category,debit:moneyText(d),credit:moneyText(c),balance:moneyText(balance),source:location,debitSource:sheet.name+'!'+addresses.debit,creditSource:sheet.name+'!'+addresses.credit});
  }
  if(!rows.length)issue('No usable trial-balance rows were found. Enter data or adjust the mapped row range.');
  const profit=totals.income-totals.expense,difference=totals.asset-totals.liability-totals.equity-profit;
  if(debit!==credit)issue('Trial balance does not balance. Debit minus credit: '+moneyText(debit-credit)+'.');
  if(difference!==0n)issue('Assets do not equal liabilities plus equity and current-period profit. Difference: '+moneyText(difference)+'.');
  const result={name:book.name,...m,rows,issues,valid:!issues.some(i=>i.severity==='blocking'),totals:Object.fromEntries([...Object.entries(totals),['profit',profit],['equityWithProfit',totals.equity+profit],['debit',debit],['credit',credit],['trialDifference',debit-credit],['balanceDifference',difference]].map(([key,value])=>[key,moneyText(value)])),basis:'Unclosed adjusted trial balance: balance-sheet accounts as at period end; income and expenses for the stated period. Current-period profit is added to equity once. Dates label the supplied balances; they do not filter transactions.'};
  result.reconciliation=reconciliation(rows,result.totals,{money,moneyText});return result;
}
