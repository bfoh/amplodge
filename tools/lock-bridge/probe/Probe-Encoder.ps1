<#
.SYNOPSIS
  On-site probe for the Joney card encoder, through proRFL.dll from Joney's
  "New Lock System SDK [V0925]".

.DESCRIPTION
  Run on the reception PC that has the encoder, with Joney's Lock Management
  System OPEN and logged in, in 32-bit Windows PowerShell:

    C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -STA -ExecutionPolicy Bypass -File .\Probe-Encoder.ps1 -DllDir C:\AMPLock\sdk

  The 2021 proRFL.dll does not drive the encoder itself. It sends each command
  to the Lock Management System on 127.0.0.1:10086, and that program does the
  card work. So the program must be running, and every call can take up to
  about 3 seconds.

  By default the probe only LOOKS. It never writes a card unless -IssueTest,
  -EraseTest or -DoorTest is given, and then asks you to type YES first.
    1. Checks the PC: 32-bit PowerShell, time zone, and that the lock program
       is listening on port 10086 (and whether other computers can reach it).
    2. Checks proRFL.dll: its fingerprint, version and exported functions.
    3. Connects to the lock program and beeps the encoder.
    4. Reads cards one at a time: none, then a guest card made by the lock
       program, then a blank card (or any you like), and decodes each.
    5. Prints the calibration the lock bridge needs, from what it saw.

  Everything is written to a log next to this script. The log holds the
  hotel's ID and guest-card data: send it privately, never post it or commit
  it to git. The data of a card that is not a guest or blank card (master,
  floor, setup...) is never logged.
#>
param(
  [Parameter(Mandatory = $true)][string]$DllDir,
  [string]$DllName = 'proRFL.dll',
  # fUSB, the first argument of the encoder calls. Joney's 2021 DLL ignores it; 1 = proUSB.
  [byte]$UsbType = 1,
  # The hotel ID (dlsCoID). Read from a guest card if not given. The card decoders need it.
  [int]$HotelId = 0,
  [switch]$NoBeep,
  [switch]$NoRead,
  # Writing tests: use a spare card and ONE empty test room only.
  [switch]$IssueTest,
  # The test door's lock code: 6 characters, 0-9 and A-F, as the Lock Management System shows it.
  [string]$LockNo,
  # The test card's DAI, 1..255. See README: a new DAI locks out the room's older cards once used.
  [int]$Dai = 0,
  [string]$EndTime,
  [byte]$CardNo = 0,
  [switch]$EraseTest,
  # The guided door test (writes 3 test cards and erases 1): needs -HotelId and -LockNo, and someone at the door.
  [switch]$DoorTest,
  [string]$LogFile
)

$ErrorActionPreference = 'Stop'
$JoneyV0925Sha256 = '4a86c167956aaf025a033362a84164be944c2c16a8615489ad4243215af08e1d'
$LockPort = 10086

if (-not $LogFile) {
  $here = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
  $LogFile = Join-Path $here ('probe-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.log')
}
function Log([string]$msg) {
  $line = '[' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '] ' + $msg
  Write-Host $line
  Add-Content -Path $LogFile -Value $line
}

# ---- 1. The PC ---------------------------------------------------------------
Log ('AMP Lodge encoder probe (Joney SDK V0925). Log: ' + $LogFile)
Log ('Windows: ' + [Environment]::OSVersion.VersionString + '; 64-bit OS: ' + [Environment]::Is64BitOperatingSystem)
Log ('PowerShell: ' + $PSVersionTable.PSVersion + '; process is ' + ([IntPtr]::Size * 8) + '-bit; thread ' + [System.Threading.Thread]::CurrentThread.GetApartmentState())
Log ('PC time: ' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '; time zone: ' + [TimeZoneInfo]::Local.Id + ' (UTC offset ' + [TimeZoneInfo]::Local.BaseUtcOffset + ')')
$tz = [TimeZoneInfo]::Local
if ($tz.BaseUtcOffset -ne [TimeSpan]::Zero -or $tz.SupportsDaylightSavingTime) {
  Log 'WARNING: this PC is not on Ghana time. Set Windows to "(UTC+00:00) Monrovia, Reykjavik"'
  Log '  (Greenwich Standard Time). The London zone moves an hour in summer and would shift card expiry.'
}
if ([IntPtr]::Size -ne 4) {
  Log 'STOP: this must run in 32-bit PowerShell, because proRFL.dll is a 32-bit DLL. Use:'
  Log '  C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -STA -ExecutionPolicy Bypass -File .\Probe-Encoder.ps1 -DllDir "..."'
  exit 2
}
if ([System.Threading.Thread]::CurrentThread.GetApartmentState() -ne 'STA') {
  Log 'STOP: run PowerShell with -STA (the DLL waits for the lock program by pumping window messages).'
  exit 2
}

# Is the Lock Management System listening where the DLL connects (127.0.0.1:10086)?
$listeners = @([System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners() | Where-Object { $_.Port -eq $LockPort })
if ($listeners.Count -eq 0) {
  Log ('STOP: nothing is listening on port ' + $LockPort + '. Open Joney''s Lock Management System, log in, and run this again.')
  Log '  (If it is open: its SDK/interface option may be off, or this version may not have it. Ask Joney.)'
  exit 3
}
Log ('Port ' + $LockPort + ' is listening on: ' + (($listeners | ForEach-Object { $_.ToString() }) -join ', '))
try {
  Get-NetTCPConnection -State Listen -LocalPort $LockPort -ErrorAction Stop | ForEach-Object {
    $p = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue
    Log ('  owned by process ' + $_.OwningProcess + ' ' + $(if ($p) { $p.ProcessName + ' (' + $p.Path + ')' } else { '?' }))
  }
} catch { Log ('  (could not name the program: ' + $_.Exception.Message + ')') }
$reachable = $listeners | Where-Object { $_.Address.ToString() -eq '127.0.0.1' -or $_.Address.ToString() -eq '0.0.0.0' }
if (-not $reachable) { Log 'STOP: the program does not listen on 127.0.0.1, which is where the DLL connects. Ask Joney.'; exit 3 }
$exposed = $listeners | Where-Object { -not [System.Net.IPAddress]::IsLoopback($_.Address) }
# The program still listens on every address after a firewall rule, so ask the firewall too: an
# enabled inbound Block rule for TCP 10086, and the firewall on for each network this PC is on.
$firewalled = $false
if ($exposed) {
  try {
    $rules = @(Get-NetFirewallRule -PolicyStore ActiveStore -Direction Inbound -Action Block -Enabled True -ErrorAction Stop | Where-Object {
      $pf = $_ | Get-NetFirewallPortFilter
      (@($pf.Protocol) -contains 'TCP') -and (@($pf.LocalPort) -contains ('' + $LockPort))
    })
    $nets = @(Get-NetConnectionProfile -ErrorAction Stop | ForEach-Object { $(if (('' + $_.NetworkCategory) -eq 'DomainAuthenticated') { 'Domain' } else { '' + $_.NetworkCategory }) } | Select-Object -Unique)
    $on = @{}
    Get-NetFirewallProfile -PolicyStore ActiveStore -ErrorAction Stop | ForEach-Object { $on['' + $_.Name] = (('' + $_.Enabled) -eq 'True') }
    foreach ($r in $rules) {
      $ra = @(($r | Get-NetFirewallAddressFilter).RemoteAddress) -join ','
      Log ('  firewall rule "' + $r.DisplayName + '": blocks inbound TCP ' + $LockPort + ' from ' + $ra + ', profiles ' + $r.Profile)
    }
    foreach ($n in $nets) { Log ('  this PC is on a ' + $n + ' network; firewall for it: ' + $(if ($on[$n]) { 'ON' } else { 'OFF' })) }
    $coversAll = $rules.Count -gt 0 -and $nets.Count -gt 0
    foreach ($n in $nets) {
      if (-not $on[$n]) { $coversAll = $false }
      if (-not ($rules | Where-Object { ('' + $_.Profile) -eq 'Any' -or ('' + $_.Profile) -match $n })) { $coversAll = $false }
    }
    $firewalled = $coversAll
  } catch { Log ('  (could not read the Windows Firewall settings: ' + $_.Exception.Message + ')') }
}
if ($exposed -and $firewalled) {
  Log 'OK: the lock program listens on every address, but Windows Firewall blocks port 10086 from other computers.'
  $ips = @()
  try { $ips = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | ForEach-Object { $_.IPAddress }) } catch { }
  foreach ($ip in $ips) { Log ('  To prove it, on ANOTHER computer on the hotel network run: Test-NetConnection ' + $ip + ' -Port ' + $LockPort + '   (TcpTestSucceeded must be False)') }
}
if ($exposed -and -not $firewalled) {
  Log 'WARNING: the lock program accepts connections from the NETWORK on port 10086, so another computer'
  Log '  on the hotel network could ask it for guest cards. Block it in Windows Firewall (as Administrator):'
  Log ('  New-NetFirewallRule -DisplayName "Joney lock program: this PC only" -Direction Inbound -Protocol TCP -LocalPort ' + $LockPort + ' -RemoteAddress 0.0.0.0-126.255.255.255,128.0.0.0-255.255.255.255 -Action Block')
  Log '  The rule leaves 127.x alone, so the DLL on this PC still connects. Run this probe again after: the beep must still work.'
}

# ---- 2. The DLL ----------------------------------------------------------------
$dllPath = Join-Path $DllDir $DllName
if (-not (Test-Path $dllPath)) {
  Log ('STOP: ' + $dllPath + ' not found. DLL files in that folder:')
  Get-ChildItem -Path $DllDir -Filter *.dll -ErrorAction SilentlyContinue | ForEach-Object { Log ('  ' + $_.Name + '  ' + $_.Length + ' bytes') }
  exit 3
}
$hash = (Get-FileHash -Algorithm SHA256 -Path $dllPath).Hash.ToLower()
Log ('DLL: ' + $dllPath + ', ' + (Get-Item $dllPath).Length + ' bytes, sha256 ' + $hash)
if ($hash -ne $JoneyV0925Sha256) {
  Log 'WARNING: this is not the proRFL.dll from Joney''s SDK V0925 (the older -5555 and -ComputerName'
  Log '  builds, or the 2009 Abacre one, work differently). The lock bridge refuses it unless its'
  Log '  fingerprint is put in encoder.json. Carry on only to log what it does.'
}

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

// The calls in Joney's Explanation.doc (stdcall, ANSI). No master, floor or system card calls.
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

try {
  $exports = [PeExports]::Names($dllPath)
  Log ('Exports (' + $exports.Count + '): ' + ($exports -join ', '))
} catch { Log ('Could not list exports: ' + $_.Exception.Message) }

# Calls one DLL function, logging its return code and how long it took, or why it could not be called.
function Invoke-Dll([string]$label, [scriptblock]$call) {
  $watch = [System.Diagnostics.Stopwatch]::StartNew()
  try {
    $rc = & $call
    Log ($label + ' -> return code ' + $rc + ' (' + $watch.ElapsedMilliseconds + ' ms)')
    return $rc
  } catch {
    $e = $_.Exception
    while ($e.InnerException) { $e = $e.InnerException }
    Log ($label + ' -> FAILED: ' + $e.GetType().Name + ': ' + $e.Message)
    return $null
  }
}

$ver = New-Object System.Text.StringBuilder 256
$null = Invoke-Dll 'GetDLLVersion' { [ProRfl]::GetDLLVersion($ver) }
Log ('  version text: "' + $ver.ToString() + '"   (Joney V0925: "ProUsb-20211115")')

# ---- 3. Connect to the lock program, and beep ---------------------------------
# initializeUSB connects to 127.0.0.1:10086. It returns 0 even when that fails, so the beep is the real test.
$initRc = Invoke-Dll ('initializeUSB(' + $UsbType + ')') { [ProRfl]::initializeUSB($UsbType) }
if (-not $NoBeep) {
  $null = Invoke-Dll ('Buzzer(' + $UsbType + ', 50)') { [ProRfl]::Buzzer($UsbType, 50) }
  $beeped = Read-Host 'Did the ENCODER beep just now? Type y or n'
  Log ('  encoder beeped: ' + $beeped)
  if ($beeped -ne 'y') { Log '  -> the DLL is not getting through to the lock program and encoder. Is the program logged in? Is the encoder plugged in and working in the program?' }
}

# ---- 4. Read cards ------------------------------------------------------------
# What the card's data says, the way Joney's demo reads it (characters counted from 1):
#   5-6 "01" = a card is present; 25-32 = the card's serial, whose first character is its type:
#   6 guest, F blank (FFFFFFFF when new, e.g. FF2A6C1E once the lock program has erased it).
function Get-Layout([string]$hex) {
  if ($hex.Length -lt 32 -or $hex.Substring(4, 2) -ne '01') { return 'none' }
  $type = $hex.Substring(24, 1).ToUpper()
  if ($type -eq 'F') { return 'blank' }
  if ($type -eq '6') { return 'guest' }
  return 'other'
}
# Hotel ID as Joney's demo takes it from a working card: hex(11-14) mod 16384 + hex(9-10) * 65536.
function Get-HotelIdFromCard([string]$hex) {
  return ([Convert]::ToInt32($hex.Substring(10, 4), 16) % 16384) + [Convert]::ToInt32($hex.Substring(8, 2), 16) * 65536
}
$TypeNames = @{ '0' = 'reset'; '1' = 'record'; '2' = 'lock-no setting'; '3' = 'clock setting'; '4' = 'lost'; '5' = 'group setting'; '6' = 'GUEST'; '7' = 'terminate'; '8' = 'group'; '9' = 'unknown'; 'A' = 'emergency'; 'B' = 'MASTER'; 'C' = 'building'; 'D' = 'floor'; 'E' = 'unknown'; 'F' = 'BLANK' }

$seen = @{ readOk = @(); noCard = @(); blankType = @(); guestType = @() }
function Read-OneCard([string]$what) {
  Log ('--- ' + $what)
  $buf = New-Object System.Text.StringBuilder 4096
  $rc = Invoke-Dll ('ReadCard(' + $UsbType + ')') { [ProRfl]::ReadCard($UsbType, $buf) }
  $hex = $buf.ToString().Trim()
  $layout = Get-Layout $hex
  Log ('  ' + $hex.Length + ' characters, header "' + $(if ($hex.Length -ge 6) { $hex.Substring(0, 6) } else { $hex }) + '", card data says: ' + $layout)
  if ($layout -eq 'none') { $script:seen.noCard += $rc; return $null }
  $script:seen.readOk += $rc
  $type = New-Object System.Text.StringBuilder 64
  $null = Invoke-Dll 'GetCardTypeByCardDataStr' { [ProRfl]::GetCardTypeByCardDataStr($hex, $type) }
  $t = $type.ToString()
  $code = if ($t.Length -gt 0) { $t.Substring(0, 1).ToUpper() } else { '' }
  Log ('  card type: "' + $t + '" = ' + $(if ($TypeNames.ContainsKey($code)) { $TypeNames[$code] } else { '?' }))
  if ($layout -eq 'other' -and $code -eq 'F') {
    # The lock program says blank, but the serial isn't FFFFFFFF (an erased card?). The first 32
    # characters (header, hotel, lock, serial) show the developer why; the rest is only described.
    $rest = $hex.Substring(32)
    $shape = if ($rest -match '^F*$') { 'all F' } elseif ($rest -match '^[0F]*$') { 'only 0 and F' } else { 'mixed' }
    Log '  The lock program calls this card BLANK, but its serial (characters 25-32) is not FFFFFFFF.'
    Log ('  first 32 characters: ' + $hex.Substring(0, 32) + '   the other ' + $rest.Length + ': ' + $shape)
    return $null
  }
  if ($layout -eq 'other') {
    Log '  This is not a guest or blank card (master, floor, setup...?). Its data is NOT logged. Put it away safely.'
    return $null
  }
  if ($layout -eq 'blank') { $script:seen.blankType += $code }
  if ($layout -eq 'guest') { $script:seen.guestType += $code }
  Log ('  card data: ' + $hex)
  if ($layout -eq 'guest') {
    $fromCard = Get-HotelIdFromCard $hex
    Log ('  hotel ID from this card: ' + $fromCard)
    if ($script:HotelId -eq 0) { $script:HotelId = $fromCard; Log '  (using it for the decoders)' }
    elseif ($script:HotelId -ne $fromCard) { Log ('  WARNING: -HotelId is ' + $script:HotelId + ' but this card says ' + $fromCard) }
    $lock = New-Object System.Text.StringBuilder 64
    $null = Invoke-Dll ('GetGuestLockNoByCardDataStr(hotel ' + $script:HotelId + ')') { [ProRfl]::GetGuestLockNoByCardDataStr($script:HotelId, $hex, $lock) }
    # The card holds the code in characters 21-22, 19-20, 17-18 (building, floor, room). The DLL's
    # decoder drops the top bit of each byte, so a building above 127 shows wrong there (A5 -> 25).
    $onCard = ($hex.Substring(20, 2) + $hex.Substring(18, 2) + $hex.Substring(16, 2)).ToUpper()
    Log ('  lock code on the card: "' + $onCard + '"   (the DLL decoder says "' + $lock.ToString() + '"; it drops the top bit of each byte)')
    Log '  -> the code on the card is the door''s code: compare it with the room in the Lock Management System / Export LockNo.'
    Log ('  DAI on the card: ' + [Convert]::ToInt32($hex.Substring(22, 2), 16) + '   (characters 23-24; the lock program''s own cards use 0)')
    $etime = New-Object System.Text.StringBuilder 64
    $null = Invoke-Dll ('GetGuestETimeByCardDataStr(hotel ' + $script:HotelId + ')') { [ProRfl]::GetGuestETimeByCardDataStr($script:HotelId, $hex, $etime) }
    Log ('  ends: "' + $etime.ToString() + '"   (yyMMddHHmm)')
  }
  return $hex
}

$lastHex = $null
if (-not $NoRead) {
  $null = Read-Host 'Take every card OFF the encoder, then press Enter'
  $null = Read-OneCard 'no card on the encoder'
  $null = Read-Host 'Lay a GUEST card made by the Lock Management System on the encoder (note its room and end time), then press Enter'
  $lastHex = Read-OneCard 'a guest card made by the lock program'
  while ($true) {
    $more = Read-Host 'Lay another card (a BLANK card next, please), then press Enter. Or type done'
    if ($more -eq 'done') { break }
    $h = Read-OneCard 'another card'
    if ($h) { $lastHex = $h }
  }
}

# ---- 5. What the lock bridge should be told -----------------------------------
# (Compared as text: in PowerShell 0 -ne '' is false, which would drop the code 0.)
function Unique($xs) { return @($xs | Where-Object { $null -ne $_ -and ('' + $_) -ne '' } | Select-Object -Unique) }
$cal = [ordered]@{
  calibrated = $false
  usbType = [int]$UsbType
  initOkCodes = @(Unique @($initRc))
  readOkCodes = @(Unique $seen.readOk)
  writeOkCodes = @(0)
  blankCardTypes = @(Unique $seen.blankType)
  guestCardTypes = @(Unique $seen.guestType)
  beepOnSuccess = $false
}
Log ('No-card return code(s): ' + ((Unique $seen.noCard) -join ', ') + '   (Joney documents 1)')
Log 'Suggested "calibration" for %ProgramData%\AMPLockBridge\encoder.json (the developer checks it against this log, then sets calibrated to true):'
Log (ConvertTo-Json $cal -Compress)

function Confirm-Write([string]$what) {
  Log ('About to WRITE: ' + $what)
  Log 'The card lying on the encoder will be OVERWRITTEN. It must be a spare guest or blank card,'
  Log 'never a system, authorization, master, floor, setup or backup card.'
  $answer = Read-Host 'Spare card on the encoder, empty test room only? Type YES to continue'
  if ($answer -ne 'YES') { Log 'Skipped (not confirmed).'; return $false }
  return $true
}

# ---- 6. Optional: issue a short test guest card ---------------------------------
if ($IssueTest) {
  if ($HotelId -eq 0) { Log 'STOP: -IssueTest needs the hotel ID: give -HotelId, or let the probe read a guest card first.'; exit 4 }
  $LockNo = ('' + $LockNo).Trim().ToUpper()
  if ($LockNo -notmatch '^[0-9A-F]{6}$') { Log 'STOP: -LockNo must be the test door''s 6-character code from the Lock Management System (0-9, A-F), e.g. 01020A.'; exit 4 }
  if ($Dai -lt 1 -or $Dai -gt 255) { Log 'STOP: -Dai must be 1..255 (see README: use a number no card of that room has now).'; exit 4 }
  if (-not $EndTime) { $EndTime = (Get-Date).AddMinutes(15).ToString('yyMMddHHmm') }
  if ($EndTime -notmatch '^\d{10}$') { Log 'STOP: -EndTime must be yyMMddHHmm (10 digits).'; exit 4 }
  # Joney's DLL ignores the begin time (the lock program sets it); it is passed only to fill the argument.
  $BeginTime = (Get-Date).ToString('yyMMddHHmm')
  $what = 'GuestCard cardNo=' + $CardNo + ' lock=' + $LockNo + ' dai=' + $Dai + ' until ' + $EndTime + ' (hotel ' + $HotelId + '; deadbolt and public doors off)'
  if (Confirm-Write $what) {
    $out = New-Object System.Text.StringBuilder 4096
    $null = Invoke-Dll 'GuestCard' { [ProRfl]::GuestCard($UsbType, $HotelId, $CardNo, [byte]$Dai, 0, 0, $BeginTime, $EndTime, $LockNo, $out) }
    Log ('  card data returned: ' + $out.ToString())
    $null = Read-OneCard 'the test card, read back'
    Log ('Now try the test door: it should open until ' + $EndTime + ', and not after. Then try that room''s older card: it should no longer open the door.')
  }
}

# ---- 7. Optional: erase the card on the encoder --------------------------------
if ($EraseTest) {
  if ($HotelId -eq 0) { Log 'STOP: -EraseTest needs the hotel ID.'; exit 4 }
  if (Confirm-Write ('CardErase hotel=' + $HotelId + ' (the card lying on the encoder)')) {
    $erase = New-Object System.Text.StringBuilder 4096
    $null = Invoke-Dll 'CardErase' { [ProRfl]::CardErase($UsbType, $HotelId, $erase) }
    Log ('  after erase: ' + $erase.ToString())
    $null = Read-OneCard 'the erased card, read back'
    Log 'Now try the test door: the card should no longer open it.'
  }
}

# ---- 8. Optional: the guided door test ------------------------------------------
# Answers, at a real door, what Joney's SDK text leaves open. The test cards use DAI 250 and 251,
# far from the 1, 2, 3... the server gives real stays, and end 30 minutes after the test starts.
if ($DoorTest) {
  if ($HotelId -eq 0) { Log 'STOP: -DoorTest needs -HotelId (the probe prints it from a guest card).'; exit 4 }
  $LockNo = ('' + $LockNo).Trim().ToUpper()
  if ($LockNo -notmatch '^[0-9A-F]{6}$') { Log 'STOP: -DoorTest needs -LockNo, the test door''s 6-character code (as the probe reads it from that room''s guest card).'; exit 4 }
  $testEnd = (Get-Date).AddMinutes(30).ToString('yyMMddHHmm')
  $answers = [ordered]@{}
  $writeCodes = @()
  Log ('DOOR TEST for lock ' + $LockNo + '. Test cards end at ' + $testEnd + ' (yyMMddHHmm).')
  Log '  You need: someone at that door; this morning''s guest card for the room (made in the Lock Management System);'
  Log '  and three spare cards (blank, or old guest cards), called A, B and C. Label them.'
  Log '  The test writes cards A, B and C, then erases A. It refuses any card that is not blank or a guest card.'
  $go = Read-Host 'Nobody staying in this room, and someone at the door? Type YES to start'
  if ($go -ne 'YES') { Log 'Door test not started.'; exit 0 }

  function Ask([string]$key, [string]$question) {
    $a = ''
    while ($a -ne 'y' -and $a -ne 'n') { $a = ('' + (Read-Host ($question + ' Type y or n'))).Trim().ToLower() }
    Log ('  ' + $key + ': ' + $a)
    $script:answers[$key] = $a
  }
  function Get-TypeCode([string]$hex) {
    $t = New-Object System.Text.StringBuilder 64
    try { $null = [ProRfl]::GetCardTypeByCardDataStr($hex, $t) } catch { return '' }
    $s = $t.ToString()
    if ($s.Length -gt 0) { return $s.Substring(0, 1).ToUpper() } else { return '' }
  }
  # A card may be written only if its data and the lock program both say blank, or both say guest.
  function Test-Writable([string]$hex) {
    if (-not $hex) { return $false }
    $layout = Get-Layout $hex
    $code = Get-TypeCode $hex
    return (($layout -eq 'blank' -and $code -eq 'F') -or ($layout -eq 'guest' -and $code -eq '6'))
  }
  function Write-TestCard([string]$name, [byte]$no, [int]$dai) {
    while ($true) {
      $r = Read-Host ('Lay spare card ' + $name + ' on the encoder, then press Enter (or type stop)')
      if (('' + $r).Trim().ToLower() -eq 'stop') { Log 'Door test stopped.'; exit 0 }
      $before = Read-OneCard ('card ' + $name + ' before writing')
      if (Test-Writable $before) { break }
      Log ('  Card ' + $name + ' is not a blank or guest card: NOT written. Put it away and use another spare card.')
    }
    $out = New-Object System.Text.StringBuilder 4096
    $begin = (Get-Date).ToString('yyMMddHHmm')
    $rc = Invoke-Dll ('GuestCard card ' + $name + ' (cardNo ' + $no + ', dai ' + $dai + ', until ' + $script:testEnd + ')') { [ProRfl]::GuestCard($UsbType, $HotelId, $no, [byte]$dai, 0, 0, $begin, $script:testEnd, $LockNo, $out) }
    $after = Read-OneCard ('card ' + $name + ', read back')
    $onCard = if ($after -and $after.Length -ge 22) { ($after.Substring(20, 2) + $after.Substring(18, 2) + $after.Substring(16, 2)).ToUpper() } else { '' }
    $good = [bool]$after -and (Get-Layout $after) -eq 'guest' -and $onCard -eq $LockNo
    Log ('  card ' + $name + ': GuestCard returned ' + $rc + '; reads back as a guest card for ' + $LockNo + ': ' + $good)
    if ($good) { $script:writeCodes += $rc }
  }

  Log '--- Step 1: card A, a new stay (DAI 250)'
  Write-TestCard 'A' 0 250
  Ask 'A_opens' 'Take card A to the door. Does it OPEN the door?'
  Ask 'old_card_after_A' 'Now try this morning''s guest card for the room. Does it still open?'
  Log '--- Step 2: card B, an extra card for the same stay (DAI 250 again)'
  Write-TestCard 'B' 1 250
  Ask 'B_opens' 'Card B at the door. Does it OPEN?'
  Ask 'A_after_B' 'Card A again. Does it still open?'
  Log '--- Step 3: card C, new cards for the stay, as for a lost card (DAI 251)'
  Write-TestCard 'C' 2 251
  Ask 'C_opens' 'Card C at the door. Does it OPEN?'
  Ask 'A_after_C' 'Card A again. Does it still open?'
  Ask 'B_after_C' 'Card B again. Does it still open?'
  Log '--- Step 4: erase card A'
  $null = Read-Host 'Lay card A on the encoder, then press Enter'
  $beforeErase = Read-OneCard 'card A before erasing'
  if (Test-Writable $beforeErase) {
    $erase = New-Object System.Text.StringBuilder 4096
    $erc = Invoke-Dll 'CardErase card A' { [ProRfl]::CardErase($UsbType, $HotelId, $erase) }
    $afterErase = Read-OneCard 'card A, erased, read back'
    Log ('  card A after erasing reads as: ' + $(if ($afterErase) { Get-Layout $afterErase } else { 'nothing readable' }) + ' (CardErase returned ' + $erc + ')')
  } else { Log '  Card A is not a blank or guest card: not erased.' }

  $expect = [ordered]@{ A_opens = 'y'; old_card_after_A = 'n'; B_opens = 'y'; A_after_B = 'y'; C_opens = 'y'; A_after_C = 'n'; B_after_C = 'n' }
  $meaning = @{
    A_opens = 'a card made through the SDK opens the door (the lock code is right)'
    old_card_after_A = 'a new stay locks out the room''s older cards'
    B_opens = 'an extra card for the same stay opens'
    A_after_B = 'and it does not lock out the stay''s first card'
    C_opens = 'new cards with a new DAI open (how a lost card is handled)'
    A_after_C = 'and they lock out the stay''s old cards'
    B_after_C = 'all of them'
  }
  Log '--- Door test results'
  foreach ($k in $expect.Keys) {
    $got = $answers[$k]
    Log ('  ' + $(if ($got -eq $expect[$k]) { 'OK   ' } else { 'CHECK' }) + ' ' + $k + ' = ' + $got + ' (expected ' + $expect[$k] + '): ' + $meaning[$k])
  }
  Log ('  GuestCard return code(s) on cards that read back right: ' + ((Unique $writeCodes) -join ', ') + '   (Joney documents 0)')
  Log ('Last check, after ' + $testEnd + ': card C must no longer open the door. Note it when you send this log.')
}

Log 'Done. Send this log file privately to the developer.'
