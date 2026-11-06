# Encoder probe

A one-file check, run on the reception PC that holds the Joney card encoder. It shows
whether the AMP Lodge system can talk to the encoder through Joney's `proRFL.dll`,
and what the cards contain. It installs nothing and changes nothing on the PC.

## Before you start

1. Joney's software is installed and set up as in Joney's "Key points for hotel
   software setting" sheet, including the backups to the encoder.
2. The encoder is plugged in.
3. A guest card made in Joney's software for **one test door**, and one spare card.
4. The PC's time zone is **(UTC+00:00) Monrovia, Reykjavik**. The London zone is
   wrong: it moves an hour in summer.

## Find proRFL.dll

Open PowerShell and search the Joney install folder (usually under `C:\Program Files (x86)`):

```powershell
Get-ChildItem 'C:\Program Files (x86)','C:\Program Files','C:\' -Recurse -Filter *rfl*.dll -ErrorAction SilentlyContinue | Select-Object FullName, Length
```

Note the folder it is in. If nothing is found, send a photo of the Joney install folder instead.

## Run it (read only)

Copy `Probe-Encoder.ps1` to `C:\AMPLock\probe\`, **close Joney's program**, then run
it in the **32-bit** PowerShell (the DLL is 32-bit):

```powershell
cd C:\AMPLock\probe
C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -ExecutionPolicy Bypass -File .\Probe-Encoder.ps1 -DllDir "C:\folder\from\the\search"
```

The encoder should beep. When asked, lay the Joney guest card on the encoder and press Enter.

Run it a second time **with Joney's program open**, to see if both can use the encoder.

## Write tests (only with the developer on the call)

These write to the card lying on the encoder. Use only the spare card and the test
door. Never put a system, authorization, master, floor, setup or backup card on the
encoder while these run. Each asks you to type `YES` first.

```powershell
# a guest card for the test door, valid from 10 minutes ago to 10 minutes from now
...\powershell.exe -ExecutionPolicy Bypass -File .\Probe-Encoder.ps1 -DllDir "..." -HotelId <from the first run> -IssueTest -LockNo <from the first run>

# erase the card on the encoder
...\powershell.exe -ExecutionPolicy Bypass -File .\Probe-Encoder.ps1 -DllDir "..." -HotelId <from the first run> -EraseTest
```

## Send the log

Each run writes `probe-<date>-<time>.log` next to the script. It contains the hotel's
card data, so send it **privately** to the developer (direct email or chat, not a
group), never post it, and delete it from the PC afterwards. Never copy `proRFL.dll`,
Joney's documents or the logs into the AMP Lodge code repository: it is public.
