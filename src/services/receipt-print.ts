import {
  printReceipt80mm,
  printGroupReceipt80mm,
  createInvoiceData,
  buildOnsiteGroupReceiptData,
  type ReceiptPayment
} from './invoice-service'

type InvoiceData = Awaited<ReturnType<typeof createInvoiceData>>
type GroupInvoiceData = Awaited<ReturnType<typeof buildOnsiteGroupReceiptData>>

/** A pending request for the global "Print receipt?" confirmation dialog. */
export interface ReceiptPromptRequest {
  print: () => Promise<void>
}

// Single subscriber: the <ReceiptPrintDialog/> mounted once at the app root.
// Service-layer call sites (booking/check-in handlers) cannot render React, so
// they emit a request here and the mounted dialog shows a persistent modal.
let opener: ((req: ReceiptPromptRequest) => void) | null = null

export function subscribeReceiptPrompt(fn: ((req: ReceiptPromptRequest) => void) | null): void {
  opener = fn
}

function emit(print: () => Promise<void>): void {
  if (opener) {
    opener({ print })
  } else {
    // No dialog mounted (shouldn't happen) — fail safe by printing directly.
    print().catch(err => console.error('❌ [ReceiptPrint] print failed (no dialog mounted):', err))
  }
}

/**
 * Open the global "Print receipt?" confirmation for a single booking after a
 * payment is recorded (check-in, or a single-room booking with payment).
 */
export function promptPrintReceipt(
  invoiceData: InvoiceData | null | undefined,
  payment?: ReceiptPayment
): void {
  if (!invoiceData) return
  emit(() => printReceipt80mm(invoiceData, payment))
}

/**
 * Open the global "Print receipt?" confirmation for a group (multi-room)
 * booking after a payment is recorded.
 */
export function promptPrintGroupReceipt(
  groupData: GroupInvoiceData | null | undefined,
  payment?: ReceiptPayment
): void {
  if (!groupData) return
  emit(() => printGroupReceipt80mm(groupData, payment))
}
