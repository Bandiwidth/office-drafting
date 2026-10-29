# Getting started

Follow the [README clone or ZIP instructions and first setup](../README.md#get-the-application) first. Run the commands from the folder containing `package.json`. Start the service with `npm start`, keep its terminal open and open the printed local address. The app's **Guide & FAQs** is the full task-by-task manual and remains available offline while the service is running. For AI assistance, start Ollama separately or explicitly configure a cloud provider; basic template drafting works with AI off.

## Create a letter

1. Choose **New document** and give the task a useful title.
2. Choose the document type, language and writing role. An employee representation is different from a letter issued by an authorised officer.
3. Upload a previous letter using the **reference** option if needed. A reference provides facts; it does not become an approved template.
4. Process supported references locally. Inspect the original and any highlighted uncertain OCR. Extracted values remain unconfirmed until you check them.
5. Open **Facts**. Enter the sender, recipient, calendar date, subject, requested action and any applicable earlier reference, amounts or attachments. Confirm each populated fact against its source. Resolve conflicting values.
6. Choose an approved DOCX template for final correspondence. Starter formats allow drafts only. Template upload and approval are separate from reference upload.
7. With AI off, use template-only drafting and edit the body yourself. For AI wording, configure a provider in Settings, send a focused request and review the proposal before accepting it.
8. Preserve `{{fact}}` markers in the body. To change a factual value, change its Fact field and confirm it again. AI cannot approve facts or invent supporting evidence.
9. Read **Review**, resolve blocking issues and inspect the preview. Verification notes stay outside the outgoing document.
10. Download Word. For PDF, allow the preview tab, wait for Ready and use Print / save PDF. Reopen the saved document and inspect names, amounts, formatting and page breaks before sending it yourself.

The app writes email wording but does not send email. A final issue requires an approved template and passing checks; an incomplete draft keeps placeholders. Save before leaving, and use History or undo for revisions. To begin a different task, use New document.

## Telugu review

Open **Office tools → English / Telugu**. Enter or select the English text, translate with your explicitly selected provider, and review the result beside the source. Translation requires a suitable model; changing a language selector does not itself translate existing text. Check protected names, identifiers, dates, amounts, meaning and terminology. Use the reviewed wording in the document only after checking it. A failed translation preserves the previous wording. An approved glossary helps consistency but does not guarantee fluent translation.

## Work with spreadsheets

Open **Spreadsheets & finance** and create a workbook or import XLSX. Check the import preview, sheet boundaries, formulas and calculation warnings. Unsupported Excel features may not survive import/export. Built-in examples are optional and are created only when you choose one.

For profit and loss or a balance sheet, use an appropriate unclosed adjusted trial balance, review account mappings and confirm the reporting settings. Resolve balance and formula issues before export. Review the financial output independently. For letter facts linked to cells, confirm the source value again when the workbook changes.

## Review PDFs

The basic PDF workspace supports notes, highlights, drawing, existing form fields and saved versions. Open a PDF, make changes, wait for Saved locally and download an edited copy. The original remains available. Password-protected files and unsaved PdfCraft work are outside basic recovery.

Choose **Open advanced editor** for PdfCraft. Open the file again there and use its own save controls. Existing-text editing depends on the PDF; scanned words are image content. A visible redaction mark alone does not prove removal. Reopen and independently verify sensitive content removal before sharing a file.

## Back up and close

Use **Jobs & backups** to create and verify a snapshot; keep a copy outside the app folder. Backups contain private records and are not encrypted. Keys are excluded. Save any separate PdfCraft changes through its own controls.

Wait for Saved locally, then press Ctrl+C in the terminal running `npm start`. Closing the browser alone leaves the service running. Later, run `npm start` from the same folder to reopen your records.

For updates, keep a verified backup and the old folder, stop the app and set up the new version separately. Restore compatible data explicitly. There is no automatic installer or release rollback in this source distribution.
