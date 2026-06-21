# 80mm Thermal Receipt Auto-Print at Checkout — Design

**Date:** 2026-06-21
**Status:** Approved for planning

## Goal

Print an 80mm thermal receipt at the point of payment — at **check-in** (where payment is
usually taken) and at **onsite booking** when a deposit/payment is recorded — via a "Print
receipt?" confirm prompt. Receipt is formatted for the 80mm paper roll. The existing A4 invoice
(email + PDF download) is unchanged.

> **Revision (2026-06-21):** Original design auto-printed at checkout. Changed because payments
> are made at booking/check-in, not checkout. Trigger moved to check-in + onsite-booking-with-
> deposit, behavior changed from silent auto-print to a confirm prompt, and the receipt now shows
> Paid / Balance Due (PAID vs DEPOSIT stamp). Checkout trigger removed.
>
> **Group bookings (2026-06-21):** Onsite multi-room bookings with a deposit also print, via a
> dedicated 72mm group receipt (one line per room) built from form data
> (`buildOnsiteGroupReceiptData` → `printGroupReceipt80mm`).

## Decisions (confirmed with user)

- **Printer connection:** USB to the front-desk PC. Installed as a normal OS printer.
- **Automation level:** One-click acceptable. Thermal printer set as OS default → `window.print()`
  routes to it, dialog is a single confirm. No middleware (no QZ Tray / ESC/POS / WebUSB).
- **Scope:** 80mm format applies to the **printed paper copy only**. Email and PDF download keep
  the existing A4 invoice template.
- **Trigger content:** Final receipt (paid invoice) — charges, Ghana tax breakdown, grand total,
  PAID status.
- **Call-site strategy:** Approach A — extract one shared helper, called from all checkout sites.
- **Currency / tax:** GHS, Ghana tax model (Sales Total, GF/NHIL 5%, VAT 15%, Tourism Levy 1%) via
  existing `calculateGhanaTaxBreakdown`.

## Printer constraints

- 80mm paper roll. Printable width ~72mm = 576 dots at 203 dpi.
- Continuous roll: height is `auto` (content-driven), width is fixed.
- CSS: `@page { size: 72mm auto; margin: 0 }`, body width 72mm, single column, no heavy table
  borders, condensed font (~11–12px). Use dashed/solid full-width dividers instead of bordered
  tables.
- The current A4 template uses `width: 794px` (≈210mm) — far too wide for the roll, hence a
  separate template.

## Architecture

Additive. No changes to A4 invoice generation, email, or PDF paths.

### New functions in `src/services/invoice-service.ts`

1. `generateReceipt80mmHTML(invoiceData: InvoiceData): Promise<string>`
   - 80mm CSS receipt template. Consumes the existing `InvoiceData` shape — no new data fetching.
   - Reuses the Ghana tax fields already on `invoiceData.charges`
     (`salesTotal`, `gfNhil`, `vat`, `tourismLevy`, `total`).

2. `printReceipt80mm(invoiceData: InvoiceData): Promise<void>`
   - Clone of existing `printInvoice` pattern: `window.open` → `document.write(html)` →
     `document.close()` → `print()` (small `setTimeout` so styles render first).
   - Throws on popup-blocked; caller handles via toast.

### Shared checkout helper (Approach A)

`handleCheckOut` is currently duplicated across 4 files:
- `src/components/CalendarGridView.tsx`
- `src/components/CalendarListView.tsx`
- `src/components/CalendarTimeline.tsx`
- `src/pages/staff/ReservationsPage.tsx`

Each builds `invoiceData` via `createInvoiceData`, then emails the PDF.

Add a single helper (e.g. `finalizeCheckoutReceipt(invoiceData)`) that wraps `printReceipt80mm`
in try/catch and toasts on failure. Call it from all 4 sites after the checkout has succeeded and
`invoiceData` exists.

- Print is **best-effort and post-success**: checkout is already committed before printing, so a
  print failure (popup blocked, no printer) shows a toast but never blocks or reverts checkout.
- This consolidates the print concern in one place rather than pasting it into 4 diverging copies.

## Receipt layout (72mm, single column, centered header)

```
        [logo ~120px]
        AMP LODGE
   addr · phone · website
------------------------------
RECEIPT   INV-...-XXXX
Date: 21 Jun 2026
Guest: John Doe
Room: 204 (Standard)
In 19 Jun -> Out 21 Jun · 2 nt
------------------------------
Room  2 × GHS150.00   300.00
Laundry               40.00
------------------------------
Sales Total          295.16
GF/NHIL 5%            14.76
VAT 15%              45.08
Tourism 1%            2.95
------------------------------
TOTAL          GHS 340.00
        *** PAID ***
------------------------------
   Thank you! · website
```

- Header: small centered logo, hotel name, address/phone/website.
- Body: invoice number, date, guest, room number + type, check-in → check-out, nights.
- Line items: room rate × nights, then each additional charge.
- Ghana tax block: Sales Total, GF/NHIL 5%, VAT 15%, Tourism Levy 1%.
- Grand total bold, `GHS` currency. PAID status line.
- Footer: thank-you + website.

## Error handling

- Popup blocked → toast "Allow pop-ups to print receipt" (existing pattern), checkout still
  succeeds.
- No printer / print throws → caught in helper, toast warns, checkout unaffected.
- `invoiceData` missing → skip print silently (same guard as email path).

## Testing

- **Preview route:** clone the `InvoiceTestPage` pattern to render `generateReceipt80mmHTML` with
  mock `InvoiceData` in the browser — verify layout at 72mm without a physical printer.
- **Manual:** print on the real 80mm thermal; verify width, no clipping, clean cut.

## Out of scope (YAGNI)

- Silent/no-dialog printing (would need QZ Tray or a local agent).
- ESC/POS raw commands, WebUSB, network/Bluetooth printing.
- Changing the A4 email/PDF invoice.
