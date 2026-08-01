import { useState } from 'react'
import { CheckCircle2, XCircle, Loader2, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useCheckIn } from '@/hooks/use-check-in'
import { useCheckOut } from '@/hooks/use-check-out'
import { useStaffRole } from '@/hooks/use-staff-role'
import { hasPermission } from '@/lib/rbac'
import { auth } from '@/lib/db'
import { ClockStatusWarning } from '@/components/ClockStatusWarning'

const CLOCK_GATED_TOOLS = new Set(['checkInGuest', 'checkOutGuest', 'createBooking'])
import {
  executeTool,
  resolveCheckInTarget,
  resolveCheckOutTarget,
  TOOL_PERMISSIONS,
  type ToolResult,
} from '@/services/staff-assistant-tools'

function describeAction(name: string, args: any): string {
  switch (name) {
    case 'createBooking':
      return `Create a booking for ${args.guestName} — Room ${args.roomNumberOrType}, ${args.checkIn} → ${args.checkOut}${args.amountCollected ? `, collecting GH₵${args.amountCollected} (${args.paymentMethod})` : ' (nothing collected yet)'}.`
    case 'checkInGuest':
      return `Check in ${args.guestNameOrBookingRef}${args.amountCollected ? `, collecting GH₵${args.amountCollected} in ${args.paymentMethod}` : ` (${args.paymentMethod})`}.`
    case 'checkOutGuest':
      return `Check out ${args.guestNameOrBookingRef} and send their invoice.`
    case 'extendStay':
      return `Extend ${args.guestNameOrBookingRef}'s stay to ${args.newCheckoutDate}${args.newRoomNumber ? ` (moving to Room ${args.newRoomNumber})` : ''}.`
    case 'createGroupBooking':
      return `Create a group booking with ${args.rooms?.length || 0} room(s) billed to ${args.billingContactName}.`
    case 'addRoomToGroup':
      return `Add Room ${args.roomNumberOrType} for ${args.guestName} to group ${args.groupReference}.`
    case 'removeRoomFromGroup':
      return `Remove ${args.roomNumberOrGuestName} from group ${args.groupReference}.`
    case 'cancelGroup':
      return `Cancel the entire group booking ${args.groupReference}.`
    case 'cancelBooking':
      return `Cancel the booking for ${args.guestNameOrBookingRef}.`
    case 'addCharge':
      return `Add a GH₵${args.amount} charge ("${args.description}") to ${args.guestNameOrBookingRef}'s bill.`
    case 'applyDiscount':
      return `Apply a GH₵${args.amount} discount to ${args.guestNameOrBookingRef}'s bill${args.reason ? ` (${args.reason})` : ''}.`
    default:
      return `Run ${name}?`
  }
}

export function ActionCard({
  name,
  args,
  status,
  result,
  onResolved,
  onCancel,
}: {
  name: string
  args: any
  status?: 'pending' | 'executing' | 'done' | 'cancelled'
  result?: { ok: boolean; summary: string }
  onResolved: (result: ToolResult) => void
  onCancel: () => void
}) {
  const [busy, setBusy] = useState(false)
  const { checkIn } = useCheckIn()
  const { checkOut } = useCheckOut()
  const { role, staffRecord } = useStaffRole()

  const handleConfirm = async () => {
    setBusy(true)
    try {
      // Defense in depth: re-check permission right before executing, in case
      // the staff member's role changed mid-session.
      const perm = TOOL_PERMISSIONS[name]
      if (perm && role && !hasPermission(role, perm.resource, perm.action)) {
        onResolved({ ok: false, error: "Your role no longer has permission to do that." })
        return
      }

      const user = await auth.me().catch(() => null)

      if (name === 'checkInGuest') {
        const target = await resolveCheckInTarget(args)
        if ('ok' in target) {
          onResolved(target)
          return
        }
        const ok = await checkIn({
          booking: target.booking,
          room: target.room,
          guest: target.guest,
          paymentMethod: target.paymentMethod,
          checkInAmount: target.checkInAmount,
          discountAmount: target.discountAmount,
          discountReason: target.discountReason,
          user,
        })
        onResolved(ok
          ? { ok: true, humanSummary: `Checked in ${target.guest?.name || 'guest'} — Room ${target.room?.roomNumber || '?'}.` }
          : { ok: false, error: 'Check-in failed. See the toast notification for details.' })
        return
      }

      if (name === 'checkOutGuest') {
        const target = await resolveCheckOutTarget(args)
        if ('ok' in target) {
          onResolved(target)
          return
        }
        const ok = await checkOut({ booking: target.booking, room: target.room, guest: target.guest, roomTypeName: target.roomTypeName, user })
        onResolved(ok
          ? { ok: true, humanSummary: `Checked out ${target.guest?.name || 'guest'}. Invoice sent.` }
          : { ok: false, error: 'Check-out failed. See the toast notification for details.' })
        return
      }

      const result = await executeTool(name, args, {
        id: user?.id,
        name: (user as any)?.user_metadata?.full_name || user?.email,
        staffId: staffRecord?.id,
      })
      onResolved(result)
    } catch (err: any) {
      onResolved({ ok: false, error: err?.message || 'Action failed.' })
    } finally {
      setBusy(false)
    }
  }

  if (status === 'cancelled') {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
        <XCircle className="h-4 w-4 shrink-0" />
        Cancelled — nothing happened.
      </div>
    )
  }

  if (status === 'done' && result) {
    return (
      <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${result.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-800'}`}>
        {result.ok ? <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" /> : <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />}
        <span>{result.summary}</span>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-3 text-sm space-y-3">
      <p className="text-foreground">{describeAction(name, args)}</p>
      {CLOCK_GATED_TOOLS.has(name) && <ClockStatusWarning />}
      <div className="flex gap-2">
        <Button size="sm" onClick={handleConfirm} disabled={busy} className="h-8">
          {busy ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : null}
          Confirm
        </Button>
        <Button size="sm" variant="outline" onClick={onCancel} disabled={busy} className="h-8">
          Cancel
        </Button>
      </div>
    </div>
  )
}
