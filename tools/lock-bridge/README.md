# AMP Lock Bridge

A small Windows tray app for the reception PC that holds the Joney card encoder.
The staff portal (https://amplodge.org) asks it to write guest key cards. It listens on
`http://127.0.0.1:47123` only, and it writes a card only when the order carries the
server's signature.

```
portal (browser) ──1. challenge──▶ bridge (127.0.0.1)
portal ──2. booking + challenge──▶ server: checks the booking, signs the order
portal ──3. signed order, one card at a time──▶ bridge ──▶ proRFL.dll ──▶ encoder
bridge ──4. result (device token)──▶ server: the Key cards page updates
```

## What it will and won't do

- It writes **guest cards only**, from an order the server signed with the key the bridge
  stored at pairing. Each order is tied to a one-time challenge from this bridge and to
  this PC's encoder ID. The bridge re-checks the card count, the lock numbers and the
  times itself.
- It accepts requests only from `https://amplodge.org` and `www.amplodge.org`. The
  request must use the Host `127.0.0.1:47123`, which blocks DNS rebinding, and the body
  must be JSON.
- It has **no way** to make master, floor, building, emergency, system or "always open"
  cards. Those calls are not even declared. Lock setup stays in Joney's program.
- It never writes over a card that isn't blank or a guest card. It reads the card first.
- It reads every card back after writing it. A card counts as made only when the read-back
  shows the right lock and end time.
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
| `src/LockBridge.Win` | The reception PC app: `proRFL.dll` driver, tray icon, DPAPI-sealed settings. 32-bit. |
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

By default the simulator reports to `netlify dev` (`http://localhost:8888`), not to the
live site, so pretend cards never show up as real ones. Remember that `netlify dev`
still uses the **live** database.

### HTTP API

| | |
|---|---|
| `GET /status` | Paired? Encoder ready? Results still unsent? |
| `POST /challenge` | A one-time challenge, valid for 5 minutes. The portal sends it to `key-card-order`. |
| `POST /cards/issue` | `{order, signature, cardNo}`: writes one card of a signed order. Asking again for the same card returns the stored result. |
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
   - Copy the SDK files from Abacre's `prorfl.zip` (see `probe/README.md`) to the `sdk`
     folder inside it: `proRFL.dll`, `d12.dll`, `d12c.dll`, `MFC42D.DLL` and `MSVCRTD.DLL`.
     If the probe showed that Joney's newer `d12c.dll` is needed, copy that one instead.
   - Program Files is used because ordinary users can't write there, so nobody can swap
     in a different DLL.
3. **Set the hotel's lock ID** (the "Hotel CoID" from Joney's Export LockNo):
   `AMPLockBridge.exe --set-hotel-id <number>`. It is stored sealed to this PC.
4. **Autostart:** put a shortcut to the exe in
   `C:\ProgramData\Microsoft\Windows\Start Menu\Programs\StartUp`.
5. **Pair:** an admin opens Settings → Door locks on this PC and clicks Pair. That
   needs the portal side, which isn't built yet.
6. **Switch on card writing**, using the probe logs. Fill in
   `C:\ProgramData\AMPLockBridge\encoder.json`, which is created on the first start. All of
   these go in its `calibration` section, except `proRflSha256`, which sits at the top level:

   | Field | Value from the probe log |
   |---|---|
   | `initOkCodes` | the code after `initializeUSB(1) -> return code`, on a run where the encoder beeped |
   | `readOkCodes` | the code after `ReadCard(1) -> return code`, when card data was printed |
   | `guestCardTypes` | the `card type:` text printed for the Joney guest card |
   | `blankCardTypes` | the `card type:` text from a second run with a new, never-used card |
   | `writeOkCodes` | the code after `GuestCard -> return code`, from the write test where the door opened |
   | `proRflSha256` | the `proRFL.dll sha256` line in `bridge.log` |

   Then set `"calibrated": true` in `calibration` and restart the bridge. Until then the bridge writes
   nothing, and the tray says so.

The tray icon:
- **green**: ready;
- **amber**: something to do (not paired, encoder not ready, results not sent yet);
- **red**: this PC was removed in Settings, or the encoder hung (unplug it, plug it back
  in, restart the bridge).

`bridge.log` records what the encoder answered (return codes, never card data).
