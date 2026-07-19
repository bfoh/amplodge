# Log-a-Sale flow, multi-item sales, and Rooms admin-gating — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Rooms to admin-only, promote Log-a-Sale to a sidebar Guest/Non-guest flow, add Pay Later to guest charges, and make both sale forms accept multiple line items per transaction.

**Architecture:** Frontend-only React/TS changes plus one revenue-service helper tweak. Reuse existing dialogs (`LogSaleDialog`, `GuestChargesDialog`) and services (`standaloneSalesService.addSale`, `bookingChargesService.addCharge`). New `LogSalePage` hosts the chooser + active-booking picker. `pay_later` is a free-text payment method (no DB migration).

**Tech Stack:** React + TypeScript + Vite, React Router, Radix/shadcn UI, Supabase via `db` wrapper, `sonner` toasts, lucide icons.

## Global Constraints

- No DB schema changes. `paymentMethod` / `payment_method` is free-text `string`.
- Additive, non-breaking. `GuestChargesDialog` is reused by check-out (`isCheckoutMode`) — its existing single-add / list / edit flow must keep working; new cart UI is hidden when `isCheckoutMode`.
- No test runner exists. Verification per task = `npm run lint:types` (tsc) and `npm run lint`, plus the manual browser checks stated in the task. Use `npm run dev` to verify UI.
- "Admin" = roles `owner` and `admin` (matches existing `minRole` usage).
- Money is GHS; follow existing `formatCurrency`/`useCurrency` for display.
- Commit after each task. Branch off `main` first (do not commit feature work directly to `main`).

---

### Task 0: Branch

- [ ] **Step 1: Create feature branch**

```bash
cd /Users/ebenezerbarning/Desktop/amp/amplodge
git checkout main && git pull --ff-only 2>/dev/null; git checkout -b feat/log-sale-and-rooms-admin
```

- [ ] **Step 2: Baseline typecheck (must pass before changes)**

Run: `npm run lint:types`
Expected: exits 0 (no TS errors). If it already fails, stop and report — do not build on a broken baseline.

---

### Task 1: Rooms → admin-only

**Files:**
- Modify: `src/components/layout/StaffSidebar.tsx` (navItems ~line 52-63, adminItems ~line 74-90)
- Modify: `src/components/layout/MobileBottomNav.tsx:16`
- Modify: `src/lib/rbac.ts` (`ROUTE_ACCESS['/staff/properties']` ~line 60, nav-list entry ~line 105)

**Interfaces:**
- Produces: Rooms visible only to `owner`/`admin`; `/staff/properties` RBAC restricted to `['owner','admin']`.

- [ ] **Step 1: Remove Rooms from main nav**

In `StaffSidebar.tsx`, delete this line from `navItems`:
```ts
{ label: 'Rooms', to: '/staff/properties', icon: Home, minRole: ['owner', 'admin', 'manager', 'staff'] },
```

- [ ] **Step 2: Add Rooms to adminItems**

In `StaffSidebar.tsx` `adminItems` array, add as the first entry (keep `Home` import):
```ts
{ label: 'Rooms', to: '/staff/properties', icon: Home, minRole: ['owner', 'admin'] },
```

- [ ] **Step 3: Restrict RBAC route access**

In `src/lib/rbac.ts`, change:
```ts
'/staff/properties': ['owner', 'admin', 'manager', 'staff'],
```
to:
```ts
'/staff/properties': ['owner', 'admin'],
```
And the nav-list entry (~line 105) `minRole` from `['owner', 'admin', 'manager', 'staff']` to `['owner', 'admin']`.

- [ ] **Step 4: Remove Rooms from mobile bottom nav**

In `src/components/layout/MobileBottomNav.tsx`, delete line 16:
```ts
{ label: 'Rooms', to: '/staff/properties', icon: Home },
```
(If `Home` becomes an unused import, remove it to keep `lint` clean.)

- [ ] **Step 5: Typecheck + lint**

Run: `npm run lint:types && npm run lint`
Expected: exits 0.

- [ ] **Step 6: Manual verify**

`npm run dev`. Log in as a non-admin (manager/staff) → Rooms absent from main nav and mobile bar. As owner/admin → Rooms appears under the "Admin" header and `/staff/properties` loads. Navigating a manager directly to `/staff/properties` is blocked by RBAC.

- [ ] **Step 7: Commit**

```bash
git add src/components/layout/StaffSidebar.tsx src/components/layout/MobileBottomNav.tsx src/lib/rbac.ts
git commit -m "Gate Rooms to admin-only (sidebar + mobile nav + rbac)"
```

---

### Task 2: Log-a-Sale sidebar item, route, and chooser page

**Files:**
- Create: `src/pages/staff/LogSalePage.tsx`
- Modify: `src/App.tsx` (lazy import + `<Route path="/staff/log-sale">`)
- Modify: `src/lib/rbac.ts` (`ROUTE_ACCESS` + nav-list)
- Modify: `src/components/layout/StaffSidebar.tsx` (add to navItems)
- Modify: `src/pages/staff/MyRevenuePage.tsx` (remove Log-a-Sale button, state, dialog)

**Interfaces:**
- Consumes: existing `LogSaleDialog` (`open`, `onOpenChange`, `staffId`, `staffName`, `onSuccess`) and `GuestChargesDialog` (`open`, `onOpenChange`, `booking`, `guest`, `onChargesUpdated`).
- Consumes: `bookingEngine.getAllBookings()` → `LocalBooking[]` with `status`, `roomNumber`, `guest`, `remoteId`.
- Produces: route `/staff/log-sale` rendering the chooser.

- [ ] **Step 1: Add RBAC entry**

In `src/lib/rbac.ts`, add to `ROUTE_ACCESS`:
```ts
'/staff/log-sale': ['owner', 'admin', 'manager', 'staff'],
```
And add a nav-list entry near the others:
```ts
{ path: '/staff/log-sale', label: 'Log a Sale', minRole: ['owner', 'admin', 'manager', 'staff'] },
```

- [ ] **Step 2: Add sidebar item**

In `StaffSidebar.tsx`, import `ShoppingCart` from lucide and add to `navItems` (after 'My Revenue'):
```ts
{ label: 'Log a Sale', to: '/staff/log-sale', icon: ShoppingCart, minRole: ['owner', 'admin', 'manager', 'staff'] },
```

- [ ] **Step 3: Create LogSalePage with chooser**

Create `src/pages/staff/LogSalePage.tsx`. It shows two mode cards (Guest / Non-guest). Non-guest opens `LogSaleDialog`. Guest shows a searchable list of **checked-in** bookings; selecting one opens `GuestChargesDialog`.

```tsx
import { useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { User, UserX, Search, ShoppingCart } from 'lucide-react'
import { LogSaleDialog } from '@/components/dialogs/LogSaleDialog'
import { GuestChargesDialog } from '@/components/dialogs/GuestChargesDialog'
import { bookingEngine } from '@/services/booking-engine'
import { auth } from '@/lib/db'

type Mode = 'choose' | 'guest' | 'nonguest'

export function LogSalePage() {
  const [mode, setMode] = useState<Mode>('choose')
  const [staff, setStaff] = useState<{ id: string; name: string }>({ id: '', name: '' })
  const [bookings, setBookings] = useState<any[]>([])
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<any | null>(null)
  const [logSaleOpen, setLogSaleOpen] = useState(false)

  useEffect(() => {
    auth.me().then(u => setStaff({ id: u?.id || '', name: u?.name || u?.email || 'Staff' })).catch(() => {})
  }, [])

  useEffect(() => {
    if (mode !== 'guest') return
    bookingEngine.getAllBookings()
      .then(all => setBookings(all.filter((b: any) => b.status === 'checked-in')))
      .catch(() => setBookings([]))
  }, [mode])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return bookings
    return bookings.filter((b: any) =>
      String(b.roomNumber || '').toLowerCase().includes(q) ||
      String(b.guest?.fullName || '').toLowerCase().includes(q))
  }, [bookings, query])

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-2">
        <ShoppingCart className="w-6 h-6 text-primary" />
        <h1 className="text-2xl font-bold">Log a Sale</h1>
      </div>

      {mode === 'choose' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Card className="cursor-pointer hover:border-primary transition" onClick={() => setMode('guest')}>
            <CardHeader><CardTitle className="flex items-center gap-2"><User className="w-5 h-5" /> Sell to a Guest</CardTitle></CardHeader>
            <CardContent className="text-sm text-muted-foreground">Charge an in-house guest's folio. Can Pay Later (settled at check-out).</CardContent>
          </Card>
          <Card className="cursor-pointer hover:border-primary transition" onClick={() => { setMode('nonguest'); setLogSaleOpen(true) }}>
            <CardHeader><CardTitle className="flex items-center gap-2"><UserX className="w-5 h-5" /> Sell to Non-guest</CardTitle></CardHeader>
            <CardContent className="text-sm text-muted-foreground">Walk-in / counter sale. Paid now (cash, mobile money, card).</CardContent>
          </Card>
        </div>
      )}

      {mode === 'guest' && (
        <Card>
          <CardHeader><CardTitle>Select an in-house guest</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-9" placeholder="Search room or name..." value={query} onChange={e => setQuery(e.target.value)} />
            </div>
            <div className="max-h-80 overflow-y-auto divide-y">
              {filtered.length === 0 && <p className="text-sm text-muted-foreground py-4 text-center">No checked-in guests.</p>}
              {filtered.map((b: any) => (
                <button key={b.remoteId || b._id} className="w-full text-left py-3 px-2 hover:bg-muted rounded flex justify-between"
                  onClick={() => setSelected(b)}>
                  <span className="font-medium">Room {b.roomNumber || '—'}</span>
                  <span className="text-muted-foreground">{b.guest?.fullName || 'Guest'}</span>
                </button>
              ))}
            </div>
            <Button variant="ghost" onClick={() => setMode('choose')}>← Back</Button>
          </CardContent>
        </Card>
      )}

      <LogSaleDialog
        open={logSaleOpen}
        onOpenChange={(o) => { setLogSaleOpen(o); if (!o) setMode('choose') }}
        staffId={staff.id}
        staffName={staff.name}
      />

      {selected && (
        <GuestChargesDialog
          open={!!selected}
          onOpenChange={(o) => { if (!o) setSelected(null) }}
          booking={selected}
          guest={selected.guest}
          onChargesUpdated={() => {}}
        />
      )}
    </div>
  )
}
```

> Note: confirm `LogSaleDialog`'s prop names (`staffId`, `staffName`, `onSuccess`) and `GuestChargesDialog`'s (`booking`, `guest`, `onChargesUpdated`) against the current files while implementing; adjust the shape passed to `GuestChargesDialog` (`booking`/`guest`) to match what those components read (room number, booking id, guest name/id).

- [ ] **Step 4: Register the route**

In `src/App.tsx`, add a lazy import next to the other staff pages:
```ts
const LogSalePage = lazyWithRetry(() => import('./pages/staff/LogSalePage').then(m => ({ default: m.LogSalePage })))
```
And add the route inside the staff routes block (sibling of `/staff/my-revenue`):
```tsx
<Route path="/staff/log-sale" element={<LogSalePage />} />
```

- [ ] **Step 5: Remove Log-a-Sale from MyRevenuePage**

In `src/pages/staff/MyRevenuePage.tsx`:
- Delete the button (~line 583-585) that renders `<Plus /> Log a Sale`.
- Delete `const [logSaleOpen, setLogSaleOpen] = useState(false)` (~line 453).
- Delete the `<LogSaleDialog ... />` render (~line 804-807) and its import (line 37) if now unused.

Run `npm run lint` afterward to catch any now-unused imports/vars.

- [ ] **Step 6: Typecheck + lint**

Run: `npm run lint:types && npm run lint`
Expected: exits 0.

- [ ] **Step 7: Manual verify**

`npm run dev`. Sidebar shows "Log a Sale" for all roles. MyRevenue no longer shows the button. Clicking Log a Sale → chooser. Non-guest → LogSaleDialog opens. Guest → lists only checked-in bookings; selecting opens GuestChargesDialog for that folio.

- [ ] **Step 8: Commit**

```bash
git add src/pages/staff/LogSalePage.tsx src/App.tsx src/lib/rbac.ts src/components/layout/StaffSidebar.tsx src/pages/staff/MyRevenuePage.tsx
git commit -m "Add Log-a-Sale sidebar item + Guest/Non-guest chooser page; remove button from My Revenue"
```

---

### Task 3: LogSaleDialog → multi-item cart

**Files:**
- Modify: `src/components/dialogs/LogSaleDialog.tsx`

**Interfaces:**
- Consumes: `standaloneSalesService.addSale(data: Omit<StandaloneSale,'id'|'createdAt'>)` (writes one sale, decrements inventory per call).
- Produces: dialog that saves N sales in one "Save all".

- [ ] **Step 1: Introduce a line-item cart state**

Replace the single `form` item fields with a `lines` array plus shared `paymentMethod`/`notes`. Keep an in-progress "draft line" for the add row.

```ts
type SaleLine = {
  id: string
  inventoryId?: string
  description: string
  category: StandaloneSale['category']
  quantity: number
  unitPrice: string
}
const newLine = (): SaleLine => ({ id: `l_${Date.now()}_${Math.random().toString(36).slice(2,6)}`, description: '', category: 'food_beverage', quantity: 1, unitPrice: '' })

const [lines, setLines] = useState<SaleLine[]>([])
const [draft, setDraft] = useState<SaleLine>(newLine())
const [paymentMethod, setPaymentMethod] = useState<StandaloneSale['paymentMethod']>('cash')
const [notes, setNotes] = useState('')

const lineTotal = (l: SaleLine) => l.quantity * (parseFloat(l.unitPrice) || 0)
const grandTotal = lines.reduce((s, l) => s + lineTotal(l), 0)
```

- [ ] **Step 2: Add-line + remove-line handlers**

```ts
const addLine = () => {
  if (!draft.description.trim()) { toast.error('Description is required'); return }
  if (!draft.unitPrice || parseFloat(draft.unitPrice) <= 0) { toast.error('Unit price must be greater than 0'); return }
  if (draft.quantity < 1) { toast.error('Quantity must be at least 1'); return }
  setLines(prev => [...prev, draft])
  setDraft(newLine())
}
const removeLine = (id: string) => setLines(prev => prev.filter(l => l.id !== id))
```
Keep the inventory-select behavior for the draft line (populate `draft.description`/`unitPrice`/`inventoryId` from the chosen inventory item, mirroring the existing `handleInventoryChange`).

- [ ] **Step 3: Save-all loop**

```ts
const handleSubmit = async () => {
  const toSave = draft.description.trim() ? [...lines, draft] : lines
  if (toSave.length === 0) { toast.error('Add at least one item'); return }
  setSaving(true)
  let ok = 0, fail = 0
  for (const l of toSave) {
    try {
      await standaloneSalesService.addSale({
        description: l.description.trim(),
        category: l.category,
        quantity: l.quantity,
        unitPrice: parseFloat(l.unitPrice),
        amount: lineTotal(l),
        notes: notes.trim(),
        staffId, staffName,
        saleDate: format(new Date(), 'yyyy-MM-dd'),
        paymentMethod,
        inventoryId: l.inventoryId,
      })
      ok++
    } catch (e) { fail++; console.error('[LogSaleDialog] line failed', e) }
  }
  setSaving(false)
  if (ok) toast.success(`Logged ${ok} item${ok > 1 ? 's' : ''}${fail ? ` (${fail} failed)` : ''}`)
  if (!ok) { toast.error('Failed to log sale'); return }
  reset(); onOpenChange(false); onSuccess?.()
}
```

- [ ] **Step 4: Update JSX**

Render: the draft add-row (inventory select / description / category / qty / unit price + an "Add item" button calling `addLine`), a list of added `lines` (each showing description, qty × unit = line total, and a remove button), a shared Payment Method select, an optional Notes field, a grand total, and a "Save all" button calling `handleSubmit` (disabled while `saving` or when `lines.length === 0 && !draft.description`). Follow the existing dialog's styling/components.

Update `reset()` to clear `lines`, `draft`, `paymentMethod`, `notes`.

- [ ] **Step 5: Typecheck + lint**

Run: `npm run lint:types && npm run lint`
Expected: exits 0.

- [ ] **Step 6: Manual verify**

`npm run dev` → Log a Sale → Non-guest. Add 3 lines, Save all → toast "Logged 3 items"; 3 rows appear in My Revenue; inventory-linked lines decrement stock.

- [ ] **Step 7: Commit**

```bash
git add src/components/dialogs/LogSaleDialog.tsx
git commit -m "LogSaleDialog: multi-item cart (save N sales in one submit)"
```

---

### Task 4: GuestChargesDialog → Pay Later option

**Files:**
- Modify: `src/components/dialogs/GuestChargesDialog.tsx`
- Modify: `src/services/revenue-service.ts` (`normalizePaymentMethod`)

**Interfaces:**
- Produces: `pay_later` selectable on guest charges; recognized as a non-collected method in revenue.

- [ ] **Step 1: Widen the payment-method type + add option**

In `GuestChargesDialog.tsx`, change the state type (line ~57) and the setter cast (lines ~188, ~344) from `'cash' | 'mobile_money' | 'card'` to include `'pay_later'`:
```ts
const [paymentMethod, setPaymentMethod] = useState<'cash' | 'mobile_money' | 'card' | 'pay_later'>('cash')
```
Add the option in the Select (after mobile_money/card, ~line 350):
```tsx
<SelectItem value="pay_later">⏳ Pay Later (add to folio)</SelectItem>
```
Update the read-only display switch (~line 423-424) to include:
```tsx
: charge.paymentMethod === 'pay_later' ? '⏳ Pay Later'
```

- [ ] **Step 2: Recognize pay_later in revenue normalization**

In `src/services/revenue-service.ts` `normalizePaymentMethod` (~line 165), add before the final `return ''`:
```ts
if (s === 'pay_later' || s === 'pay later') return 'pay_later'
```
This makes `pay_later` a recognized, non-collected category — it never matches the cash/mobile_money/card buckets, so collected-cash tallies exclude it, while the charge still counts in `additionalChargesTotal` (accrued).

- [ ] **Step 3: Verify check-out balance treats pay_later as unpaid**

Read `src/components/dialogs/CheckOutDialog.tsx` balance logic. If the outstanding-balance calculation sums charges by amount (method-agnostic), no change needed — a `pay_later` charge already contributes to balance due. If it filters "paid" charges by method and would treat `pay_later` as paid, add `pay_later` to the unpaid set so it shows as balance due. Document which case applied in the commit message.

- [ ] **Step 4: Typecheck + lint**

Run: `npm run lint:types && npm run lint`
Expected: exits 0.

- [ ] **Step 5: Manual verify**

`npm run dev` → Log a Sale → Guest → pick a checked-in booking → add a charge with Pay Later. Charge appears on folio. Open that booking's check-out → the pay_later amount is part of balance due. In My Revenue / analytics, the amount is NOT in collected cash/momo/card but IS in the revenue total.

- [ ] **Step 6: Commit**

```bash
git add src/components/dialogs/GuestChargesDialog.tsx src/services/revenue-service.ts
git commit -m "Add Pay Later payment method to guest charges (unpaid folio; non-collected in reports)"
```

---

### Task 5: GuestChargesDialog → multi-item cart (additive)

**Files:**
- Modify: `src/components/dialogs/GuestChargesDialog.tsx`

**Interfaces:**
- Consumes: `bookingChargesService.addCharge(data: CreateChargeData)` (one charge per call, decrements inventory).
- Produces: an optional staging cart that adds N charges in one action, without disturbing the existing single-add/list/edit flow.

- [ ] **Step 1: Add a staging-cart state (separate from existing single form)**

Do NOT remove the existing `handleAddCharge` single flow. Add alongside it:
```ts
type DraftCharge = { id: string; inventoryId?: string; description: string; category: ChargeCategory; quantity: number; unitPrice: number }
const [cart, setCart] = useState<DraftCharge[]>([])
const cartTotal = cart.reduce((s, c) => s + c.quantity * c.unitPrice, 0)
```

- [ ] **Step 2: Add-to-cart and save-all handlers**

```ts
const addToCart = () => {
  if (!description.trim()) { toast.error('Description is required'); return }
  if (unitPrice <= 0) { toast.error('Unit price must be greater than 0'); return }
  setCart(prev => [...prev, { id: `c_${Date.now()}_${Math.random().toString(36).slice(2,6)}`, inventoryId: inventoryId || undefined, description: description.trim(), category, quantity, unitPrice }])
  // reset the draft inputs (reuse the existing reset used after single add)
  setDescription(''); setQuantity(1); setUnitPrice(0); setInventoryId('')
}

const saveCart = async () => {
  if (cart.length === 0) { toast.error('Add at least one item'); return }
  setSubmitting(true)
  let ok = 0, fail = 0
  for (const c of cart) {
    try {
      await bookingChargesService.addCharge({
        bookingId: booking.id ?? booking.remoteId ?? booking._id,
        description: c.description, category: c.category,
        quantity: c.quantity, unitPrice: c.unitPrice,
        notes: notes.trim() || undefined, paymentMethod,
        inventoryId: c.inventoryId,
      })
      ok++
    } catch (e) { fail++; console.error('[GuestChargesDialog] cart line failed', e) }
  }
  setSubmitting(false)
  setCart([])
  await fetchCharges()
  onChargesUpdated?.()
  if (ok) toast.success(`Added ${ok} item${ok > 1 ? 's' : ''}${fail ? ` (${fail} failed)` : ''}`)
  else toast.error('Failed to add charges')
}
```
> Confirm the exact `bookingId` field on the booking object passed from `LogSalePage` and existing callers; use whichever id `addCharge` expects (matches the single-add path already in the file).

- [ ] **Step 3: Add cart UI, hidden in checkout mode**

Within the add-form area (which is already hidden when `isCheckoutMode`), add: an "Add to list" button (calls `addToCart`), a rendered `cart` list (each line + remove button), a cart subtotal, and a "Save all (N)" button (calls `saveCart`). Keep the existing single "Add charge" button working. Wrap the whole cart block in `{!isCheckoutMode && (...)}`.

- [ ] **Step 4: Typecheck + lint**

Run: `npm run lint:types && npm run lint`
Expected: exits 0.

- [ ] **Step 5: Manual verify**

`npm run dev`:
- Guest sale: add 3 items to the cart (one Pay Later), Save all → 3 charges on folio, stock decremented, toast "Added 3 items".
- Existing check-out flow: open a booking's check-out (isCheckoutMode) → charges are read-only, cart UI hidden, no regression.
- Single "Add charge" still works from the normal entry point.

- [ ] **Step 6: Commit**

```bash
git add src/components/dialogs/GuestChargesDialog.tsx
git commit -m "GuestChargesDialog: additive multi-item cart (save N charges); preserves single-add + checkout"
```

---

### Task 6: Full regression pass + build

**Files:** none (verification only)

- [ ] **Step 1: Typecheck, lint, build**

Run: `npm run lint && npm run build`
Expected: both exit 0. Fix any type/lint/build error introduced.

- [ ] **Step 2: Role + flow matrix (manual, `npm run dev` or preview)**

- [ ] Owner/admin: Rooms under Admin section; `/staff/properties` loads.
- [ ] Manager/staff: no Rooms in sidebar or mobile bar; direct nav to `/staff/properties` blocked.
- [ ] All roles: Log a Sale in sidebar; MyRevenue button gone.
- [ ] Non-guest multi-item: 3 lines → 3 `standalone_sales`, stock down, MyRevenue updated.
- [ ] Guest multi-item + Pay Later: pick checked-in booking → 3 charges (incl. pay_later) → folio + checkout balance correct; pay_later not in collected cash.
- [ ] Check-out unaffected (charges read-only, cart hidden).

- [ ] **Step 3: Commit any fixes, then finish the branch**

Use the `superpowers:finishing-a-development-branch` skill to merge to `main` / open a PR per the usual flow, then (per this project) push so Netlify auto-builds.

---

## Notes for the implementer

- `bookingEngine.getAllBookings()` returns `LocalBooking[]`; `status === 'checked-in'` = in-house. Fields: `roomNumber`, `guest.fullName`, `remoteId`/`_id`, `id`.
- `standaloneSalesService.addSale` and `bookingChargesService.addCharge` each already decrement linked inventory — looping them per line preserves that; do not add separate stock logic.
- `pay_later` needs no migration; `payment_method` is a free-text column.
- Keep every change additive around `GuestChargesDialog`'s checkout reuse — that is the top regression risk.
