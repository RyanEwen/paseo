param([Parameter(Mandatory=$true)][ValidateSet('x64', 'arm64')][string]$Architecture)
$ErrorActionPreference = 'Stop'

# Inspect the PE produced by packaging, including builds requested with --arm64.
$unpacked = @(Get-ChildItem 'packages/desktop/release' -Directory | Where-Object { $_.Name -match '^win.*unpacked$' })
if ($unpacked.Count -ne 1) { throw 'Expected exactly one unpacked Windows preview' }
$executable = Join-Path $unpacked[0].FullName 'Paseo++.exe'
$bytes = [System.IO.File]::ReadAllBytes($executable)
$peOffset = [BitConverter]::ToInt32($bytes, 0x3c)
$machine = [BitConverter]::ToUInt16($bytes, $peOffset + 4)
$expectedMachine = if ($Architecture -eq 'arm64') { 0xAA64 } else { 0x8664 }
if ($machine -ne $expectedMachine) { throw "Wrong PE architecture: $machine, expected $expectedMachine" }

# Azure signing must cover both the installed application and the downloadable installer.
$installers = @(Get-ChildItem 'packages/desktop/release' -Filter '*.exe' -File)
if ($installers.Count -ne 1) { throw 'Expected exactly one signed Windows installer' }
foreach ($file in @($executable, $installers[0].FullName)) {
  $signature = Get-AuthenticodeSignature $file
  if ($signature.Status -ne 'Valid') { throw "Invalid Authenticode signature: $file ($($signature.Status))" }
  $publisher = $signature.SignerCertificate.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false)
  if ($publisher -ne $env:PASEO_AZURE_PUBLISHER_NAME) { throw "Unexpected signing publisher: $publisher" }
}
Write-Output "Verified $Architecture PE and Azure signatures"
