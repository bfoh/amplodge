import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Clock } from 'lucide-react'

export function IdleWarningDialog({
  open,
  secondsRemaining,
  onStayLoggedIn,
  onLogoutNow,
}: {
  open: boolean
  secondsRemaining: number
  onStayLoggedIn: () => void
  onLogoutNow: () => void
}) {
  const minutes = Math.floor(secondsRemaining / 60)
  const seconds = secondsRemaining % 60

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onStayLoggedIn() }}>
      <DialogContent className="sm:max-w-sm" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-amber-100">
            <Clock className="h-5 w-5 text-amber-600" />
          </div>
          <DialogTitle className="text-center">Still there?</DialogTitle>
          <DialogDescription className="text-center">
            You'll be signed out in {minutes}:{seconds.toString().padStart(2, '0')} due to inactivity —
            this protects against the next staff member accidentally working under your account.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button onClick={onStayLoggedIn} className="w-full">Stay signed in</Button>
          <Button onClick={onLogoutNow} variant="outline" className="w-full">Log out now</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
