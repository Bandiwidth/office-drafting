# Office Drafting

A local Windows workspace for office correspondence, spreadsheets and PDF review. The application manages facts, approved DOCX templates, calculations and saved files. Optional AI helps with wording and translation; it cannot approve facts, issue correspondence, send email or execute commands.

English is the default. Telugu drafting and review are available, with translation quality dependent on the selected model and human review. Routine template drafting works with AI switched off.

## Requirements

- Windows 10/11 x64, with **Node.js 24 LTS** and npm. Get Node from [nodejs.org](https://nodejs.org/en/download).
- [Git for Windows](https://git-scm.com/install/windows) if you want to use `git clone`. Git is not needed for the ZIP download method.
- A current Chrome or Edge browser. No Python or Microsoft Word is needed for routine drafting and export.
- Internet for the initial dependency and PDF editor setup. After setup, local workflows can run offline.
- Optional local AI: [Ollama](https://ollama.com/) and a separately downloaded model that fits the laptop. Gemma and other installed Ollama models can be selected in Settings. There is no bundled model or guaranteed Telugu performance.
- Optional cloud AI: your own Gemini, OpenAI or compatible API credentials and explicit selection. API use requires internet and may incur provider charges. A ChatGPT subscription is separate from API access.

This release is **source only**. There is no Windows installer or bundled runtime. GitHub Pages cannot run this local backend. Windows security policies still apply to software installed on your machine.

## Get the application

Choose **one** method below. Use an ordinary writable folder, such as a folder under Documents, rather than Program Files. Do not put your actual documents or API keys into GitHub.

### Method A: clone with Git

1. Install Git for Windows and Node.js 24 LTS. Close and reopen your terminal after installing them.
2. On this repository's GitHub page, select the green **Code** button, select **HTTPS**, and copy the repository URL. Use this project's URL, not a dependency's URL. See [GitHub's cloning instructions](https://docs.github.com/en/repositories/creating-and-managing-repositories/cloning-a-repository).
3. Open **Command Prompt** in the parent folder where you want to keep the app. You can open that folder in File Explorer, type `cmd` in its address bar and press Enter.
4. Clone this repository and open its project folder:

   ```bat
   git clone https://github.com/Bandiwidth/office-drafting.git office-drafting
   cd office-drafting
   ```

5. Continue with First setup below. If you are reading a fork, use its HTTPS URL from the Code menu instead. If `office-drafting` already exists, choose a new empty destination name and use that name in the `cd` command. Do not overwrite or delete an existing folder containing work.

Public repositories can be cloned without a GitHub account. Private repositories require access and Git authentication. Git is only used to obtain the application source; the app runs locally.

### Method B: download a ZIP without Git

1. On this repository's GitHub page, select **Code → Download ZIP**.
2. Right-click the downloaded ZIP and select **Extract All**. Open the extracted project folder.
3. Find `package.json` alongside `server.mjs` and `README.md`. This is the folder you need; it may be inside another extracted folder.
4. Type `cmd` in that folder's File Explorer address bar and press Enter. Continue below. Do not try to start the app from inside the ZIP.

## First setup

In the project folder, verify your installed tools:

```bat
node --version
npm --version
```

Node should report **v24.x.x or newer**; Node.js 24 LTS is the documented baseline. If a command is not recognised, install Node.js and reopen the terminal before continuing. Then run each command **separately**, waiting for a successful result before the next:

```bat
npm ci --ignore-scripts
npm run setup
npm run check
npm start
```

Wait for each setup command to succeed. `npm ci` installs the required versions in the lockfile, including English/Telugu OCR data. `npm run setup` checks the components, downloads the pinned PdfCraft browser editor and verifies its SHA-256 before unpacking it. Dependency lifecycle scripts are disabled. Some platform-specific native binaries are optional transitive packages; the readiness check verifies the actual local engine and reports missing components instead of claiming setup succeeded.

First setup can take several minutes and downloads substantially more than the small source repository, including OCR data and native components. Keep internet available and leave the terminal open. Do not continue after a failed setup or a readiness result marked Missing. See [npm's description of the lockfile-based install](https://docs.npmjs.com/cli/v11/commands/npm-ci/).

If PowerShell rejects its `npm.ps1` wrapper, use Windows Command Prompt for the npm commands. Do not change Windows security policy to run the app.

Open the address printed by `npm start`, normally **http://127.0.0.1:4317**. Keep that terminal open. The source version does not open the browser automatically.

For later sessions, run only `npm start` from the same folder. Wait for **Saved locally** before stopping; press **Ctrl+C** in the terminal to stop the backend. Closing the browser does not stop it. To restart after an update, stop the old process, run `npm start` again, then refresh the browser.

To check installed components without creating documents:

```bat
npm run check
```

The check verifies installation readiness and source syntax; it does not certify document accuracy or model quality. Setup errors appear in the terminal. The advanced editor setup log is stored under `data/setup/` (or the configured data directory).

### Local archive setup

If the PdfCraft download is unavailable, obtain **pdfcraft-web-0.13.0.zip** from the [official v0.13.0 release](https://github.com/storytold/pdfcraft/releases/tag/v0.13.0). In Command Prompt, the following example assumes it is in your usual Downloads folder. Replace the quoted path with the actual file location if you saved it elsewhere:

```bat
npm run setup -- --archive "%USERPROFILE%\Downloads\pdfcraft-web-0.13.0.zip"
```

The same pinned checksum is enforced. Do not substitute another version. This option covers the editor archive; `npm ci` still needs the required npm packages, either online or in an already populated npm cache.

## What is included

| Workspace | Functions |
| --- | --- |
| Drafting | Letters, email wording, employee representations, replies, reminders, forwarding letters and internal notes; structured facts, source references, editing, history and DOCX export |
| Office tools | Bilingual review, wording blocks, presets, minutes, batch drafts, spreadsheet facts and searchable scans |
| Spreadsheets & finance | XLSX import/export, supported formulas, reconciliation, trial-balance mapping, profit and loss, balance sheet and review checks |
| PDFs | Local PDF.js review, annotations, existing forms and saved versions; separate PdfCraft advanced editing |
| Office centre | Approved terminology, correspondence register, template versions, issue locks, PDF tables and saved-work search |
| Jobs & backups | Bounded background processing, interrupted-job recovery, snapshots and explicit backup/restore |
| Guide | Detailed walkthroughs, searchable FAQs, troubleshooting and operation-specific limits |

No office-approved template is shipped. Starter formats are for drafts; upload and approve your own DOCX formats before final issue. Files uploaded as references provide background, not reusable layout. The app does not promise exact arbitrary PDF layout recreation.

The app starts with AI off and no saved documents or credentials. Built-in example workbooks are created only when you choose one; no example records are preloaded into a new installation.

## Connect AI

For local AI:

1. Install and open Ollama separately, following [Ollama's documentation](https://docs.ollama.com/quickstart). This source app does not start Ollama for you.
2. Download a **local** model using Ollama's controls. In a separate terminal, `ollama list` shows exact installed model names. Model downloads require internet and additional disk space; no model comes with this repository.
3. Keep Ollama running, start Office Drafting, and open the app's **Settings**.
4. Select **Ollama**, keep **Local-only mode** enabled, use the endpoint `http://127.0.0.1:11434`, and enter the exact installed model name including its tag.
5. Use **Save & test connection**, read the result, then send a short request. Review and accept the wording proposal before it replaces the saved draft.

Do not start a second `ollama serve` if the Ollama app is already serving on that port. A connection pass does not prove translation quality or that a large model will run quickly. Model selection and human review are especially important for Telugu.

Gemini, OpenAI and compatible APIs are optional. Select the provider, configure its model and credentials, and explicitly allow remote use. Keys are protected for the current Windows user through Windows DPAPI. There is no automatic cloud fallback. Do not enter API keys in documents or commit them to Git.

## Use the application

Start with [the short user guide](docs/USER_GUIDE.md), then open **Guide & FAQs** inside the app for detailed steps. A typical workflow is: new document → upload reference → review extracted facts → select a format → draft → edit → review → download.

For a first check without AI, choose **New document**, enter and confirm the relevant Facts, use template-only drafting, edit the body and download a **draft** Word document. The starter format cannot produce an approved final issue. To use a real office format, download the template starter from **Office templates**, adapt it in a DOCX editor, upload it as a template and record its actual approval. The [user guide](docs/USER_GUIDE.md) explains the full workflow.

PDF export opens a local document preview. Wait for **Ready**, choose **Print / save PDF**, select **Save as PDF**, use the template paper size and disable browser headers/footers. Review the saved file; browser layout can differ from Word, including header/footer spacing and pagination. Automatic overflow pages may not repeat running headers. Telugu may look correct while text selection/search differs.

## Data and backups

By default, the app stores records and settings in **`data/` under the project folder**. Diagnostics shows the actual path. To choose a separate writable folder before starting, use the command for your terminal. This setting applies to that terminal session; set it again in future sessions to use the same records.

**Command Prompt:**

```bat
set "OFFICE_DATA_DIR=%USERPROFILE%\OfficeDraftingData"
npm start
```

**PowerShell:**

```powershell
$env:OFFICE_DATA_DIR = "$env:USERPROFILE\OfficeDraftingData"
npm start
```

Use **Jobs & backups** to create and verify backups. Keep copies outside the project folder. Backups contain sensitive documents and are not encrypted; API keys are excluded and must be configured separately. Do not commit data, uploads, exports or backups. Deleting a live item does not erase copies in earlier backups.

Before updating, back up, stop the service and keep the previous folder. Set up the new source in a separate folder and restore a compatible backup explicitly. There is no managed installer rollback. Do not open a migrated database in an older version.

## Troubleshooting and limits

- **Site cannot be reached:** run `npm start`, read its terminal errors and use its printed address. Refresh cannot start a stopped backend. Only one process can own the same data folder.
- **Port already occupied:** stop the known old service, or choose another port before starting. In Command Prompt run `set "OFFICE_PORT=4318"`; in PowerShell run `$env:OFFICE_PORT = "4318"`. Then run `npm start` and open the new printed address. The setting lasts for that terminal session.
- **Missing components:** stop the app, run `npm run check`, then `npm ci --ignore-scripts` and `npm run setup` as needed. Retain the data folder.
- **AI timeout / no Telugu:** keep the existing draft; test a short passage with a model suitable for the laptop. Fluent human review is required. Small local models can produce poor Telugu even when structural checks pass.
- **Financial results:** only a bounded formula subset and reviewed trial-balance workflow are supported. Imported workbooks may contain unsupported formulas. This is not full Excel compatibility or an accounting certification; independently review the output.
- **PDF editing:** PdfCraft 0.13.0 is alpha, with its own save controls. It is not Adobe parity or certified secure redaction. Verify any purported content removal, especially scanned PDFs.

The service binds to the laptop's loopback address. It is designed for one user on one Windows machine, not public hosting or a shared server. See [security guidance](SECURITY.md) before using sensitive documents. Automated checks help with dates, references and protected facts; they cannot guarantee factual or linguistic perfection.

The security guidance includes a known transitive dependency advisory and the reviewed application paths. Installation readiness is not a clean security audit. Upstream deprecation warnings may appear during setup; review those notes before deployment.

## Licence

Original project code is available under the [MIT licence](LICENSE). Dependencies retain their own licences: see [third-party notices](THIRD_PARTY_NOTICES.md) and `third-party-licenses/`. PdfCraft is downloaded separately with its upstream notices preserved.
