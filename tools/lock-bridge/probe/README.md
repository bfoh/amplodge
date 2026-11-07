# Encoder probe

A one-file check, run on the reception PC that holds the Joney card encoder. It shows
whether the AMP Lodge system can make cards through `proRFL.dll` from Joney's own SDK
("New Lock System SDK [V0925]"), and what the hotel's cards contain. It installs nothing
and changes nothing on the PC.

How Joney's SDK works: `proRFL.dll` does not drive the encoder itself. It sends each
command to Joney's **Lock Management System**, which must be **open and logged in** on
the same PC, at `127.0.0.1:10086`. That program makes the card. The SDK's empty file
"Please Run 'Lock Management System' First" means exactly this.

## Before you start

1. Joney's Lock Management System is installed and set up as in Joney's "Key points for
   hotel software setting" sheet, including the backups to the encoder. It is **open and
   logged in**, and it can make a guest card itself.
2. The encoder is plugged in.
3. One **empty test room**, a guest card made in Joney's program for it, and one spare
   blank card.
4. The PC's time zone is **(UTC+00:00) Monrovia, Reykjavik**. The London zone is
   wrong: it moves an hour in summer.

## 1. Note the lock codes

Every door has a **6-character lock code** in the Lock Management System (digits and
A-F, for example `01020A`). **Export LockNo** writes them all, with the hotel's ID
(Hotel CoID), to a `LockNo_....Txt` file on the Desktop. These codes go into the portal's
Rooms page later. The file is private hotel data: send it only privately.

The code is building, floor and room, two characters each. A building number above 127
starts with 8-F (building 165 is `A5`). Joney's DLL decoder drops the top bit of each part
(it shows `A5` as `25`), so the probe prints the code **as the card holds it**, which is
the one to use.

## 2. The SDK file

From Joney's `New Lock System SDK [V0925].rar`, only `proRFL.dll` is needed (the 2021
build, not `proRFL-5555.dll` or `proRFL-ComputerName.dll`). Put it in `C:\AMPLock\sdk`
and check it:

```powershell
(Get-FileHash C:\AMPLock\sdk\proRFL.dll -Algorithm SHA256).Hash
# must be 4A86C167956AAF025A033362A84164BE944C2C16A8615489AD4243215AF08E1D
```

## 3. Run it (read only)

Copy `Probe-Encoder.ps1` to `C:\AMPLock\probe\`. With **Joney's program open**, run it in
the **32-bit** PowerShell (the DLL is 32-bit):

```powershell
cd C:\AMPLock\probe
C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -STA -ExecutionPolicy Bypass -File .\Probe-Encoder.ps1 -DllDir C:\AMPLock\sdk
```

It checks that the program is listening on port 10086, then beeps the encoder through it
and asks whether you heard the beep. Then it asks for cards, one at a time:
1. none (it learns the "no card" answer);
2. the guest card from Joney's program. It reads the hotel ID and the lock code from it.
   Check that the code matches the room in the Lock Management System;
3. the blank card, then `done`.

At the end it prints a suggested `calibration` for the lock bridge.

- **"nothing is listening on port 10086"**: the program is closed, or its SDK interface is
  off in this version. Ask Joney how to switch it on.
- **No beep**: the DLL reached nothing. Check that the program is logged in and can make a
  card itself.
- **"accepts connections from the NETWORK"**: any computer on the hotel network could ask
  the program for cards. The log shows a firewall rule that blocks other computers but not
  this PC. After adding it, run the probe again. The program still listens on every
  address, so the probe now checks the firewall: it should say "OK: ... Windows Firewall
  blocks port 10086", and the beep must still work. For proof, run the `Test-NetConnection`
  line it prints on another computer on the hotel network.

## 4. Write tests (only with the developer on the call)

These write to the card lying on the encoder. Use only the spare card and the empty test
room. Never put a system, authorization, master, floor, setup or backup card on the
encoder while these run. Each asks you to type `YES` first.

```powershell
# a guest card for the test door, valid for 15 minutes
...\powershell.exe -STA -ExecutionPolicy Bypass -File .\Probe-Encoder.ps1 -DllDir C:\AMPLock\sdk -NoRead -HotelId <hotel ID from the read above> -IssueTest -LockNo <the door's 6-character code> -Dai 200

# erase the card on the encoder
...\powershell.exe -STA -ExecutionPolicy Bypass -File .\Probe-Encoder.ps1 -DllDir C:\AMPLock\sdk -NoRead -HotelId <hotel ID> -EraseTest
```

**DAI** is the card's "override" number, 1 to 255. Every card for one stay has the same
DAI, and the next stay gets a different one. Once a card with a new DAI has opened the
door, the lock refuses cards with the old one. So after the test card has opened the door,
the guest card from step 3 should **stop** working, and that proves it. The test card
itself expires in 15 minutes.

Check on the door, and note in the log:
- the test card opens the door, and stops after its end time;
- the older guest card stops opening it after the test card was used;
- what start time the lock program put on the card (Joney's DLL ignores the one it is
  given).

Also try this by hand: close Joney's program and open it again, then run the probe.
It should still beep.

## Send the log

Each run writes `probe-<date>-<time>.log` next to the script. It contains the hotel's ID
and guest-card data. The data of master, floor and other system cards is never logged. So:
- send it **privately** to the developer (direct email or chat, not a group);
- never post it;
- delete it from the PC afterwards.

Never copy `proRFL.dll`, Joney's documents, the export file or the logs into the AMP Lodge
code repository: it is public.
