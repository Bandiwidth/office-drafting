// Shared browser helper. Closing a page stops polling, not the saved local job.
window.officeJobs={
  async run(api,input,{signal,onProgress=()=>{},onCreated=()=>{}}={}){
    const created=await api('/jobs',{method:'POST',body:input});onCreated(created.id);let job=created;
    while(true){
      if(signal?.aborted)throw new DOMException('Stopped waiting for this job.','AbortError');
      onProgress(job);
      if(job.status==='completed')return job;
      if(['failed','cancelled','interrupted'].includes(job.status))throw new Error(job.error||job.message||'This job did not complete. Open Jobs & backups to retry.');
      await new Promise((resolve,reject)=>{const cancel=()=>{clearTimeout(timer);reject(new DOMException('Stopped waiting for this job.','AbortError'));},timer=setTimeout(()=>{signal?.removeEventListener('abort',cancel);resolve();},700);signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted){signal.removeEventListener('abort',cancel);cancel();}});
      job=await api('/jobs/'+created.id,{signal});
    }
  }
};
