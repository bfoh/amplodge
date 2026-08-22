# Money tests

Everything that touches revenue, payments, charges, stock or invoices is covered
here. There is no test framework in this repo — each suite is a script that
prints `PASS`/`FAIL` lines and exits non-zero on failure.

```bash
./tests/run.sh              # every suite
./tests/run.sh accounting   # one suite by name
```

## Unit suites (`tests/*.test.ts`)

Run the real modules directly.

| suite | covers |
|---|---|
| `group-bookings` | group deposits counted once, batch detection, `perRoom` marker, per-staff shares |
| `accounting` | discounts applied after payment, per-method attribution, deposit caps |
| `allocation` | splitting one payment across rooms so the shares add back up exactly |
| `cash-basis` | only collected money counts; balances settle on check-out |

## End-to-end suites (`tests/e2e/*.ts`)

Run the **actual services and hooks** — booking engine, check-in, check-out,
charges, extensions, sales, revenue, analytics, invoices — against an in-memory
database (`fake-db.ts`) standing in for `@/lib/db`. Notifications, email and SMS
are stubbed; nothing else is.

| suite | covers |
|---|---|
| `lifecycle` | deposit → balance at check-in → settlement at check-out, discounts, unpaid stays, charges with linked stock, extensions, sales, cancellations, invoice totals and tax |
| `groups-analytics` | group bookings with a discount, groups split across two staff, analytics agreeing with the per-staff figures, and the invariants below |
| `charges-repeat` | charge edits and deletes returning stock, repeated check-outs and sales not double counting, concurrent stock movements |

## Invariants

Asserted per booking row wherever revenue is computed:

- per-method totals equal that row's attributed revenue
- attributed revenue never exceeds what the booking is worth after discount
- no negative figures
- grand revenue equals rooms + charges + standalone sales
- across every staff member and week, one booking is never credited beyond its value

## Production audit

`tests/audit-production.ts` runs those invariants over the live database — every
booking, 26 weeks, every staff member. Read-only.

```bash
env $(npx netlify env:list --json | python3 -c "import json,sys; d=json.load(sys.stdin); print(' '.join(f'{k}={v}' for k,v in d.items() if k in ('SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY')))") \
  ./tests/run.sh audit
```
