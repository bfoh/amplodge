<#
Updates the AMP Lock Bridge on the reception PC.

Put the new AMPLockBridge.exe in the same folder as this script, then run PowerShell as
administrator in that folder:

  powershell.exe -ExecutionPolicy Bypass -File .\Update-Bridge.ps1 -Sha256 <the fingerprint the developer sent>

It checks the new exe's fingerprint and waits for any card being written. Then it stops the
bridge, keeps the old exe as AMPLockBridge.old.exe and copies the new one in. It checks the
copy and starts the bridge again as the signed-in user (not as administrator). Last, it shows
the version that answers. The pairing, the hotel ID, encoder.json and the log are in
C:\ProgramData\AMPLockBridge and are not touched.
#>
param(
  [Parameter(Mandatory = $true)][string]$Sha256,
  [string]$NewExe = '',
  [string]$InstallDir = ''
)
$ErrorActionPreference = 'Stop'
# Windows PowerShell 5.1 can leave $PSScriptRoot empty inside param(), so the defaults are worked out here.
if (-not $NewExe) {
  $here = if ($PSScriptRoot) { $PSScriptRoot } elseif ($MyInvocation.MyCommand.Path) { Split-Path -Parent $MyInvocation.MyCommand.Path } else { (Get-Location).Path }
  $NewExe = Join-Path $here 'AMPLockBridge.exe'
}
if (-not $InstallDir) {
  $programs = if (${env:ProgramFiles(x86)}) { ${env:ProgramFiles(x86)} } else { $env:ProgramFiles }
  $InstallDir = Join-Path $programs 'AMP Lock Bridge'
}
function Say([string]$m) { Write-Host $m }
function Fail([string]$m) { Write-Host "STOPPED: $m" -ForegroundColor Red; exit 1 }
function Fingerprint([string]$file) { (Get-FileHash -Algorithm SHA256 -LiteralPath $file).Hash.ToLowerInvariant() }
function Status { try { Invoke-RestMethod -Uri 'http://127.0.0.1:47123/status' -TimeoutSec 8 } catch { $null } }

$me = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $me.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Fail 'Run this as administrator: right-click Windows PowerShell, Run as administrator.'
}
if (-not (Test-Path -LiteralPath $NewExe)) { Fail "The new AMPLockBridge.exe is not at $NewExe." }
$want = $Sha256.Trim().ToLowerInvariant()
$got = Fingerprint $NewExe
if ($got -ne $want) { Fail "The new exe's fingerprint is $got, not the one given. Do not install it: copy it again." }
$target = Join-Path $InstallDir 'AMPLockBridge.exe'
$old = Join-Path $InstallDir 'AMPLockBridge.old.exe'
if (-not (Test-Path -LiteralPath $target)) { Fail "No bridge is installed at $target. For a first install, follow the README." }

# 1. Never in the middle of a card.
$s = Status
for ($i = 0; $s -and $s.busy -and $i -lt 30; $i++) { Say 'A card is being written: waiting...'; Start-Sleep -Seconds 2; $s = Status }
if ($s -and $s.busy) { Fail 'A card is still being written. Try again in a minute.' }
if ($s) { Say "Running now: lock bridge $($s.version)" } else { Say 'The bridge is not running now.' }

# 2. Stop it.
$running = @(Get-Process -Name AMPLockBridge -ErrorAction SilentlyContinue)
if ($running.Count -gt 0) {
  $running | Stop-Process -Force
  $running | Wait-Process -Timeout 15 -ErrorAction SilentlyContinue
}
if (Get-Process -Name AMPLockBridge -ErrorAction SilentlyContinue) { Fail 'The bridge did not stop. Restart the PC, then run this again.' }

# 3. Keep the old one, copy the new one in, check the copy.
Copy-Item -LiteralPath $target -Destination $old -Force
Copy-Item -LiteralPath $NewExe -Destination $target -Force
if ((Fingerprint $target) -ne $want) {
  Copy-Item -LiteralPath $old -Destination $target -Force
  Fail 'The copied file did not match, so the old version was put back. Start it from the Start menu.'
}

# 4. Start it as the signed-in user: through Explorer, so it does not run as administrator.
Start-Process -FilePath (Join-Path $env:WINDIR 'explorer.exe') -ArgumentList "`"$target`""
$s = $null
for ($i = 0; -not $s -and $i -lt 30; $i++) { Start-Sleep -Seconds 1; $s = Status }
if (-not $s) { Fail "The new bridge did not answer within 30 seconds. Start it from the Start menu. If it still does not start, copy $old over $target." }
Say "Done: lock bridge $($s.version) is running."
Say "Encoder: $($s.encoder.message)"
