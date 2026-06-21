# 80mm Thermal Receipt Auto-Print Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-print a finalized 80mm thermal receipt to the front-desk USB printer when a guest checkout completes, without touching the existing A4 invoice (email/PDF).

**Architecture:** Add two functions to `invoice-service.ts` — a 72mm-wide HTML receipt template (`generateReceipt80mmHTML`) and a print launcher (`printReceipt80mm`) cloned from the existing `printInvoice` pattern. Add one shared best-effort helper (`finalizeCheckoutReceipt`) and call it from all four `handleCheckOut` sites after checkout succeeds. A preview route renders the template with mock data for verification.

**Tech Stack:** React 18 + TypeScript + Vite, react-router-dom, sonner (toasts), Supabase. No unit-test framework is installed — verification is `npm run lint:types` (tsc) plus a manual browser preview route.

## Global Constraints

- Currency: **GHS**, formatted via `formatCurrencySync(amount, currency)` from `@/lib/utils`.
- Tax model: Ghana — Sales Total, GF/NHIL 5%, VAT 15%, Tourism Levy 1%. Values are already on `invoiceData.charges` (`salesTotal`, `gfNhil`, `taxSubTotal`, `vat`, `tourismLevy`, `total`). Do NOT recompute.
- Hotel TIN string is `71786161-3` (matches existing A4 template).
- Logo URL: `` `${window.location.origin}/amp.png` `` with `onerror="this.style.display='none'"`.
- Receipt width: **72mm** printable. CSS `@page { size: 72mm auto; margin: 0 }`, body width 72mm. Single column. No bordered tables — use full-width dashed dividers.
- A4 invoice path (`generateInvoiceHTML`, `printInvoice`, email, PDF) MUST remain unchanged.
- Print is **best-effort, post-checkout**: never block or revert a checkout if printing fails.
- No test framework exists. Do NOT add one (YAGNI). Verify with `npm run lint:types` and the preview route.
- Toast import in components: `import { toast } from 'sonner'`.

---

### Task 1: 80mm receipt HTML template

**Files:**
- Modify: `src/services/invoice-service.ts` (add new exported function after `generateInvoiceHTML`, around line 392)

**Interfaces:**
- Consumes: existing `InvoiceData` interface (already defined in this file, line 7); `formatCurrencySync` (already imported line 5); `hotelSettingsService` (already imported line 1).
- Produces: `export async function generateReceipt80mmHTML(invoiceData: InvoiceData): Promise<string>` — returns a complete `<!DOCTYPE html>` string sized for a 72mm roll.

- [ ] **Step 1: Add the function**

Insert this complete function immediately after the closing brace of `generateInvoiceHTML` (after line 392) in `src/services/invoice-service.ts`:

```typescript
/**
 * Generate an 80mm thermal-printer receipt (72mm printable width).
 * Used ONLY for the printed paper copy. Email/PDF keep the A4 template.
 */
export async function generateReceipt80mmHTML(invoiceData: InvoiceData): Promise<string> {
  const settings = await hotelSettingsService.getHotelSettings()
  const currency = settings.currency || 'GHS'
  const logoUrl = `${window.location.origin}/amp.png`
  const fmt = (n: number) => formatCurrencySync(n, currency)
  const d = (s: string) =>
    new Date(s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })

  const roomLineTotal = invoiceData.charges.roomRate * invoiceData.charges.nights
  const addRows = invoiceData.charges.additionalCharges
    .map(ch => `<tr><td>${ch.description}${ch.quantity > 1 ? ` x${ch.quantity}` : ''}</td><td class="r">${fmt(ch.amount)}</td></tr>`)
    .join('')
  const discRow = invoiceData.charges.discountTotal > 0
    ? `<tr class="disc"><td>Discount</td><td class="r">-${fmt(invoiceData.charges.discountTotal)}</td></tr>`
    : ''

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Receipt ${invoiceData.invoiceNumber}</title>
<style>
@page{size:72mm auto;margin:0}
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:72mm}
body{font-family:'Segoe UI',-apple-system,Arial,sans-serif;font-size:11px;line-height:1.35;color:#000;background:#fff}
.r{width:72mm;padding:4mm 3mm 6mm}
.ctr{text-align:center}
.logo{height:40px;width:auto;max-width:60mm;object-fit:contain;margin-bottom:3px}
.hn{font-size:15px;font-weight:800;letter-spacing:.3px}
.hsub{font-size:9px;color:#000;line-height:1.4;margin-top:2px}
.div{border-top:1px dashed #000;margin:6px 0}
.meta{font-size:10px}
.meta p{margin:1.5px 0}
table{width:100%;border-collapse:collapse;font-size:10.5px}
td{padding:2px 0;vertical-align:top}
td.r{text-align:right;white-space:nowrap;padding-left:6px}
.sec-lbl{font-size:8.5px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin:2px 0}
.tot td{font-size:13px;font-weight:800;padding-top:4px}
.disc td{font-weight:600}
.paid{text-align:center;font-size:13px;font-weight:800;letter-spacing:2px;margin:6px 0}
.ty{text-align:center;font-size:10px;font-weight:700;margin-top:2px}
.fsub{text-align:center;font-size:9px;color:#000;margin-top:2px}
@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style>
</head>
<body>
<div class="r">
  <div class="ctr">
    <img class="logo" src="${logoUrl}" alt="" onerror="this.style.display='none'"/>
    <div class="hn">${invoiceData.hotel.name}</div>
    <div class="hsub">${invoiceData.hotel.address}<br>Tel: ${invoiceData.hotel.phone}<br>TIN: 71786161-3</div>
  </div>
  <div class="div"></div>
  <div class="meta">
    <p><strong>RECEIPT</strong> &nbsp; ${invoiceData.invoiceNumber}</p>
    <p>Date: ${d(invoiceData.invoiceDate)}</p>
    <p>Guest: ${invoiceData.guest.name}</p>
    <p>Room: ${invoiceData.booking.roomNumber} (${invoiceData.booking.roomType})</p>
    <p>In ${d(invoiceData.booking.checkIn)} &rarr; Out ${d(invoiceData.booking.checkOut)}</p>
    <p>${invoiceData.booking.nights} night${invoiceData.booking.nights !== 1 ? 's' : ''} &middot; ${invoiceData.booking.numGuests} guest${invoiceData.booking.numGuests !== 1 ? 's' : ''}</p>
  </div>
  <div class="div"></div>
  <table>
    <tr><td>Room ${invoiceData.booking.roomNumber} x${invoiceData.charges.nights} @ ${fmt(invoiceData.charges.roomRate)}</td><td class="r">${fmt(roomLineTotal)}</td></tr>
    ${addRows}
    ${discRow}
  </table>
  <div class="div"></div>
  <div class="sec-lbl">Tax Breakdown</div>
  <table>
    <tr><td>Sales Total</td><td class="r">${fmt(invoiceData.charges.salesTotal)}</td></tr>
    <tr><td>GF/NHIL (5%)</td><td class="r">${fmt(invoiceData.charges.gfNhil)}</td></tr>
    <tr><td>VAT (15%)</td><td class="r">${fmt(invoiceData.charges.vat)}</td></tr>
    <tr><td>Tourism Levy (1%)</td><td class="r">${fmt(invoiceData.charges.tourismLevy)}</td></tr>
    <tr class="tot"><td>TOTAL</td><td class="r">${fmt(invoiceData.charges.total)}</td></tr>
  </table>
  <div class="paid">*** PAID ***</div>
  <div class="div"></div>
  <div class="ty">Thank you for choosing ${invoiceData.hotel.name}!</div>
  <div class="fsub">${invoiceData.hotel.website || invoiceData.hotel.email}</div>
</div>
</body>
</html>`
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run lint:types`
Expected: PASS (no TypeScript errors). If `tsc` reports an unused-variable or type error in the new function, fix it before continuing.

- [ ] **Step 3: Commit**

```bash
git add src/services/invoice-service.ts
git commit -m "feat: add 80mm thermal receipt HTML template"
```

---

### Task 2: Print launcher for the 80mm receipt

**Files:**
- Modify: `src/services/invoice-service.ts` (add after `generateReceipt80mmHTML` from Task 1)

**Interfaces:**
- Consumes: `generateReceipt80mmHTML(invoiceData)` (Task 1).
- Produces: `export async function printReceipt80mm(invoiceData: InvoiceData): Promise<void>` — opens a print window and triggers `print()`. Throws `Error('Could not open print window. Please allow pop-ups.')` if the popup is blocked.

- [ ] **Step 1: Add the function**

Insert immediately after the `generateReceipt80mmHTML` function added in Task 1:

```typescript
/**
 * Open a print window with the 80mm receipt and trigger printing.
 * Mirrors printInvoice() but uses the thermal template. Throws if popup blocked.
 */
export async function printReceipt80mm(invoiceData: InvoiceData): Promise<void> {
  const htmlContent = await generateReceipt80mmHTML(invoiceData)
  const printWindow = window.open('', '_blank')
  if (!printWindow) {
    throw new Error('Could not open print window. Please allow pop-ups.')
  }
  printWindow.document.write(htmlContent)
  printWindow.document.close()
  // Small delay so styles render before the print dialog opens.
  setTimeout(() => printWindow.print(), 300)
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run lint:types`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/services/invoice-service.ts
git commit -m "feat: add printReceipt80mm launcher"
```

---

### Task 3: Preview route for visual verification

**Files:**
- Create: `src/pages/ReceiptPreviewPage.tsx`
- Modify: `src/App.tsx` (add lazy import near line 45; add route near line 240)

**Interfaces:**
- Consumes: `generateReceipt80mmHTML` (Task 1).
- Produces: route `/receipt-preview` rendering the 72mm receipt from a hardcoded mock `InvoiceData` inside an `<iframe>`, so layout can be checked without a real booking or printer.

- [ ] **Step 1: Create the preview page**

Create `src/pages/ReceiptPreviewPage.tsx` with this complete content:

```tsx
import { useEffect, useState } from 'react'
import { generateReceipt80mmHTML } from '@/services/invoice-service'

// Mock data shaped to the InvoiceData interface for visual preview only.
const mockInvoiceData: any = {
  invoiceNumber: 'INV-PREVIEW-AB12CD',
  invoiceDate: new Date().toISOString(),
  dueDate: new Date().toISOString(),
  guest: { name: 'John Doe', email: 'john@example.com', phone: '024 000 0000' },
  booking: {
    id: 'preview',
    roomNumber: '204',
    roomType: 'Standard Room',
    checkIn: new Date(Date.now() - 2 * 86400000).toISOString(),
    checkOut: new Date().toISOString(),
    nights: 2,
    numGuests: 2,
  },
  charges: {
    roomRate: 150,
    nights: 2,
    subtotal: 300,
    additionalCharges: [{ description: 'Laundry', quantity: 1, unitPrice: 40, amount: 40 }],
    additionalChargesTotal: 40,
    discount: undefined,
    discountTotal: 0,
    salesTotal: 295.16,
    gfNhil: 14.76,
    taxSubTotal: 309.92,
    vat: 45.08,
    tourismLevy: 2.95,
    total: 340,
  },
  hotel: {
    name: 'AMP LODGE',
    address: 'Accra, Ghana',
    phone: '030 000 0000',
    email: 'info@amplodge.com',
    website: 'www.amplodge.com',
  },
}

export function ReceiptPreviewPage() {
  const [html, setHtml] = useState('')

  useEffect(() => {
    generateReceipt80mmHTML(mockInvoiceData).then(setHtml)
  }, [])

  return (
    <div style={{ padding: 20, background: '#eee', minHeight: '100vh' }}>
      <h2 style={{ marginBottom: 12 }}>80mm Receipt Preview (72mm content)</h2>
      <iframe
        title="receipt-preview"
        srcDoc={html}
        style={{ width: '80mm', height: '600px', border: '1px solid #999', background: '#fff' }}
      />
    </div>
  )
}
```

- [ ] **Step 2: Register the lazy import in App.tsx**

In `src/App.tsx`, add this line next to the other lazy page imports (near line 45, after the `InvoicePage` import):

```tsx
const ReceiptPreviewPage = lazyWithRetry(() => import('./pages/ReceiptPreviewPage').then(m => ({ default: m.ReceiptPreviewPage })))
```

- [ ] **Step 3: Register the route in App.tsx**

In `src/App.tsx`, add this route immediately after the `/invoice-debug` route (line 240):

```tsx
              {/* 80mm receipt preview (dev verification) */}
              <Route path="/receipt-preview" element={<ReceiptPreviewPage />} />
```

- [ ] **Step 4: Verify it compiles**

Run: `npm run lint:types`
Expected: PASS.

- [ ] **Step 5: Manual visual check**

Run: `npm run dev`
Open: `http://localhost:5173/receipt-preview`
Expected: a narrow receipt inside the iframe showing AMP LODGE header, RECEIPT + invoice number, guest John Doe, Room 204, a Room line (`Room 204 x2 @ GHS150.00` → `GHS300.00`), a Laundry line, the tax breakdown, bold `TOTAL GHS340.00`, and `*** PAID ***`. Content fits the 72mm width with no horizontal overflow.

- [ ] **Step 6: Commit**

```bash
git add src/pages/ReceiptPreviewPage.tsx src/App.tsx
git commit -m "feat: add 80mm receipt preview route"
```

---

### Task 4: Shared best-effort checkout-receipt helper

**Files:**
- Create: `src/services/checkout-receipt.ts`

**Interfaces:**
- Consumes: `printReceipt80mm` (Task 2); `toast` from `sonner`; `InvoiceData` is not exported from `invoice-service.ts`, so the helper accepts the value it is given without importing the type — type it as the return of `createInvoiceData` via `Awaited<ReturnType<...>>`.
- Produces: `export async function finalizeCheckoutReceipt(invoiceData: Awaited<ReturnType<typeof import('./invoice-service').createInvoiceData>>): Promise<void>` — fire-and-forget print; toasts on failure; never throws.

- [ ] **Step 1: Create the helper**

Create `src/services/checkout-receipt.ts` with this complete content:

```typescript
import { toast } from 'sonner'
import { printReceipt80mm, createInvoiceData } from './invoice-service'

type InvoiceData = Awaited<ReturnType<typeof createInvoiceData>>

/**
 * Print the 80mm thermal receipt after a checkout has already succeeded.
 * Best-effort: any failure is surfaced as a toast and swallowed so it can
 * never block or revert the checkout.
 */
export async function finalizeCheckoutReceipt(invoiceData: InvoiceData | null | undefined): Promise<void> {
  if (!invoiceData) return
  try {
    await printReceipt80mm(invoiceData)
    toast.success('Receipt sent to printer')
  } catch (err: any) {
    console.error('❌ [CheckoutReceipt] Failed to print receipt:', err)
    toast.warning(err?.message || 'Could not print receipt. Check the printer / allow pop-ups.')
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run lint:types`
Expected: PASS. (Confirms `printReceipt80mm` and `createInvoiceData` are exported from `invoice-service.ts` and the `Awaited<ReturnType<...>>` type resolves.)

- [ ] **Step 3: Commit**

```bash
git add src/services/checkout-receipt.ts
git commit -m "feat: add finalizeCheckoutReceipt best-effort print helper"
```

---

### Task 5: Wire the helper into all four checkout sites

**Files:**
- Modify: `src/components/CalendarGridView.tsx` (import + after line 177)
- Modify: `src/components/CalendarListView.tsx` (import + after line 150)
- Modify: `src/components/CalendarTimeline.tsx` (import + after line 376)
- Modify: `src/pages/staff/ReservationsPage.tsx` (import + after line 714)

**Interfaces:**
- Consumes: `finalizeCheckoutReceipt` (Task 4).
- Produces: nothing new — each `handleCheckOut` now fires the receipt print after `invoiceData` is created.

Each site already has `const invoiceData = await createInvoiceData(...)` inside `handleCheckOut`. Add the import once per file, then call the helper right after that line.

- [ ] **Step 1: CalendarGridView — add import**

In `src/components/CalendarGridView.tsx`, add after the existing invoice-service import (line 6):

```tsx
import { finalizeCheckoutReceipt } from '@/services/checkout-receipt'
```

- [ ] **Step 2: CalendarGridView — call helper**

In `src/components/CalendarGridView.tsx`, immediately after line 177 (`const invoiceData = await createInvoiceData(bookingWithDetails, getRoomForBooking(booking))`), add:

```tsx
        // Best-effort 80mm thermal receipt (never blocks checkout)
        void finalizeCheckoutReceipt(invoiceData)
```

- [ ] **Step 3: CalendarListView — add import**

In `src/components/CalendarListView.tsx`, add after the existing invoice-service import (line 6):

```tsx
import { finalizeCheckoutReceipt } from '@/services/checkout-receipt'
```

- [ ] **Step 4: CalendarListView — call helper**

In `src/components/CalendarListView.tsx`, immediately after line 150 (`const invoiceData = await createInvoiceData(bookingWithDetails, getRoomForBooking(booking))`), add:

```tsx
        // Best-effort 80mm thermal receipt (never blocks checkout)
        void finalizeCheckoutReceipt(invoiceData)
```

- [ ] **Step 5: CalendarTimeline — add import**

In `src/components/CalendarTimeline.tsx`, add after the existing invoice-service import (line 5):

```tsx
import { finalizeCheckoutReceipt } from '@/services/checkout-receipt'
```

- [ ] **Step 6: CalendarTimeline — call helper**

In `src/components/CalendarTimeline.tsx`, immediately after line 376 (`const invoiceData = await createInvoiceData(bookingWithDetails, room)`), add:

```tsx
        // Best-effort 80mm thermal receipt (never blocks checkout)
        void finalizeCheckoutReceipt(invoiceData)
```

- [ ] **Step 7: ReservationsPage — add import**

In `src/pages/staff/ReservationsPage.tsx`, add a new import line after the existing invoice-service import (line 19):

```tsx
import { finalizeCheckoutReceipt } from '@/services/checkout-receipt'
```

- [ ] **Step 8: ReservationsPage — call helper**

In `src/pages/staff/ReservationsPage.tsx`, immediately after line 714 (`const invoiceData = await createInvoiceData(bookingWithDetails, room)` — the one inside `handleCheckOut`, NOT the one at line 494), add:

```tsx
          // Best-effort 80mm thermal receipt (never blocks checkout)
          void finalizeCheckoutReceipt(invoiceData)
```

Note: match the surrounding indentation of each file when inserting (the snippets above use the indentation found at each target line).

- [ ] **Step 9: Verify it compiles**

Run: `npm run lint:types`
Expected: PASS across all four modified files.

- [ ] **Step 10: Manual end-to-end check**

Run: `npm run dev`. Log into the staff portal, open a booking that can be checked out, and complete checkout from the Reservations/Calendar view. Expected: checkout succeeds as before, AND a print window/dialog opens with the 72mm receipt. With the thermal printer set as the OS default and pop-ups allowed for the site, this is a single confirm. If pop-ups are blocked, checkout still succeeds and a toast warns to allow pop-ups.

- [ ] **Step 11: Commit**

```bash
git add src/components/CalendarGridView.tsx src/components/CalendarListView.tsx src/components/CalendarTimeline.tsx src/pages/staff/ReservationsPage.tsx
git commit -m "feat: auto-print 80mm receipt on checkout from all checkout views"
```

---

## Operator setup (one-time, not code)

Document for the front-desk PC:
1. Install the 80mm thermal printer's OS driver (USB).
2. Set it as the **default printer** in OS settings.
3. In the browser, allow pop-ups for the app's URL (so the print window opens without prompting).
4. Optional (Chrome, for near-silent printing): launch with `--kiosk-printing` to skip the print dialog entirely.

## Self-Review Notes

- **Spec coverage:** 72mm template (Task 1) ✔; print launcher (Task 2) ✔; preview/testing route (Task 3) ✔; shared helper "Approach A" (Task 4) ✔; wired into all 4 checkout sites (Task 5) ✔; A4 path untouched (no edits to `generateInvoiceHTML`/`printInvoice`/email/PDF) ✔; best-effort/non-blocking ✔; GHS + Ghana tax reused, not recomputed ✔.
- **Placeholders:** none — full code in every code step.
- **Type consistency:** `generateReceipt80mmHTML` / `printReceipt80mm` / `finalizeCheckoutReceipt` names used identically across tasks; `InvoiceData` not exported, so the helper derives it via `Awaited<ReturnType<typeof createInvoiceData>>`.
- **Deviation from TDD:** repo has no test runner; per Global Constraints, verification is `tsc` + preview route rather than added unit tests (avoids YAGNI test-framework scope creep).
