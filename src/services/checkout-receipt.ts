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
