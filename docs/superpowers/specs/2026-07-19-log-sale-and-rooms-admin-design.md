# Design: Log-a-Sale flow, multi-item sales, and Rooms admin-gating

Date: 2026-07-19

## Summary

Three related changes to the staff portal:

1. Move the **Rooms** tab out of the main staff nav into the admin-only section
   (owner/admin only).
2. Remove the **Log a Sale** button from the *My Revenue* page and promote it to
   a first-class sidebar item (visible to all staff).
3. Rework **Log a Sale** into a Guest / Non-guest chooser, add a **Pay Later**
   payment option to the guest charges form, and make **both** sale forms accept
   **multiple line items per transaction** (currently one item per submit).

Guiding constraint: additive, non-breaking. `GuestChargesDialog` is reused by
the check-out flow and must keep its existing behavior.

## Decisions (from brainstorming)

- Guest path targets **active (checked-in) bookings** only, via a searchable
  picker, then opens the existing charges form for that folio.
- **Pay Later** = charge added to the guest folio as **unpaid**; it accrues in
  revenue totals but is **excluded from collected cash/momo/card tallies** until
  settled at check-out.
- Multi-item = **line-item cart, one submit** (shared payment method, N records).

## Current state (as explored)

- `src/components/layout/StaffSidebar.tsx` — `navItems` (all-staff) vs
  `adminItems` (rendered under an "Admin" header, role-filtered). Rooms is
  `{ label:'Rooms', to:'/staff/properties' }` in `navItems`.
- `src/components/layout/MobileBottomNav.tsx:16` — also has a `Rooms` →
  `/staff/properties` entry.
- `src/lib/rbac.ts` — `ROUTE_ACCESS['/staff/properties'] = [owner,admin,manager,staff]`
  and a nav list entry at ~line 105; `/staff/my-revenue` allowed for all.
- `src/pages/staff/MyRevenuePage.tsx` — Log-a-Sale button (~line 583) opens
  `LogSaleDialog` (state at ~453, render at ~804).
- `src/components/dialogs/LogSaleDialog.tsx` — single-item form →
  `standaloneSalesService.addSale(...)`. Payment: cash / mobile_money / card.
- `src/components/dialogs/GuestChargesDialog.tsx` — takes `booking` + `guest`
  props, writes via `bookingChargesService.addCharge(...)`. Already lists
  existing charges and supports add/edit one-at-a-time. Payment union is
  `'cash' | 'mobile_money' | 'card'`. Reused by check-out (`isCheckoutMode`).
- `src/services/booking-charges-service.ts` — `paymentMethod` is a free-text
  `string` stored in a dedicated column (legacy fallback encodes it in notes).
  **No schema change needed for `pay_later`.**
- `src/services/revenue-service.ts:165` — `normalizePaymentMethod` maps
  unrecognized methods to `''`. Charges count in `additionalChargesTotal`
  regardless of method (accrual); only cash/momo/card feed collected-cash
  buckets.

## Design

### 1. Rooms → admin-only

- `StaffSidebar.tsx`: remove Rooms from `navItems`; add it to `adminItems` with
  `minRole: ['owner','admin']`.
- `MobileBottomNav.tsx`: remove the Rooms entry (mobile bottom nav is the
  all-staff quick bar; Rooms is now admin-only). If a role-gated mobile entry is
  trivial, gate it to owner/admin instead of deleting — otherwise delete.
- `rbac.ts`: change `ROUTE_ACCESS['/staff/properties']` to `['owner','admin']`
  and update the nav-list entry (~line 105) `minRole` to `['owner','admin']`.
  Note: this also removes reception's read-only Rooms access — intended per the
  request ("only users with admin right can see it").
- Route `/staff/properties` in `App.tsx` unchanged (guard handled by RBAC).

### 2. Log-a-Sale sidebar item + entry flow

- `MyRevenuePage.tsx`: remove the Log-a-Sale button, its `logSaleOpen` state, and
  the `<LogSaleDialog>` render. (Leave the rest of the page intact.)
- `StaffSidebar.tsx`: add `{ label:'Log a Sale', to:'/staff/log-sale', icon:
  PlusCircle/ShoppingCart }` to `navItems` (all-staff section).
- `rbac.ts`: add `ROUTE_ACCESS['/staff/log-sale'] = ['owner','admin','manager','staff']`
  and a nav-list entry.
- `App.tsx`: add a lazy route `/staff/log-sale` → new `LogSalePage`.
- New `src/pages/staff/LogSalePage.tsx`:
  - Renders a **chooser**: two large buttons/cards — **Guest** and **Non-guest**.
  - **Non-guest** → opens `LogSaleDialog` (multi-item version).
  - **Guest** → renders an **active-booking picker** (searchable list of
    checked-in bookings: room number + guest name); selecting one opens
    `GuestChargesDialog` for that `booking`/`guest` (multi-item + Pay Later).
  - On dialog close/success, returns to the chooser (or shows a success state).

### 3. Multi-item cart

**`LogSaleDialog` (safe to restructure — only used for logging sales):**
- Replace the single `form` with a **cart**: `lines: Array<{ id, inventoryId?,
  description, category, quantity, unitPrice }>` plus shared `paymentMethod` and
  `notes`.
- UI: an "add line" row (inventory select / description / category / qty / unit
  price) that appends to the list; the list shows each line with per-line total
  and a remove button; a grand total; one shared Payment Method select; a
  "Save all" button.
- Submit: loop `standaloneSalesService.addSale(...)` once per line (sequentially,
  so each still decrements inventory as today). Success toast reflects N items.
  Partial-failure handling: collect failures, report how many saved vs failed.

**`GuestChargesDialog` (shared with check-out — additive only):**
- Keep the existing single add-form, charges list, and edit behavior untouched.
- Add an optional **multi-line staging cart**: user adds several lines, then
  "Add all" loops `bookingChargesService.addCharge(...)` per line (preserving
  per-line inventory decrement), then refreshes the charges list.
- The multi-item cart is disabled in `isCheckoutMode` (read-only) — same as the
  existing add-form.

### 4. Pay Later (guest form only)

- `GuestChargesDialog`: widen the `paymentMethod` state type to include
  `'pay_later'` (or `string`); add a `<SelectItem value="pay_later">⏳ Pay Later
  (add to folio)</SelectItem>`. Update the read-only display switch to render a
  "Pay Later" label.
- Persistence: unchanged — `paymentMethod` is free-text string; no migration.
- `revenue-service.ts` `normalizePaymentMethod`: add
  `if (s === 'pay_later' || s === 'pay later') return 'pay_later'` so the method
  is a **recognized, non-collected** category. Verify the collected cash/momo/
  card tallies (chargesByCategory / payment-method breakdowns) treat
  `pay_later` as not-collected (it naturally won't match cash/momo/card).
- Charge still counts in `additionalChargesTotal` (accrued revenue) — correct.
- **Check-out settlement:** verify `CheckOutDialog` computes the outstanding
  balance from unpaid charges so a `pay_later` charge appears as balance due and
  is settled with a real method at check-out. If the balance calc keys off
  payment status rather than method, add `pay_later` to the "unpaid" set. (To be
  confirmed during implementation.)
- `LogSaleDialog` (non-guest) does **not** get Pay Later — a walk-in has no
  folio to defer to. Keeps cash / mobile_money / card.

### 5. Non-breaking guarantees & tests

Verify (implementation):
- RBAC: `/staff/properties` reachable by owner/admin; blocked for manager/staff.
  `/staff/log-sale` reachable by all staff.
- `MobileBottomNav` no longer shows Rooms to non-admins.
- Inventory stock decrements once per saved line (loop preserves current
  single-item decrement path).
- `GuestChargesDialog` check-out usage unchanged (single-add + list still work,
  cart hidden in checkout mode).
- `pay_later` charge: shows on folio, appears in balance due at check-out, is
  NOT counted in collected cash/momo/card.

Manual test matrix:
- Sidebar visibility per role (owner/admin/manager/staff) — Rooms in Admin
  section only; Log a Sale in main section for all.
- Non-guest multi-item: add 3 lines, Save all → 3 `standalone_sales` rows, stock
  decremented, MyRevenue reflects them.
- Guest multi-item: pick checked-in booking, add 3 charges incl. one `pay_later`,
  Add all → 3 `booking_charges` rows; folio + checkout balance correct;
  pay_later excluded from collected cash.
- Guest picker lists only checked-in bookings.

## Risks / considerations

- `GuestChargesDialog` is shared with check-out — cart must be additive and
  hidden in `isCheckoutMode`. Highest regression risk.
- Multi-save is N sequential writes (not a transaction). On partial failure,
  report saved-vs-failed rather than rolling back; acceptable for POS-style entry.
- Removing reception's read-only Rooms access is an intended access change.
- Pay Later touches the financial-reporting layer we recently reviewed — keep it
  a non-collected accrual; don't let it inflate collected-cash figures.

## Out of scope

- No new DB tables/columns (paymentMethod is free-text).
- No change to how deposits/room revenue are computed.
- Non-guest Pay Later (walk-ins) — excluded by design.
