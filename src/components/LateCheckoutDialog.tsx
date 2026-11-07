import { useEffect, useRef, useState } from 'react'
import { Clock, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { db } from '@/lib/db'
import { useCurrency } from '@/hooks/use-currency'
import { promptUpdateCards, subscribeLatePrompt, type StayCardsRequest } from '@/services/key-card-prompt'
import { CHECK_OUT_TIME, LATE_CHECK_OUT_TIMES, hotelDay, hotelTime, stayKeyEnd } from '@/services/key-cards'
import { CHARGE_METHODS, STAY_RULES_MIGRATION, hasStayRules, setLateCheckOut, type ChargeMethod } from '@/services/key-card-stay'

interface Stay {
  status: string
  checkIn: string
  checkOut: string
  lateCheckOut: string | null
  ready: boolean
  hasLock: boolean
}

/**
 * Late check-out, from a booking's menu or its Key cards. Staff pick a later time on
 * check-out day (12:00 to 18:00) and may add a charge. Then the guest's key cards
 * are updated to work until an hour after it.
 */
export function LateCheckoutDialog() {
  const { currency } = useCurrency()
  const [request, setRequest] = useState<StayCardsRequest | null>(null)
  const [stay, setStay] = useState<Stay | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [time, setTime] = useState('14:00')
  const [charge, setCharge] = useState('')
  const [method, setMethod] = useState<ChargeMethod>('pay_later')
  const [saving, setSaving] = useState(false)
  const closed = useRef<(() => void) | null>(null)

  useEffect(() => {
    subscribeLatePrompt((req, onClosed) => {
      closed.current?.()
      closed.current = onClosed
      setRequest(req)
      setStay(null)
      setFailed(null)
      setCharge('')
      setMethod('pay_later')
      void load(req)
    })
    return () => subscribeLatePrompt(null)
  }, [])

  async function load(req: StayCardsRequest) {
    try {
      const b = (await db.bookings.get(req.bookingId)) as any
      if (!b) throw new Error('The booking could not be found.')
      const locks = (await db.roomLocks.list({ where: { roomId: b.roomId }, limit: 10 })) as unknown[]
      const late = b.lateCheckOut ? String(b.lateCheckOut).slice(0, 5) : null
      setStay({
        status: b.status,
        checkIn: String(b.checkIn).slice(0, 10),
        checkOut: String(b.checkOut).slice(0, 10),
        lateCheckOut: late,
        ready: hasStayRules(b),
        hasLock: locks.length > 0,
      })
      setTime(late && LATE_CHECK_OUT_TIMES.includes(late) ? late : '14:00')
    } catch (e) {
      setFailed(e instanceof Error ? e.message : 'The booking could not be loaded.')
    }
  }

  function close() {
    if (saving) return
    setRequest(null)
    const done = closed.current
    closed.current = null
    done?.()
  }

  const amount = charge.trim() === '' ? 0 : Number(charge)
  const validCharge = Number.isFinite(amount) && amount >= 0

  async function save(to: string | null) {
    if (!request || !stay || !validCharge) return
    setSaving(true)
    try {
      await setLateCheckOut({ bookingId: request.bookingId, time: to, charge: to ? amount : 0, method })
      toast.success(to ? `Late check-out at ${to}${amount > 0 ? ', charge added' : ''}` : `Check-out is back to ${CHECK_OUT_TIME}`)
      setSaving(false)
      const req = request
      setRequest(null)
      const done = closed.current
      closed.current = null
      done?.()
      // Later than the cards: they are updated at the encoder (nothing to do when there are none).
      if (to && stay.hasLock) void promptUpdateCards({ bookingId: req.bookingId, guestName: req.guestName, roomNumber: req.roomNumber })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save the late check-out')
      setSaving(false)
    }
  }

  const keyEnd = stay ? hotelTime(stayKeyEnd({ checkIn: stay.checkIn, checkOut: stay.checkOut, lateCheckOut: time })) : ''

  return (
    <Dialog open={!!request} onOpenChange={(open) => { if (!open) close() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Clock className="h-5 w-5 text-primary" />Late check-out</DialogTitle>
          <DialogDescription>{request?.roomNumber ? `Room ${request.roomNumber}` : ''}{request?.guestName ? ` · ${request.guestName}` : ''}</DialogDescription>
        </DialogHeader>

        {failed ? <p className="text-sm text-red-700">{failed}</p>
          : !stay ? <p className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" /> Loading the booking…</p>
          : !stay.ready ? (
            <p className="text-sm text-amber-800">
              Late check-out needs a database update first: an admin runs <code className="text-xs">{STAY_RULES_MIGRATION}</code> in the Supabase SQL editor.
            </p>
          ) : stay.status !== 'checked-in' ? (
            <p className="text-sm text-muted-foreground">Late check-out is for a guest who is checked in.</p>
          ) : (
            <div className="space-y-4 text-sm">
              <p>
                Check-out is {hotelDay(stay.checkOut)}, usually at {CHECK_OUT_TIME}
                {stay.lateCheckOut ? `. It is set to ${stay.lateCheckOut} now.` : '.'}
              </p>
              <div className="space-y-1">
                <Label htmlFor="late-time">The guest leaves at</Label>
                <Select value={time} onValueChange={setTime}>
                  <SelectTrigger id="late-time" className="w-40"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {LATE_CHECK_OUT_TIMES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
                {stay.hasLock && <p className="text-xs text-muted-foreground">The key cards will work until {keyEnd}. You update them at the encoder next.</p>}
              </div>
              <div className="space-y-1">
                <Label htmlFor="late-charge">Charge ({currency}, optional)</Label>
                <div className="flex flex-wrap gap-2">
                  <Input id="late-charge" className="w-32" inputMode="decimal" placeholder="None" value={charge} onChange={(e) => setCharge(e.target.value)} />
                  {amount > 0 && (
                    <Select value={method} onValueChange={(v) => setMethod(v as ChargeMethod)}>
                      <SelectTrigger className="w-48" aria-label="How the charge is paid"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {CHARGE_METHODS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                </div>
                {!validCharge && <p className="text-xs text-red-700">Enter an amount, such as 50, or leave it empty.</p>}
              </div>
            </div>
          )}

        <DialogFooter className="gap-2 sm:gap-0">
          {stay?.ready && stay.status === 'checked-in' && stay.lateCheckOut && (
            <Button variant="ghost" disabled={saving} onClick={() => void save(null)}>Back to {CHECK_OUT_TIME}</Button>
          )}
          <Button variant="outline" disabled={saving} onClick={close}>Cancel</Button>
          {stay?.ready && stay.status === 'checked-in' && (
            <Button disabled={saving || !validCharge} onClick={() => void save(time)}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
