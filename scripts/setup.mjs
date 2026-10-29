import {resolve} from 'node:path';
import {checkInstallation,printReadiness} from './check.mjs';
import {installPdfcraft} from './install-pdfcraft.mjs';

try{
  const args=process.argv.slice(2);
  if(args.length&&!(args.length===2&&args[0]==='--archive'&&args[1].trim()))throw new Error('Usage: npm run setup [-- --archive PATH_TO_OFFICIAL_ZIP]');
  const before=await checkInstallation({includePdfcraft:false});
  if(before.some(result=>!result.ready)){printReadiness(before);throw new Error('Install the required components with npm ci --ignore-scripts, then run npm run setup again.');}
  await installPdfcraft(args.length?resolve(args[1]):undefined);
  const after=await checkInstallation({syntax:true});printReadiness(after);
  if(after.some(result=>!result.ready))throw new Error('Setup is incomplete. Resolve the missing items above.');
  console.log('Setup complete. Run npm start and open its printed address. Keep that terminal open.');
  console.log('Local AI is optional: install/start Ollama and download a suitable model separately.');
}catch(error){console.error('Setup: '+error.message);process.exitCode=1;}
