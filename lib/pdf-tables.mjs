export function tableGrid(words,cuts){
 if(!Array.isArray(cuts)||cuts.length<3||cuts.length>21||cuts[0]!==0||cuts.at(-1)!==100||cuts.some((n,i)=>!Number.isFinite(n)||n<0||n>100||(i&&n<=cuts[i-1])))throw new Error('Enter 2–20 columns using increasing percentage boundaries starting at 0 and ending at 100.');
 if(!Array.isArray(words)||words.length>20000)throw new Error('Page contains too many fragments.');const lines=[];
 for(const word of words.filter(word=>typeof word.text==='string'&&word.text.trim()&&Array.isArray(word.bbox)&&word.bbox.length===4&&word.bbox.every(Number.isFinite)).sort((a,b)=>a.bbox[1]-b.bbox[1]||a.bbox[0]-b.bbox[0])){
  const [x,y,w,h]=word.bbox;if([x,y,w,h].some(n=>n<0||n>1))throw new Error('Invalid page coordinates.');let line=lines.find(line=>Math.abs(line.y-y)<=Math.max(.003,Math.min(line.h,h)*.6));if(!line){line={y,h,words:[]};lines.push(line);}line.words.push(word);
 }
 if(lines.length>500)throw new Error('Preview supports up to 500 rows per page. Crop or split the table.');
 return lines.sort((a,b)=>a.y-b.y).map(line=>{const row=Array.from({length:cuts.length-1},()=>({text:'',uncertain:false}));for(const word of line.words.sort((a,b)=>a.bbox[0]-b.bbox[0])){const x=word.bbox[0]*100,right=(word.bbox[0]+word.bbox[2])*100,index=Math.max(0,cuts.findIndex((cut,i)=>i<cuts.length-1&&x>=cut&&x<cuts[i+1])),cell=row[index];cell.text+=(cell.text?' ':'')+word.text;cell.uncertain||=word.uncertain===true||right>cuts[index+1]+.5;if(cell.text.length>2000)throw new Error('A cell exceeds 2,000 characters. Adjust the column boundaries.');}return row;});
}
