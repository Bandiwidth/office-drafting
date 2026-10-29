# Third-party components

The MIT licence at the repository root applies to original project code. It does not replace upstream licences or grant rights to third-party branding. The pinned npm dependency graph is recorded in `package-lock.json`; supplied upstream licence and notice texts are preserved in `third-party-licenses/`, with an inventory in its `manifest.json`.

| Component | Use | Upstream |
| --- | --- | --- |
| docxtemplater, PizZip | Approved DOCX rendering | https://github.com/open-xml-templating/docxtemplater ; https://github.com/open-xml-templating/pizzip |
| docx-preview, JSZip | Local document preview | https://github.com/VolodymyrBaydalka/docxjs ; https://github.com/Stuk/jszip |
| PDF.js | PDF extraction and review | https://github.com/mozilla/pdf.js |
| @napi-rs/canvas | Native local rendering | https://github.com/Brooooooklyn/canvas |
| Tesseract.js and English/Telugu data | Local OCR | https://github.com/naptha/tesseract.js ; https://github.com/naptha/tessdata |
| ExcelJS, xlsx-calc | XLSX processing and supported calculations | https://github.com/exceljs/exceljs ; https://github.com/fabiooshiro/xlsx-calc |
| PdfCraft 0.13.0 | Separately downloaded advanced PDF editor | https://github.com/storytold/pdfcraft |

PdfCraft is not vendored into this source repository. Setup downloads its unmodified pinned browser release and retains its MIT/Apache-2.0 licence texts, NOTICE and any supplied attribution files under the installed editor directory. Its own transitive components retain their supplied notices. The downloaded editor is excluded from Git.

The English/Telugu trained-data wrappers publish metadata declaring MIT but omit separate wrapper licence files. Their original metadata and supplied README are retained alongside the upstream trained-data Apache-2.0 licence and an explanatory notice. No missing wrapper copyright has been invented.

`npm run licenses` refreshes locally supplied npm licence texts from installed packages when dependencies are intentionally updated. Review the resulting changes and upstream requirements before redistribution. Node.js, Ollama, browsers and models are installed separately and retain their own licences; no executable or model weights are redistributed here.
