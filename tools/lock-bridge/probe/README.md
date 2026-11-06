# Encoder probe

A one-file check, run on the reception PC that holds the Joney card encoder. It shows
whether the AMP Lodge system can talk to the encoder through `proRFL.dll`, the proUSB
interface that Abacre Hotel Management System uses for Joney locks, and what the cards
contain. It installs nothing and changes nothing on the PC.

## Before you start

1. Joney's software (LQ015 Smart Locks System) is installed and set up as in Joney's
   "Key points for hotel software setting" sheet, including the backups to the encoder.
2. The encoder is plugged in.
3. A guest card made in Joney's software for **one test door**, and one spare card. If
   possible, pick a test door whose room number has a floor or room part of 10 or more (for example 110).
4. The PC's time zone is **(UTC+00:00) Monrovia, Reykjavik**. The London zone is
   wrong: it moves an hour in summer.

## 1. Export the lock numbers from Joney's software

In Joney's program, use **Export LockNo**. It saves a `LockNo_....Txt` file on the
Desktop with the hotel's **Hotel CoID** and every room's lock number. Note the Hotel CoID
for the steps below. The file is private hotel data: send it only privately.

## 2. Get the SDK files

Joney's install does not include `proRFL.dll`. Download Abacre's package and check it is
the expected file:

```powershell
mkdir C:\AMPLock\sdk -Force; cd C:\AMPLock\sdk
[Net.ServicePointManager]::SecurityProtocol = 'Tls12'
Invoke-WebRequest https://www.abacre.com/download/prorfl.zip -OutFile prorfl.zip
(Get-FileHash prorfl.zip -Algorithm SHA256).Hash
# must be 18F4361E1BC44CB876C9DB9863A11105961ADEC2E9CFDD4694A599842D0B680E
Expand-Archive prorfl.zip -DestinationPath C:\AMPLock\sdk -Force
```

## 3. Run it (read only)

Copy `Probe-Encoder.ps1` to `C:\AMPLock\probe\`, **close Joney's program**, then run it
in the **32-bit** PowerShell (the DLL is 32-bit), with the Hotel CoID from step 1:

```powershell
cd C:\AMPLock\probe
C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -ExecutionPolicy Bypass -File .\Probe-Encoder.ps1 -DllDir C:\AMPLock\sdk -HotelId <Hotel CoID>
```

The encoder should beep. When asked, lay the Joney guest card on the encoder and press Enter.

- **If it does not beep**, copy `d12c.dll` from Joney's install folder over the one in
  `C:\AMPLock\sdk` (Joney's is a newer build) and run again.
- Run it once more **with Joney's program open**, to see if both can use the encoder.

## 4. Write tests (only with the developer on the call)

These write to the card lying on the encoder. Use only the spare card and the test
door. Never put a system, authorization, master, floor, setup or backup card on the
encoder while these run. Each asks you to type `YES` first.

```powershell
# a guest card for the test door, valid from 10 minutes ago to 10 minutes from now
...\powershell.exe -ExecutionPolicy Bypass -File .\Probe-Encoder.ps1 -DllDir C:\AMPLock\sdk -HotelId <Hotel CoID> -IssueTest -LockNo <8 digits from the read above>

# erase the card on the encoder
...\powershell.exe -ExecutionPolicy Bypass -File .\Probe-Encoder.ps1 -DllDir C:\AMPLock\sdk -HotelId <Hotel CoID> -EraseTest
```

## Send the log

Each run writes `probe-<date>-<time>.log` next to the script. It contains the hotel's
card data, so:
- send it **privately** to the developer (direct email or chat, not a group);
- never post it;
- delete it from the PC afterwards.

Never copy `proRFL.dll`, Joney's documents, the export file or the logs into the AMP Lodge
code repository: it is public.
