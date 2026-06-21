import { toast } from 'sonner'
import {
  printReceipt80mm,
  printGroupReceipt80mm,
  createInvoiceData,
  buildOnsiteGroupReceiptData,
  type ReceiptPayment
} from './invoice-service'

type InvoiceData = Awaited<ReturnType<typeof createInvoiceData>>
type GroupInvoiceData = Awaited<ReturnType<typeof buildOnsiteGroupReceiptData>>

/**
 * Show a non-blocking "Print receipt?" toast. The print itself is best-effort:
 * a failure (popup blocked, no printer) only surfaces a warning toast.
 */
function showPrintPrompt(print: () => Promise<void>): void {
  toast('Payment recorded', {
    description: 'Print an 80mm receipt for the guest?',
    duration: 15000,
    action: {
      label: 'Print receipt',
      onClick: () => {
        print().catch((err: any) => {
          console.error('❌ [ReceiptPrint] Failed to print receipt:', err)
          toast.warning(err?.message || 'Could not print receipt. Check the printer / allow pop-ups.')
        })
      },
    },
  })
}

/**
 * Offer to print an 80mm receipt for a single booking after a payment is
 * recorded (at check-in, or an onsite single-room booking with a deposit).
 */
export function promptPrintReceipt(
  invoiceData: InvoiceData | null | undefined,
  payment?: ReceiptPayment
): void {
  if (!invoiceData) return
  showPrintPrompt(() => printReceipt80mm(invoiceData, payment))
}

/**
 * Offer to print an 80mm group receipt after a payment is recorded
 * (an onsite multi-room booking with a deposit).
 */
export function promptPrintGroupReceipt(
  groupData: GroupInvoiceData | null | undefined,
  payment?: ReceiptPayment
): void {
  if (!groupData) return
  showPrintPrompt(() => printGroupReceipt80mm(groupData, payment))
}
