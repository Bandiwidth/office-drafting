param([ValidateSet('pdf','extract')][string]$Operation, [string]$InputFile, [string]$OutputFile)
$ErrorActionPreference = 'Stop'
$word = $null
$document = $null
try {
  $word = New-Object -ComObject Word.Application
  $word.Visible = $false
  $word.DisplayAlerts = 0
  $word.AutomationSecurity = 3
  $word.Options.UpdateLinksAtOpen = $false
  $document = $word.Documents.Open($InputFile, $false, $true, $false, '', '', $false, '', '', 0, 0, $false, $false, 0, $true)
  if ($Operation -eq 'pdf') { $document.ExportAsFixedFormat($OutputFile, 17) }
  else { [System.IO.File]::WriteAllText($OutputFile, $document.Content.Text, [System.Text.Encoding]::UTF8) }
} finally {
  if ($null -ne $document) { try { $document.Close(0) } catch {} finally { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($document) } }
  if ($null -ne $word) { try { $word.Quit() } catch {} finally { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($word) } }
}
