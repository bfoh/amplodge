import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog'
import { subscribeReceiptPrompt, type ReceiptPromptRequest } from '@/services/receipt-print'

/**
 * Global "Print receipt?" confirmation. Mounted once at the app root so a
 * payment recorded on ANY page (bookings, calendar, onsite, check-in) raises
 * the same persistent modal. It stays open until the user chooses Print or
 * Don't print — it never auto-dismisses.
 */
export function ReceiptPrintDialog() {
  const [open, setOpen] = useState(false)
  const [request, setRequest] = useState<ReceiptPromptRequest | null>(null)

  useEffect(() => {
    subscribeReceiptPrompt((req) => {
      setRequest(req)
      setOpen(true)
    })
    return () => subscribeReceiptPrompt(null)
  }, [])

  const handlePrint = () => {
    setOpen(false)
    // Runs inside a user click → window.open/print is allowed.
    request?.print().catch((err: any) => {
      console.error('❌ [ReceiptPrint] Failed to print receipt:', err)
      toast.warning(err?.message || 'Could not print receipt. Check the printer / allow pop-ups.')
    })
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Print receipt?</AlertDialogTitle>
          <AlertDialogDescription>
            Payment recorded. Print an 80mm receipt for the guest?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Don't print</AlertDialogCancel>
          <AlertDialogAction onClick={handlePrint}>Print receipt</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
