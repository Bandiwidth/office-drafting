import {createRequire} from 'node:module';
import {unzip} from './zip.mjs';
import {cleanWorkbook,cellValue,financeLimits,addressParts,columnName,financialReport} from './finance-core.mjs';
import {decimalRound} from './decimal-round.mjs';
const require=createRequire(import.meta.url);
export const financePackages=['exceljs','xlsx-calc'];
export function financeStatus(){const packages=Object.fromEntries(financePackages.map(name=>{try{return [name,require(name+'/package.json').version];}catch{return [name,null];}}));return {excel:!!packages.exceljs,formulas:!!packages['xlsx-calc'],packages,limits:financeLimits};}
function engine(name){try{return require(name);}catch{throw new Error('A bundled spreadsheet component is missing. Stop the app, run npm ci --ignore-scripts and npm run setup in the project folder, then npm start.');}}
export function validateXlsx(bytes){
  if(!bytes?.length||bytes.length>12*1024*1024)throw new Error('Choose an XLSX file up to 12 MB.');
  let files;try{files=unzip(Buffer.from(bytes));}catch{throw new Error('Invalid, encrypted or oversized XLSX archive.');}
  if(!files.has('[Content_Types].xml')||!files.has('xl/workbook.xml'))throw new Error('Choose a valid .xlsx workbook.');
  for(const name of files.keys())if(/(?:vbaProject|activeX|embeddings|externalLinks|customXml)/i.test(name))throw new Error('Workbooks with macros, embedded objects or external data links are not supported. Save a plain XLSX copy first.');
  const types=files.get('[Content_Types].xml').toString();if(/macroEnabled|vbaProject/i.test(types))throw new Error('Macro-enabled workbooks are not supported.');
}
export async function importXlsx(bytes,name){
  validateXlsx(bytes);const ExcelJS=engine('exceljs'),workbook=new ExcelJS.Workbook();await workbook.xlsx.load(Buffer.from(bytes),{ignoreNodes:['drawing','picture','extLst']});
  if(workbook.worksheets.length>financeLimits.sheets)throw new Error('Import supports up to 10 worksheets.');
  const notices=['This editor imports cell data and formulas. Original formatting, charts, images, merged layouts, comments and validation rules are not carried into edited downloads. The original upload is kept separately.','Imported formula caches are discarded. Recalculate before using formula values.'],sheets=[];
  for(const source of workbook.worksheets){
    const cells={};source.eachRow({includeEmpty:false},row=>row.eachCell({includeEmpty:false},cell=>{
      if(cell.value===null||cell.value===undefined||cell.isMerged&&cell.master.address!==cell.address)return;addressParts(cell.address);const value=cell.value;let input;
      if(typeof value==='object'&&('formula'in value||'sharedFormula'in value)){input='='+cell.formula;if(!cell.formula)throw new Error('A shared or array formula could not be imported. Save a simpler XLSX copy.');}
      else if(value instanceof Date)input=value.toISOString().slice(0,10);
      else if(typeof value==='object'&&value.richText)input="'"+value.richText.map(v=>v.text).join('');
      else if(typeof value==='object'&&value.text!==undefined)input="'"+String(value.text);
      else if(typeof value==='object'&&value.error)throw new Error(source.name+'!'+cell.address+' contains an Excel error. Correct it before importing.');
      else if(typeof value==='object')throw new Error('Unsupported cell type at '+source.name+'!'+cell.address+'.');
      else input=(typeof value==='number'?'':"'")+String(value);
      cells[cell.address]={input};
    }));sheets.push({name:source.name,cells});
  }
  return cleanWorkbook({name:String(name||'Imported workbook').replace(/\.xlsx$/i,''),sheets,notices});
}
// Deliberately limited initial compatibility. No external functions, named
// ranges, structured references, full-column ranges or dynamic arrays.
const allowedFunctions=new Set(['SUM','AVERAGE','MIN','MAX','ABS','ROUND','IF','COUNTA','SUMPRODUCT']);
export function checkFormula(input){
  if(input.length>1024)throw new Error('Formula exceeds 1,024 characters.');
  const text=input.slice(1).replace(/"(?:[^"]|"")*"/g,'""').replace(/'(?:[^']|'')*'/g,"''");
  if(/[\[\]@|`\\;{}\x00-\x1f]/.test(text)||/\b(?:__proto__|constructor|prototype)\b/i.test(text))throw new Error('External, structured or executable formula content is not supported.');
  for(const match of text.matchAll(/([A-Za-z_][A-Za-z0-9_.]*)\s*\(/g))if(!allowedFunctions.has(match[1]))throw new Error('Unsupported function '+match[1]+'. Supported: '+[...allowedFunctions].join(', ')+'.');
  if(/(?:\$?[A-Z]+\s*:\s*\$?[A-Z]+|\b\d+\s*:\s*\d+\b)/.test(text))throw new Error('Use bounded cell ranges, such as A1:A100.');
  const contexts=[],aggregates=new Set(['SUM','AVERAGE','MIN','MAX','COUNTA','SUMPRODUCT']);
  for(const token of text.matchAll(/[A-Za-z_][A-Za-z0-9_.]*\s*\(|[():]/g)){
    if(token[0].endsWith('('))contexts.push(token[0].slice(0,-1).trim());
    else if(token[0]===')')contexts.pop();
    else if(token[0]===':'&&!contexts.some(name=>aggregates.has(name)))throw new Error('Array/spill formulas are not supported. Use ranges inside SUM, AVERAGE, MIN, MAX, COUNTA or SUMPRODUCT.');
  }
  const references=text.replace(/\b[A-Za-z_][A-Za-z0-9_.]*!/g,'!');
  for(const match of references.matchAll(/\$?([A-Z]{1,3})\$?([1-9]\d*)/g))addressParts(match[1]+match[2]);
}
export function calculateWorkbook(input){
  const book=cleanWorkbook(input),formulas=[];const Sheets=Object.create(null);
  for(const sheet of book.sheets){const cells=Sheets[sheet.name]=Object.create(null);let maxRow=1,maxColumn=1;
    for(const [address,cell]of Object.entries(sheet.cells)){
      const {row,column}=addressParts(address);maxRow=Math.max(maxRow,row);maxColumn=Math.max(maxColumn,column);
      if(cell.kind==='formula'){formulas.push({sheet:sheet.name,address,cell});cells[address]={f:cell.input.slice(1),t:'n'};}
      else{const value=cellValue(cell);if(cell.kind==='number'&&String(value).split(/[eE]/)[0].replace(/[-.]/g,'').replace(/^0+/,'').length>15)throw new Error(sheet.name+'!'+address+' exceeds Excel’s 15-digit numeric precision. Start it with an apostrophe to keep it as exact text.');cells[address]={v:cell.kind==='number'?Number(value):value,t:cell.kind==='number'?'n':'s'};}
    }cells['!ref']='A1:'+columnName(maxColumn)+maxRow;
  }
  if(formulas.length){
    let error;
    try{
      for(const {cell}of formulas)checkFormula(cell.input);
      const calc=engine('xlsx-calc');calc.set_fx('ROUND',decimalRound);calc({SheetNames:book.sheets.map(s=>s.name),Sheets});
      for(const sheet of book.sheets)for(const [address,result]of Object.entries(Sheets[sheet.name])){
        if(address.startsWith('!'))continue;const original=sheet.cells[address];
        if(!original||original.kind!=='formula'&&result.v!==(original.kind==='number'?Number(original.input):cellValue(original)))throw new Error('Array/spill output changed cells outside its formula. Use a scalar formula.');
      }
      for(const {sheet,address}of formulas){const result=Sheets[sheet][address];if(result.v===null&&result.t!=='e'){result.v=0;result.t='n';}if(result.t==='e'||!['number','string','boolean'].includes(typeof result.v)||(typeof result.v==='number'&&!Number.isFinite(result.v)))throw new Error('Invalid formula result at '+sheet+'!'+address+'.');}
    }catch(e){error=e?.message||(typeof e==='string'&&e.trim()?e:'The formula engine returned an invalid result. Check for division by zero or invalid cell references.');}
    for(const {sheet,address,cell}of formulas){if(error)cell.error='Calculation failed: '+error;else cell.result=Sheets[sheet][address].v;}
  }
  book.calculatedAt=new Date().toISOString();return book;
}
export async function exportXlsx(input,{report=false}={}){
  const ExcelJS=engine('exceljs'),book=calculateWorkbook(input),out=new ExcelJS.Workbook();out.creator='Office Drafting';out.calcProperties.fullCalcOnLoad=true;
  for(const sheet of book.sheets)for(const cell of Object.values(sheet.cells))if(cell.error)throw new Error(cell.error);
  const header=row=>{row.font={bold:true,color:{argb:'FFFFFFFF'}};row.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF236552'}};};
  if(report){
    const data=financialReport(book);if(!data.valid)throw new Error('Resolve report checks before export: '+data.issues.filter(i=>i.severity==='blocking').map(i=>i.message).join(' '));
    for(const amount of [...Object.values(data.totals),...data.rows.flatMap(r=>[r.balance,r.debit,r.credit])])if(amount.replace(/[-.]/g,'').replace(/^0+/,'').length>15||Number(amount).toFixed(2)!==amount)throw new Error('A report total exceeds safe Excel numeric precision. Split this report into smaller balances; the exact totals remain available in the application.');
    const metadata=sheet=>{sheet.addRow([data.organisation]);sheet.addRow(['Currency',data.currency]);sheet.addRow(['Period',data.from+' to '+data.to]);sheet.addRow([data.basis]);sheet.getRow(4).alignment={wrapText:true};sheet.getRow(4).height=60;sheet.columns=[{width:68},{width:24},{width:24},{width:34}];sheet.pageSetup={paperSize:9,orientation:'portrait',fitToPage:true,fitToWidth:1,fitToHeight:0};};
    const line=(sheet,name,amount)=>{const row=sheet.addRow([name,Number(amount)]);row.getCell(2).numFmt='#,##0.00;[Red](#,##0.00)';};
    const pl=out.addWorksheet('Profit and loss');metadata(pl);header(pl.addRow(['Account / total','Amount']));for(const category of ['income','expense']){for(const row of data.rows.filter(r=>r.category===category))line(pl,row.account,row.balance);line(pl,'Total '+category,data.totals[category]);}line(pl,'Net profit / (loss)',data.totals.profit);
    const bs=out.addWorksheet('Balance sheet');metadata(bs);bs.getCell('A3').value='As at '+data.to;header(bs.addRow(['Account / total','Amount']));for(const category of ['asset','liability','equity']){for(const row of data.rows.filter(r=>r.category===category))line(bs,row.account,row.balance);line(bs,'Total '+category,data.totals[category]);}line(bs,'Current-period profit / (loss)',data.totals.profit);line(bs,'Equity including current-period profit',data.totals.equityWithProfit);line(bs,'Balance difference (must be zero)',data.totals.balanceDifference);
    const tb=out.addWorksheet('Mapped trial balance');metadata(tb);header(tb.addRow(['Account','Debit','Credit','Category','Source account cell']));for(const row of data.rows){const r=tb.addRow([row.account,Number(row.debit),Number(row.credit),row.category,row.source]);r.getCell(2).numFmt=r.getCell(3).numFmt='#,##0.00';}tb.getColumn(5).width=42;tb.addRow(['Total',Number(data.totals.debit),Number(data.totals.credit)]);
    const checks=out.addWorksheet('Checks and basis');checks.columns=[{width:100},{width:48}];checks.addRow(['Internal financial report — reviewed source mapping required']);checks.addRow(['Trial balance difference',data.totals.trialDifference]);checks.addRow(['Balance sheet difference',data.totals.balanceDifference]);checks.addRow([data.basis]);for(const issue of data.issues)checks.addRow([issue.message,issue.location]);
  }else{
    for(const sheet of book.sheets){const ws=out.addWorksheet(sheet.name);ws.views=[{state:'frozen',ySplit:1}];for(const [address,cell]of Object.entries(sheet.cells)){ws.getCell(address).value=cell.kind==='formula'?{formula:cell.input.slice(1),result:cell.result}:cell.kind==='number'?Number(cell.input):cellValue(cell);}(ws.columns||[]).forEach(c=>c.width=22);}
  }
  return Buffer.from(await out.xlsx.writeBuffer());
}
