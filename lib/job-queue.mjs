// A small serial queue for scarce local services. Cancelled waiting jobs leave
// immediately; an active job owns its slot until it actually stops.
export function serialQueue(limit=4,message='Too many jobs are queued. Wait for the current work to finish.'){
  let active=false;const waiting=[];
  const pump=()=>{
    if(active||!waiting.length)return;
    const entry=waiting.shift();entry.signal?.removeEventListener('abort',entry.cancel);
    if(entry.signal?.aborted){entry.reject(new DOMException('Request cancelled.','AbortError'));pump();return;}
    active=true;
    Promise.resolve().then(entry.run).then(value=>{active=false;entry.resolve(value);pump();},error=>{active=false;entry.reject(error);pump();});
  };
  return {
    get size(){return Number(active)+waiting.length;},
    submit(run,signal){
      if(signal?.aborted)return Promise.reject(new DOMException('Request cancelled.','AbortError'));
      if(Number(active)+waiting.length>=limit)return Promise.reject(Object.assign(new Error(message),{status:429}));
      return new Promise((resolve,reject)=>{
        const entry={run,resolve,reject,signal,cancel:()=>{const index=waiting.indexOf(entry);if(index>=0){waiting.splice(index,1);reject(new DOMException('Request cancelled.','AbortError'));}}};
        signal?.addEventListener('abort',entry.cancel,{once:true});waiting.push(entry);pump();
      });
    }
  };
}
