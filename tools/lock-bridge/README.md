# AMP Lock Bridge

A small Windows tray app for the reception PC that holds the Joney card encoder.
The staff portal (https://amplodge.org) asks it to write guest key cards. It listens on
`http://127.0.0.1:47123` only, and it writes a card only when the order carries the
server's signature.

```
portal (browser) ──1. challenge──▶ bridge (127.0.0.1)
portal ──2. booking + challenge──▶ server: checks the booking, signs the order
portal ──3. signed order, one card at a time──▶ bridge ──▶ proRFL.dll ──▶ Joney's Lock Management System (127.0.0.1:10086) ──▶ encoder
bridge ──4. result (device token)──▶ server: the Key cards page updates
```

`proRFL.dll` comes from Joney's own SDK ("New Lock System SDK [V0925]", `ProUsb-20211115`).
It doesn't touch the encoder itself. It passes each command to Joney's **Lock Management
System**, so that program must be **open and logged in** whenever cards are made. The
bridge checks that it is listening before each card, and says so in the tray when it
isn't.

Two things come from Joney's program:
- **Lock codes:** each door has a 6-character code, digits and A-F (e.g. `01020A`),
  entered on the portal's Rooms page.
- **DAI:** every card of one stay carries the same "DAI" number (1-255), and the next stay
  gets the next one. The server picks it and signs it into the order. Once a card with a
  new DAI has opened the door, the lock refuses the older cards. So the last guest's card
  stops working as soon as the next guest goes in.

## What it will and won't do

- It writes **guest cards only**, from an order the server signed with the key the bridge
  stored at pairing. Each order is tied to a one-time challenge from this bridge and to
  this PC's encoder ID. The bridge re-checks the card count, the lock codes, the DAI and
  the times itself. It takes only v2 orders: 6-character lock codes, with a DAI.
- It accepts requests only from `https://amplodge.org` and `www.amplodge.org`. The
  request must use the Host `127.0.0.1:47123`, which blocks DNS rebinding, and the body
  must be JSON.
- It has **no way** to make master, floor, building, emergency, system or "always open"
  cards. Joney's 2021 DLL has no such calls, and the bridge declares none. Lock setup
  stays in Joney's program.
- It never writes over a card that isn't blank or a guest card. It reads the card first.
  The DLL's card-type code and the first character of the card's serial (characters 25-32
  of its data: `6` guest, `F` blank, also on cards the lock program has erased) must both
  say "blank" or "guest".
- It reads every card back after writing it. A card counts as made only when the read-back
  shows the right lock code, end time and DAI.
- It loads only the `proRFL.dll` from Joney's V0925 SDK (checked by sha256), unless
  `encoder.json` names another build in `proRflSha256`.
- A suite card (one card for two doors) isn't in Joney's SDK, so a two-door room gets one
  card per door. Nor are Joney's lost and check-out cards. Both are done with guest cards
  and the DAI instead (a card with a new DAI, once used at the door, makes the lock refuse
  every older card: tested at a door):
  - **Card lost** on the Key cards page makes the stay new cards with a new DAI.
  - **Lock out the door** makes a *lock-out card* for an empty room: a guest card with the
    next DAI, valid for 20 minutes. Held to the lock once, it stops every older card,
    including cards made in Joney's program. Its order carries `"purpose": "lockout"` and the
    empty booking ID, which the bridge does not use, so it is written like any guest card.
- Every step goes to a journal on disk **before** the encoder is touched. If a power cut
  or crash interrupts a write, that card shows as "unknown" on the Key cards page and
  is never written twice. If the internet is down, results wait in the journal and are
  sent later.
- Card data never leaves the PC. The server only hears "card 2 of order X: issued".

## Layout

| Folder | What |
|---|---|
| `src/LockBridge.Core` | Everything that isn't Windows-only: order checks, journal, card writer, receipts, pairing, the HTTP API. |
| `src/LockBridge.Sim` | The same bridge with a pretend encoder, for working on the portal on any OS. It writes nothing. |
| `src/LockBridge.Win` | The reception PC app: `proRFL.dll` driver (one STA thread: the DLL waits for Joney's program by pumping messages), tray icon, DPAPI-sealed settings. 32-bit. |
| `tests/LockBridge.Core.Tests` | xUnit. Includes an order signed by the server's own code (`tests/fixtures/make-node-order.mjs`). |
| `probe/` | The one-off encoder probe for the reception PC (see its README). |

## Develop

Needs the .NET 10 SDK.

```sh
dotnet build LockBridge.slnx
dotnet test LockBridge.slnx
dotnet run --project src/LockBridge.Sim                 # http://127.0.0.1:47123, reports to netlify dev
dotnet run --project src/LockBridge.Sim -- --pair <code>
```

The simulator also takes `POST /sim/encoder {card: "none" | "last" | "blank"}`, for tests:
nothing on the encoder (reads find no card, writes fail), the card written last (the
default), or a blank card.

By default the simulator reports to `netlify dev` (`http://localhost:8888`), not to the
live site, so pretend cards never show up as real ones. Remember that `netlify dev`
still uses the **live** database.

### HTTP API

| | |
|---|---|
| `GET /status` | Paired? Encoder ready? Results still unsent? |
| `POST /challenge` | A one-time challenge, valid for 5 minutes. The portal sends it to `key-card-order`. |
| `POST /cards/issue` | `{order, signature, cardNo}`: writes one card of a signed order. Asking again for the same card returns the stored result. |
| `POST /cards/read` | Reads the card on the encoder and writes nothing (0.1.2+). Returns its kind (`none`, `blank`, `guest`, `otherHotel`, `staff`, `unknown`); for a guest card of this hotel its door code, end time and DAI; for a staff or setup card only what kind it is. Never the card's data. `noCard` is true when the encoder answered and nothing lies on it. From 0.1.3, `{waitFor: "card" \| "removed", timeoutMs}` waits (up to 60 s, looking every 0.5 s) until a card is laid down or lifted, for hands-free reading; `timedOut` says the wait ran out. An encoder problem answers at once. |
| `GET /orders/{nonce}` | What happened to each card of an order, and whether the server has been told. |
| `POST /pair` | `{code}`: redeems the one-time code from Settings → Door locks. Works only while unpaired. |

## The reception PC

1. **Build:**
   ```sh
   dotnet publish src/LockBridge.Win -c Release -p:PublishSingleFile=true --self-contained -o out/win
   ```
   This gives one `AMPLockBridge.exe` (32-bit, about 60 MB, no .NET install needed).
2. **Install:**
   - Copy it to `C:\Program Files (x86)\AMP Lock Bridge\`.
   - Copy `proRFL.dll` from Joney's V0925 SDK (see `probe/README.md`) to the `sdk` folder
     inside it. No other DLL is needed.
   - Program Files is used because ordinary users can't write there, so nobody can swap
     in a different DLL.
3. **Set the hotel's lock ID** (the probe prints it, from a guest card):
   `AMPLockBridge.exe --set-hotel-id <number>`. It is stored sealed to this PC. The DLL
   needs it to read cards back.
4. **Autostart:** put shortcuts to Joney's Lock Management System and to the exe in
   `C:\ProgramData\Microsoft\Windows\Start Menu\Programs\StartUp`. Joney's program also
   has to be logged in.
5. **Pair:** an admin opens Settings → Door locks on this PC and clicks Pair.
6. **Switch on card writing**, using the probe log. The probe ends with a suggested
   `calibration` section. Copy it into `C:\ProgramData\AMPLockBridge\encoder.json`, which is
   created on the first start, after checking it against the log:

   | Field | Value from the probe log |
   |---|---|
   | `initOkCodes` | the code after `initializeUSB(1) -> return code`, on a run where the encoder beeped |
   | `readOkCodes` | the code after `ReadCard(1) -> return code`, when card data was printed |
   | `guestCardTypes` | the first character of `card type:` for the guest card (Joney documents `6`) |
   | `blankCardTypes` | the same for the blank card (Joney documents `F`) |
   | `writeOkCodes` | the code after `GuestCard -> return code`, from the write test where the door opened (Joney documents `0`) |

   Then set `"calibrated": true` and restart the bridge. Until then the bridge writes nothing,
   and the tray says so.
7. **Firewall:** Joney's program listens on every address, so other computers on the
   hotel network could ask it for cards. Add the firewall rule the probe prints. The bridge
   reads Windows Firewall (every 5 minutes) and warns until an enabled inbound Block rule for
   TCP 10086 covers every address but 127.x, with the firewall on for the network in use.

**Updating** (0.1.3 and later): copy the new `AMPLockBridge.exe` and `Update-Bridge.ps1` into
one folder on the PC, open Windows PowerShell as administrator in it, and run
`powershell.exe -ExecutionPolicy Bypass -File .\Update-Bridge.ps1 -Sha256 <fingerprint>` with the
fingerprint the developer sent. The script:
- checks the fingerprint;
- waits for any card being written, then stops the bridge;
- keeps the old exe as `AMPLockBridge.old.exe` and copies the new one in;
- starts it again as the signed-in user, not as administrator;
- prints the version that answers.

Nothing in `C:\ProgramData\AMPLockBridge` is touched.

The tray menu has **Start Joney's lock program** (0.1.3+). It is greyed out while the program
runs. The bridge learns where `CardLock.exe` is from the running program and keeps that in
`lock-program.txt`. Before that, it tries the installer's usual folders. **Quit** now always
ends the process, after at most a few seconds of clean-up.

The tray icon:
- **green**: ready;
- **amber**: something to do (not paired, Joney's program closed, encoder not ready,
  results not sent yet);
- **red**: this PC was removed in Settings, or the lock program stopped answering (close
  Joney's program and open it again, then restart the bridge).

`bridge.log` records what the lock program answered (return codes, never card data).
