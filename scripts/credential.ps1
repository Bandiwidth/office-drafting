param([ValidateSet('protect','unprotect')][string]$Operation)
$ErrorActionPreference = 'Stop'
$payload = [Console]::In.ReadToEnd()
if ($Operation -eq 'protect') {
  $secure = ConvertTo-SecureString -String $payload -AsPlainText -Force
  [Console]::Out.Write((ConvertFrom-SecureString -SecureString $secure))
} else {
  $secure = ConvertTo-SecureString -String $payload
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { [Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}
