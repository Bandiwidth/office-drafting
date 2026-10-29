# Security and privacy

Office Drafting is intended for one user on one Windows laptop. Keep its HTTP listener on loopback. Do not expose it through a public reverse proxy, port forwarding or a shared network. Local session and origin checks do not turn it into a multi-user hosted service.

Uploaded documents are untrusted source material. The application validates supported formats and limits processing; the model is not authorised to execute commands, send messages, approve facts or change files. Model output still requires review.

For offline work, complete setup and download any local model first. Select AI off or an explicitly configured local provider. Choosing a cloud provider permits selected drafting material to leave the laptop and requires separate credentials and consent. There is no automatic remote fallback.

The default data directory is `data/`, or the path configured by `OFFICE_DATA_DIR`. It contains private records and should have appropriate Windows account permissions. API keys use Windows DPAPI for the current Windows user; this does not encrypt the entire document store. Backups and downloads are not encrypted. Protect the device and backup storage appropriately. Deleting a live record does not remove existing backup copies.

Do not put credentials, actual office documents, database files, exports, crash reports containing private text or backups in GitHub issues or commits. `.gitignore` is a convenience, not a guarantee against accidental publication; review every staged file.

Dependencies are pinned in `package-lock.json`. Install with `npm ci --ignore-scripts`; run the readiness check after installation. The advanced editor archive is separately pinned and SHA-256 verified. Keep Node, the browser and dependencies maintained. Windows security policy still applies; do not disable security controls to run this project.

## Dependency review notes

The current lockfile includes ExcelJS 4.4.0 and its transitive `uuid` 8.3.2 dependency. That UUID version is affected by [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq), a bounds-check issue in the v3/v5/v6 APIs when callers supply an output buffer. The reviewed ExcelJS source uses `v4()` without an output buffer; the application does not expose the affected UUID methods. This is a source-based reachability assessment, **not a patched dependency or a clean vulnerability scan**. A compatible dependency update still needs to be tested and pinned.

The app uses ExcelJS for bounded XLSX input/output, not its CSV export or filename-based image APIs. Its own period-comparison CSV exporter neutralises formula-like user text. Those restrictions matter when assessing upstream advisories; adding new library features requires a new review.

Run `npm audit` with registry access when evaluating a deployment and review current findings against the actual application paths. Deprecation messages during npm installation can come from transitive packages; they are not proof that every warning is exploitable or that warnings can be ignored. Do not use `npm audit fix --force` without reviewing compatibility and verifying the changed application. No claim of zero known dependency advisories is made for this release.

PdfCraft is alpha. The PDF tools do not certify secure redaction or preservation of digital signatures. Financial checks and language checks do not guarantee correct output. Inspect documents and independently verify sensitive calculations and removals.

If the repository enables GitHub private vulnerability reporting, use that for suspected security vulnerabilities. Otherwise avoid posting exploit details or private data publicly; contact the repository maintainer through a private channel they provide. This source release does not promise a response time or a security support period.
