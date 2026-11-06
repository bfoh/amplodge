<#
.SYNOPSIS
  Phase 1 probe for the Joney (proUSB) card encoder, through the vendor's proRFL.dll.

.DESCRIPTION
  Run on the reception PC that has the encoder, in 32-bit Windows PowerShell:

    C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -ExecutionPolicy Bypass -File .\Probe-Encoder.ps1 -DllDir "C:\path\to\folder\with\proRFL.dll"

  By default it only LOOKS. It never writes a card unless -IssueTest or -EraseTest
  is given, and then asks you to type YES first.
    1. Lists every function proRFL.dll exports (read from the file itself).
    2. Asks the DLL for its version.
    3. Opens the encoder over USB and beeps it.
    4. Reads the card lying on the encoder and decodes it (card type, lock
       number, end time), if those functions exist.

  Everything is written to a log next to this script. The log contains the
  hotel's card data: send it privately, never post it or commit it to git.

  proRFL.dll is not part of Joney's LQ015 install. It comes from Abacre's public
  prorfl.zip (see README.md), together with d12.dll and d12c.dll.
  The function signatures come from public sources, not from Joney's own
  documentation. Confirming them on the hotel's own cards is what this probe is for.
#>
param(
  [Parameter(Mandatory = $true)][string]$DllDir,
  [string]$DllName = 'proRFL.dll',
  # The USB type value passed as the first argument of every call. Public
  # examples use 1 for proUSB encoders.
  [byte]$UsbType = 1,
  # The hotel ID (dlsCoID): the "Hotel CoID" line of the LockNo_*.Txt file that
  # Joney's "Export LockNo" writes to the Desktop. The card decoders fail without it.
  [int]$HotelId = 0,
  [switch]$NoBeep,
  [switch]$NoRead,
  # Writing tests: use a spare card and ONE test door only.
  [switch]$IssueTest,
  [string]$LockNo,
  [string]$BeginTime,
  [string]$EndTime,
  [byte]$CardNo = 0,
  [switch]$EraseTest,
  [string]$LogFile
)

$ErrorActionPreference = 'Stop'
if (-not $LogFile) {
  $here = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
  $LogFile = Join-Path $here ('probe-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.log')
}
function Log([string]$msg) {
  $line = '[' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '] ' + $msg
  Write-Host $line
  Add-Content -Path $LogFile -Value $line
}

Log ('AMP Lodge encoder probe. Log: ' + $LogFile)
Log ('Windows: ' + [Environment]::OSVersion.VersionString + '; 64-bit OS: ' + [Environment]::Is64BitOperatingSystem)
Log ('PowerShell: ' + $PSVersionTable.PSVersion + '; process is ' + ([IntPtr]::Size * 8) + '-bit')
Log ('PC time: ' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '; time zone: ' + [TimeZoneInfo]::Local.Id + ' (UTC offset ' + [TimeZoneInfo]::Local.BaseUtcOffset + ')')
$tz = [TimeZoneInfo]::Local
if ($tz.BaseUtcOffset -ne [TimeSpan]::Zero -or $tz.SupportsDaylightSavingTime) {
  Log 'WARNING: this PC is not on Ghana time. Set Windows to "(UTC+00:00) Monrovia, Reykjavik"'
  Log '  (Greenwich Standard Time). The London zone moves an hour in summer and would shift card expiry.'
}

if ([IntPtr]::Size -ne 4) {
  Log 'STOP: this must run in 32-bit PowerShell, because proRFL.dll is a 32-bit DLL. Use:'
  Log '  C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -ExecutionPolicy Bypass -File .\Probe-Encoder.ps1 -DllDir "..."'
  exit 2
}

$dllPath = Join-Path $DllDir $DllName
if (-not (Test-Path $dllPath)) {
  Log ('STOP: ' + $dllPath + ' not found. DLL files in that folder:')
  Get-ChildItem -Path $DllDir -Filter *.dll -ErrorAction SilentlyContinue | ForEach-Object { Log ('  ' + $_.Name + '  ' + $_.Length + ' bytes') }
  exit 3
}
Get-ChildItem -Path $DllDir -Filter *.dll | ForEach-Object {
  $hash = (Get-FileHash -Algorithm SHA256 -Path $_.FullName).Hash.ToLower()
  Log ('DLL: ' + $_.Name + '  ' + $_.Length + ' bytes, modified ' + $_.LastWriteTime.ToString('yyyy-MM-dd') + ', sha256 ' + $hash)
}
if ($HotelId -eq 0) { Log 'No -HotelId given: the card decoders will fail. Take it from the "Hotel CoID" line of Joney''s Export LockNo file.' }

# The DLL (and anything it loads next to itself) is found through PATH and the current directory.
$env:PATH = $DllDir + ';' + $env:PATH
[Environment]::CurrentDirectory = $DllDir

$source = @"
using System;
using System.IO;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class PeExports {
  // Names exported by a 32-bit PE file, read from its export directory.
  public static List<string> Names(string path) {
    byte[] b = File.ReadAllBytes(path);
    int pe = BitConverter.ToInt32(b, 0x3C);
    int sections = BitConverter.ToUInt16(b, pe + 6);
    int optSize = BitConverter.ToUInt16(b, pe + 20);
    int opt = pe + 24;
    int magic = BitConverter.ToUInt16(b, opt);
    int dirs = opt + (magic == 0x20b ? 112 : 96);
    int exportRva = BitConverter.ToInt32(b, dirs);
    List<string> names = new List<string>();
    if (exportRva == 0) return names;
    int sectionTable = opt + optSize;
    int exp = RvaToOffset(b, sectionTable, sections, exportRva);
    int count = BitConverter.ToInt32(b, exp + 24);
    int namesTable = RvaToOffset(b, sectionTable, sections, BitConverter.ToInt32(b, exp + 32));
    for (int i = 0; i < count; i++) {
      int nameOffset = RvaToOffset(b, sectionTable, sections, BitConverter.ToInt32(b, namesTable + i * 4));
      int end = nameOffset;
      while (b[end] != 0) end++;
      names.Add(Encoding.ASCII.GetString(b, nameOffset, end - nameOffset));
    }
    return names;
  }
  static int RvaToOffset(byte[] b, int table, int count, int rva) {
    for (int i = 0; i < count; i++) {
      int s = table + i * 40;
      int va = BitConverter.ToInt32(b, s + 12);
      int size = Math.Max(BitConverter.ToInt32(b, s + 8), BitConverter.ToInt32(b, s + 16));
      if (rva >= va && rva < va + size) return rva - va + BitConverter.ToInt32(b, s + 20);
    }
    throw new Exception("RVA outside every section: " + rva);
  }
}

public static class ProRfl {
  const string D = @"$dllPath";
  [DllImport(D, CallingConvention = CallingConvention.StdCall, CharSet = CharSet.Ansi)]
  public static extern int GetDLLVersion(StringBuilder version);
  [DllImport(D, CallingConvention = CallingConvention.StdCall, CharSet = CharSet.Ansi)]
  public static extern int initializeUSB(byte fUSB);
  [DllImport(D, CallingConvention = CallingConvention.StdCall, CharSet = CharSet.Ansi)]
  public static extern int Buzzer(byte fUSB, int t);
  [DllImport(D, CallingConvention = CallingConvention.StdCall, CharSet = CharSet.Ansi)]
  public static extern int ReadCard(byte fUSB, StringBuilder buffer);
  [DllImport(D, CallingConvention = CallingConvention.StdCall, CharSet = CharSet.Ansi)]
  public static extern int GuestCard(byte fUSB, int dlsCoID, byte cardNo, byte dai, byte llock, byte pdoors,
    string bDate, string eDate, string lockNo, StringBuilder cardHexStr);
  [DllImport(D, CallingConvention = CallingConvention.StdCall, CharSet = CharSet.Ansi)]
  public static extern int CardErase(byte fUSB, int dlsCoID, StringBuilder cardHexStr);
  [DllImport(D, CallingConvention = CallingConvention.StdCall, CharSet = CharSet.Ansi)]
  public static extern int GetCardTypeByCardDataStr(string cardHexStr, StringBuilder cardType);
  [DllImport(D, CallingConvention = CallingConvention.StdCall, CharSet = CharSet.Ansi)]
  public static extern int GetGuestLockNoByCardDataStr(int dlsCoID, string cardHexStr, StringBuilder lockNo);
  [DllImport(D, CallingConvention = CallingConvention.StdCall, CharSet = CharSet.Ansi)]
  public static extern int GetGuestETimeByCardDataStr(int dlsCoID, string cardHexStr, StringBuilder eTime);
}
"@
Add-Type -TypeDefinition $source -Language CSharp

# 1. What the DLL exports.
try {
  $exports = [PeExports]::Names($dllPath)
  Log ('Exports (' + $exports.Count + '): ' + ($exports -join ', '))
} catch {
  Log ('Could not list exports: ' + $_.Exception.Message)
  $exports = @()
}

# Calls one DLL function, logging its return code, or why it could not be called.
function Invoke-Dll([string]$label, [scriptblock]$call) {
  try {
    $rc = & $call
    Log ($label + ' -> return code ' + $rc)
    return $rc
  } catch {
    $e = $_.Exception
    while ($e.InnerException) { $e = $e.InnerException }
    Log ($label + ' -> FAILED: ' + $e.GetType().Name + ': ' + $e.Message)
    return $null
  }
}

# 2. Version.
$ver = New-Object System.Text.StringBuilder 256
$null = Invoke-Dll 'GetDLLVersion' { [ProRfl]::GetDLLVersion($ver) }
Log ('  version text: "' + $ver.ToString() + '"')

# 3. Open the encoder, and beep.
$null = Invoke-Dll ('initializeUSB(' + $UsbType + ')') { [ProRfl]::initializeUSB($UsbType) }
if (-not $NoBeep) { $null = Invoke-Dll ('Buzzer(' + $UsbType + ', 50)') { [ProRfl]::Buzzer($UsbType, 50) } }

# 4. Read and decode the card on the encoder.
$cardHex = ''
if (-not $NoRead) {
  $null = Read-Host 'Lay a GUEST card made by the Joney software on the encoder, then press Enter'
  Log 'Reading the card on the encoder...'
  $buf = New-Object System.Text.StringBuilder 2048
  $null = Invoke-Dll ('ReadCard(' + $UsbType + ')') { [ProRfl]::ReadCard($UsbType, $buf) }
  $cardHex = $buf.ToString()
  Log ('  card data (' + $cardHex.Length + ' chars): ' + $cardHex)
  if ($cardHex.Length -gt 0) {
    $type = New-Object System.Text.StringBuilder 64
    $null = Invoke-Dll 'GetCardTypeByCardDataStr' { [ProRfl]::GetCardTypeByCardDataStr($cardHex, $type) }
    Log ('  card type: "' + $type.ToString() + '"')
    $lock = New-Object System.Text.StringBuilder 64
    $null = Invoke-Dll ('GetGuestLockNoByCardDataStr(hotel ' + $HotelId + ')') { [ProRfl]::GetGuestLockNoByCardDataStr($HotelId, $cardHex, $lock) }
    Log ('  lock number: "' + $lock.ToString() + '"')
    $etime = New-Object System.Text.StringBuilder 64
    $null = Invoke-Dll ('GetGuestETimeByCardDataStr(hotel ' + $HotelId + ')') { [ProRfl]::GetGuestETimeByCardDataStr($HotelId, $cardHex, $etime) }
    Log ('  end time: "' + $etime.ToString() + '"')
  }
}

function Confirm-Write([string]$what) {
  Log ('About to WRITE: ' + $what)
  Log 'The card lying on the encoder will be OVERWRITTEN. It must be a spare guest card,'
  Log 'never a system, authorization, master, floor, setup or backup card.'
  $answer = Read-Host 'Spare guest card on the encoder, test door only? Type YES to continue'
  if ($answer -ne 'YES') { Log 'Skipped (not confirmed).'; return $false }
  return $true
}

# 5. Optional: issue a short test guest card.
if ($IssueTest) {
  if ($HotelId -eq 0) { Log 'STOP: -IssueTest needs -HotelId (the "Hotel CoID" from Joney''s Export LockNo file).'; exit 4 }
  if ($LockNo -notmatch '^\d{8}$') { Log 'STOP: -LockNo must be the 8 digits the lock-number decoder printed for a Joney card of the test door.'; exit 4 }
  # Times are 10 decimal digits, yyMMddHHmm.
  if (-not $BeginTime) { $BeginTime = (Get-Date).AddMinutes(-10).ToString('yyMMddHHmm') }
  if (-not $EndTime) { $EndTime = (Get-Date).AddMinutes(10).ToString('yyMMddHHmm') }
  if ($BeginTime -notmatch '^\d{10}$' -or $EndTime -notmatch '^\d{10}$') { Log 'STOP: -BeginTime and -EndTime must be yyMMddHHmm (10 digits).'; exit 4 }
  $what = 'GuestCard hotel=' + $HotelId + ' cardNo=' + $CardNo + ' lock=' + $LockNo + ' from ' + $BeginTime + ' to ' + $EndTime + ' (dai=0, llock=0, pdoors=0)'
  if (Confirm-Write $what) {
    $out = New-Object System.Text.StringBuilder 2048
    $null = Invoke-Dll 'GuestCard' { [ProRfl]::GuestCard($UsbType, $HotelId, $CardNo, 0, 0, 0, $BeginTime, $EndTime, $LockNo, $out) }
    Log ('  card data written: ' + $out.ToString())
    Log 'Now try the test door: it should open until the end time, and not after.'
  }
}

# 6. Optional: erase the card on the encoder.
if ($EraseTest) {
  if ($HotelId -eq 0) { Log 'STOP: -EraseTest needs -HotelId.'; exit 4 }
  if (Confirm-Write ('CardErase hotel=' + $HotelId + ' (the card lying on the encoder)')) {
    $erase = New-Object System.Text.StringBuilder 2048
    $null = $erase.Append($cardHex)
    $null = Invoke-Dll 'CardErase' { [ProRfl]::CardErase($UsbType, $HotelId, $erase) }
    Log ('  after erase: ' + $erase.ToString())
    Log 'Now try the test door: the card should no longer open it.'
  }
}

Log 'Done. Send this log file privately to the developer.'
