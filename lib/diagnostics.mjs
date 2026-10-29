import {statfsSync} from 'node:fs';
import {financeStatus} from './finance.mjs';
import {openSourceStatus} from './open-source.mjs';
export function diagnostics(store,dataDir,fingerprint){
  const disk=statfsSync(dataDir);store.db.prepare('SELECT 1').get();
  return {service:'Office Drafting',reachable:true,buildFingerprint:fingerprint,node:process.versions.node,platform:process.platform,database:'available',dataDir,freeMB:Math.floor(Number(disk.bavail)*Number(disk.bsize)/1048576),components:openSourceStatus(),finance:financeStatus(),provider:{provider:store.settings().provider,localOnly:store.settings().localOnly},note:'This checks this service and installed components. It does not certify model quality or Word/PDF layout.'};
}
