import { toast } from 'sonner'
import { printReceipt80mm, createInvoiceData, type ReceiptPayment } from './invoice-service'

type InvoiceData = Awaited<ReturnType<typeof createInvoiceData>>

/**
 * Offer to print an 80mm thermal receipt after a payment is recorded
 * (at check-in, or at an onsite booking with a deposit/payment).
 *
 * Shows a non-blocking toast with a "Print receipt" action — staff choose
 * when to print. The actual print is best-effort: a failure (popup blocked,
 * no printer) only surfaces a toast and never throws.
 */
export function promptPrintReceipt(
  invoiceData: InvoiceData | null | undefined,
  payment?: ReceiptPayment
): void {
  if (!invoiceData) return
  toast('Payment recorded', {
    description: 'Print an 80mm receipt for the guest?',
    duration: 15000,
    action: {
      label: 'Print receipt',
      onClick: () => {
        printReceipt80mm(invoiceData, payment).catch((err: any) => {
          console.error('❌ [ReceiptPrint] Failed to print receipt:', err)
          toast.warning(err?.message || 'Could not print receipt. Check the printer / allow pop-ups.')
        })
      },
    },
  })
}
