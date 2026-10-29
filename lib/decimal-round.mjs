// Excel ROUND uses decimal midpoint rounding away from zero. The upstream
// engine's Math.round(x * 10**n) loses decimal ties and rounds negatives wrong.
// Keep formula parsing/evaluation in xlsx-calc; adapt this one scalar operation.
export function decimalRound(value,places){
  if(arguments.length!==2||!Number.isFinite(Number(value))||!Number.isFinite(Number(places)))throw new Error('#VALUE!');
  const digits=Math.trunc(Number(places));if(Math.abs(digits)>15)throw new Error('ROUND supports -15 to 15 decimal places in this application.');
  const number=Number(value),[coefficient,exponent='0']=Math.abs(number).toString().toLowerCase().split('e'),[whole,fraction='']=coefficient.split('.');
  const integer=BigInt(whole+fraction),shift=Number(exponent)-fraction.length+digits;
  const rounded=shift>=0?integer*10n**BigInt(shift):(()=>{const divisor=10n**BigInt(-shift);return (integer+divisor/2n)/divisor;})();
  const result=Number((number<0?'-':'')+rounded.toString()+'e'+(-digits));if(!Number.isFinite(result))throw new Error('#NUM!');return Object.is(result,-0)?0:result;
}
