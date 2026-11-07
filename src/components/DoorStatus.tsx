import { useState } from 'react'
import { CreditCard, DoorClosed, DoorOpen, KeyRound, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { hotelTime, markCard } from '@/services/key-cards'
import { doorTone, type DoorStatus } from '@/services/door-status'

/** Hotel time is GMT, so an ISO time's clock is the hotel's. */
const clock = (iso: string) => iso.slice(11, 16)

/** One line for staff on what the door is doing, for a tooltip or a note. */
export function doorText(s: DoorStatus): string {
  switch (doorTone(s)) {
    case 'old-card':
      return `${s.oldCards === 1 ? 'A card' : `${s.oldCards} cards`} of a past stay still open${s.oldCards === 1 ? 's' : ''} room ${s.roomNumber} until ${hotelTime(s.oldCardUntil!)}. `
        + 'To stop it now, make a lock-out card (Key cards page) and hold it to the lock once.'
    case 'lockout':
      return `A lock-out card for room ${s.roomNumber} was made at ${clock(s.lockout!.madeAt)}. Hold it to the lock once before ${clock(s.lockout!.until)}: then only new cards open the door.`
    case 'needs-card':
      return `The guest in room ${s.roomNumber} has no working key card yet.`
    case 'guest':
      return `The guest's key cards open room ${s.roomNumber} until ${hotelTime(s.guestUntil!)}.`
    default:
      return `No card the app knows of opens room ${s.roomNumber}.`
  }
}

const CHIP: Record<ReturnType<typeof doorTone>, { label: string; className: string; Icon: typeof KeyRound }> = {
  'old-card': { label: 'Old card works', className: 'bg-red-50 text-red-700 border-red-200', Icon: DoorOpen },
  lockout: { label: 'Lock-out ready', className: 'bg-amber-50 text-amber-800 border-amber-200', Icon: DoorClosed },
  'needs-card': { label: 'Needs a card', className: 'bg-amber-50 text-amber-800 border-amber-200', Icon: CreditCard },
  guest: { label: 'Guest cards', className: 'bg-emerald-50 text-emerald-700 border-emerald-200', Icon: KeyRound },
  secure: { label: 'Door secure', className: 'bg-stone-50 text-stone-600 border-stone-200', Icon: DoorClosed },
}

/** A small pill for a room card (Rooms page). Nothing for a room without a lock. */
export function DoorStatusChip({ status, className }: { status?: DoorStatus | null; className?: string }) {
  if (!status) return null
  const { label, className: tone, Icon } = CHIP[doorTone(status)]
  const text = doorText(status)
  return (
    <span title={text} className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold', tone, className)}>
      <Icon className="h-3 w-3" aria-hidden />
      {label}
      <span className="sr-only">: {text}</span>
    </span>
  )
}

/** An icon only when a door needs something (Calendar rows). */
export function DoorStatusIcon({ status, className }: { status?: DoorStatus | null; className?: string }) {
  if (!status) return null
  const tone = doorTone(status)
  if (tone === 'guest' || tone === 'secure') return null
  const { Icon } = CHIP[tone]
  const text = doorText(status)
  return (
    <span title={text} className={cn('inline-flex items-center', tone === 'old-card' ? 'text-red-300' : 'text-amber-300', className)}>
      <Icon className="h-3.5 w-3.5" aria-hidden />
      <span className="sr-only">{text}</span>
    </span>
  )
}

/**
 * For a cleaning task (Housekeeping): a past guest's card that still opens the
 * door, or a lock-out card to hold to the lock, with a button for when it is done.
 */
export function DoorStatusNote({ status, onChanged }: { status?: DoorStatus | null; onChanged?: () => void }) {
  const [busy, setBusy] = useState(false)
  if (!status) return null
  const tone = doorTone(status)
  if (tone !== 'old-card' && tone !== 'lockout') return null

  async function held() {
    if (!status?.lockout) return
    setBusy(true)
    try {
      await markCard(status.lockout.cardId, 'returned', 'Held to the lock (housekeeping)')
      toast.success(`Room ${status.roomNumber}: the door now takes only new cards`)
      onChanged?.()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not record it')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={cn('flex flex-wrap items-start gap-2 rounded-md border p-3 text-sm', tone === 'old-card' ? 'border-red-200 bg-red-50 text-red-800' : 'border-amber-200 bg-amber-50 text-amber-900')}>
      {tone === 'old-card' ? <DoorOpen className="mt-0.5 h-4 w-4 shrink-0" /> : <DoorClosed className="mt-0.5 h-4 w-4 shrink-0" />}
      <p className="min-w-0 flex-1">
        {tone === 'old-card'
          ? `A past guest's card still opens this door until ${hotelTime(status.oldCardUntil!)}. Ask reception for a lock-out card and hold it to the lock once.`
          : `Reception made a lock-out card for this door at ${clock(status.lockout!.madeAt)}. Hold it to the lock once before ${clock(status.lockout!.until)}, then bring it back.`}
      </p>
      {tone === 'lockout' && (
        <Button size="sm" variant="outline" className="h-8 bg-white" disabled={busy} onClick={() => void held()}>
          {busy && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}Done: held it to the lock
        </Button>
      )}
    </div>
  )
}
