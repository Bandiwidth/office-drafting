import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export function codeFingerprint(){
  const hash=createHash('sha256');
  for(const name of ['public/document-print.html','public/document-print.js','public/document-print.css'])hash.update(name).update(readFileSync(resolve(root,name)));
  for(const name of ['public/guide.html','public/guide.js','public/guide.css'])hash.update(name).update(readFileSync(resolve(root,name)));
  for(const name of ['lib/office-records.mjs','lib/office-backup.mjs','lib/office-routes.mjs','lib/pdf-tables.mjs','public/office.html','public/office.js','public/office.css'])hash.update(name).update(readFileSync(resolve(root,name)));
  for(const name of ['lib/body-format.mjs','lib/writing-core.mjs','lib/writing-routes.mjs','public/writing-tools.js','public/writing-tools.html','public/writing-tools.css'])hash.update(name).update(readFileSync(resolve(root,name)));
  for(const name of ['lib/diagnostics.mjs','lib/import-guide.mjs','lib/finance-samples.mjs','lib/revision-diff.mjs','lib/formula-audit.mjs','lib/period-comparison.mjs','public/diagnostics.html','public/diagnostics.js'])hash.update(name).update(readFileSync(resolve(root,name)));
  for(const name of ['lib/runtime-lock.mjs','lib/restore-records.mjs','lib/local-backups.mjs','lib/snapshot-worker.mjs','lib/durable-jobs.mjs','lib/background-handlers.mjs','lib/maintenance.mjs','public/jobs-client.js','public/activity.html','public/activity.js','public/activity.css'])hash.update(name).update(readFileSync(resolve(root,name)));
  for(const name of ['lib/pdf-workspace.mjs','scripts/install-pdfcraft.mjs','public/pdf.html','public/pdf.js','public/pdf.css'])hash.update(name).update(readFileSync(resolve(root,name)));
  for(const name of ['lib/decimal-round.mjs','lib/pdf-sessions.mjs','public/pdf-recovery.js','lib/finance-reconcile.mjs'])hash.update(name).update(readFileSync(resolve(root,name)));
  for(const name of ['package.json','lib/finance.mjs','lib/finance-core.mjs','lib/finance-files.mjs','lib/finance-worker.mjs','lib/finance-store.mjs','lib/finance-routes.mjs','public/finance.html','public/finance.js','public/finance.css'])hash.update(name).update(readFileSync(resolve(root,name)));
  for(const name of ['server.mjs','lib/build.mjs','lib/core.mjs','lib/providers.mjs','lib/translation.mjs','lib/telugu-quality.mjs','lib/job-queue.mjs','public/app.js','public/index.html','public/style.css','public/updates.css','public/docx-frame.js','public/docx-frame.html','scripts/word.ps1','scripts/credential.ps1','lib/store.mjs','lib/documents.mjs','lib/zip.mjs','lib/open-source.mjs','lib/worker.mjs','lib/references.mjs','lib/reference-core.mjs','lib/reference-worker.mjs'])hash.update(name).update(readFileSync(resolve(root,name)));
  return hash.digest('hex');
}
