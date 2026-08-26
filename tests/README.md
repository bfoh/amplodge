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
| `revenue-visibility` | who may see what the hotel has earned — reception may not, and still keeps the job they do |

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
| `group-membership` | every room of a group is found by both routes — the indexed column and the GROUP_DATA comment — past the old 500-row window, on a group that uses both, and a group that fails part-way leaving nothing behind |
| `group-invoice` | a group's deposit reaches its invoice: payment events, per-room figures, a batch stamp counted once, a later sitting counted separately, and an overpayment leaving nothing owed |

## Invariants

Asserted per booking row wherever revenue is computed:

- per-method totals equal that row's attributed revenue
- attributed revenue never exceeds what the booking is worth after discount
- no negative figures
- grand revenue equals rooms + charges + standalone sales
- across every staff member and week, one booking is never credited beyond its value

## Live suites (credentials required, read-only)

`analytics-consistency.test.ts` checks that the Analytics page and the staff
revenue reports answer with the same numbers, over the last 12 weeks of real
data: the company total equals the staff totals plus anyone holding revenue
without a row in the staff table, the breakdown rows add up to the total above
them, the payment methods add up to the same figure, and no booking is credited
twice.

```bash
env $(npx netlify env:list --json | python3 -c "import json,sys; d=json.load(sys.stdin); print(' '.join(f'{k}={v}' for k,v in d.items() if k in ('SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY')))") \
  ./tests/run.sh live
```

## Production audit

`tests/audit-production.ts` runs those invariants over the live database — every
booking, 26 weeks, and every identity that holds revenue (which is more than the
staff table contains: people who took money without a staff row still hold it).
Read-only.

```bash
env $(npx netlify env:list --json | python3 -c "import json,sys; d=json.load(sys.stdin); print(' '.join(f'{k}={v}' for k,v in d.items() if k in ('SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY')))") \
  ./tests/run.sh audit
```
