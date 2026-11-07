import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, CalendarClock, Clock, CreditCard, KeyRound, Loader2, PackageCheck, Printer, SearchX } from 'lucide-react'
import { toast } from 'sonner'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { bookingChargesService } from '@/services/booking-charges-service'
import { describeKeyEnd, hasStayRules, keyCardDays, paidNightsOf, printCardSleeve, setKeyCardsUntil, type PaidNights } from '@/services/key-card-stay'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { db } from '@/lib/db'
import {
  cardsOutOfStep, promptCollectCards, promptKeyCards, promptLateCheckout, promptUpdateCards, subscribeStayPrompt,
  type KeyCardRequest, type StayCardsRequest,
} from '@/services/key-card-prompt'
import { STATUS_LABEL, canOpenDoor, hotelDay, hotelTime, loadStayCards, type KeyCard } from '@/services/key-cards'

interface StayView {
  /** The booking row: lateCheckOut and keyCardsUntil decide when the cards stop. */
  booking: any
  paid: PaidNights | null
  status: string
  checkIn: string
  checkOut: string
  roomNumber: string
  hasLock: boolean
  cards: KeyCard[]
  outOfStep: number
}

/** Hotel date (GMT). */
const today = () => new Date().toISOString().slice(0, 10)

/**
 * One stay's key cards, from a booking's menu: every card made for it and what
 * became of it, and what can be done next (make, add, replace a lost one,
 * update after an extension, take back after check-out). Each action opens its
 * own dialog, so this one closes first.
 */
export function StayCardsDialog() {
  const [request, setRequest] = useState<StayCardsRequest | null>(null)
  const [view, setView] = useState<StayView | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [confirmLost, setConfirmLost] = useState(false)
  const [savingDay, setSavingDay] = useState(false)
  const closed = useRef<(() => void) | null>(null)

  useEffect(() => {
    subscribeStayPrompt((req, onClosed) => {
      closed.current?.()
      closed.current = onClosed
      setRequest(req)
      setView(null)
      setFailed(null)
      setConfirmLost(false)
      void load(req)
    })
    return () => subscribeStayPrompt(null)
  }, [])

  async function load(req: StayCardsRequest) {
    try {
      const b = (await db.bookings.get(req.bookingId)) as any
      if (!b) throw new Error('The booking could not be found.')
      const [rooms, locks, cards, behind, charges] = await Promise.all([
        db.rooms.list({ where: { id: b.roomId }, limit: 1 }) as Promise<Array<{ roomNumber: string }>>,
        db.roomLocks.list({ where: { roomId: b.roomId }, limit: 10 }) as Promise<unknown[]>,
        loadStayCards(req.bookingId),
        cardsOutOfStep(req.bookingId),
        bookingChargesService.getChargesForBooking(req.bookingId).catch(() => []),
      ])
      setView({
        booking: b,
        paid: paidNightsOf(b, charges as any),
        status: b.status,
        checkIn: String(b.checkIn).slice(0, 10),
        checkOut: String(b.checkOut).slice(0, 10),
        roomNumber: String(rooms[0]?.roomNumber ?? req.roomNumber ?? '?'),
        hasLock: locks.length > 0,
        cards: cards.filter((c) => c.status !== 'failed').reverse(),
        outOfStep: behind.length,
      })
    } catch (e) {
      setFailed(e instanceof Error ? e.message : 'The stay\'s cards could not be loaded.')
    }
  }

  function close() {
    setRequest(null)
    const done = closed.current
    closed.current = null
    done?.()
  }

  /** Cards stop on this day (a guest paying night by night), or check-out day for the whole stay. */
  async function changeDay(day: string) {
    if (!request || !view) return
    setSavingDay(true)
    try {
      await setKeyCardsUntil(request.bookingId, day, view.checkOut)
      toast.success(day < view.checkOut ? `Cards now stop ${hotelDay(day)}` : 'Cards now work for the whole stay')
      await load(request)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not change it')
    } finally {
      setSavingDay(false)
    }
  }

  /** Closes this view, then opens the dialog that does the work. */
  function then(next: () => Promise<void>) {
    close()
    void next()
  }

  const guest = request?.guestName || view?.cards[0]?.guestName || 'Guest'
  const room = view?.roomNumber ?? request?.roomNumber ?? '?'
  const staying = !!view && (view.status === 'checked-in' || (['confirmed', 'reserved'].includes(view.status) && view.checkIn <= today()))
  const working = view?.cards.filter((c) => canOpenDoor(c) && c.status !== 'not_returned') ?? []
  const out = view?.cards.filter((c) => ['issued', 'unknown'].includes(c.status)) ?? []
  const cardReq: KeyCardRequest | null = request ? { bookingId: request.bookingId, guestName: guest, roomNumber: room } : null

  return (
    <Dialog open={!!request} onOpenChange={(open) => { if (!open) close() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><KeyRound className="h-5 w-5 text-primary" />Key cards</DialogTitle>
          <DialogDescription>Room {room} · {guest}</DialogDescription>
        </DialogHeader>

        {failed ? <p className="text-sm text-red-700">{failed}</p>
          : !view ? <p className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" /> Looking at the stay's cards…</p>
          : (
            <div className="space-y-3 text-sm">
              {!view.hasLock && (
                <p className="text-muted-foreground">
                  Room {room} has no door lock number yet, so this app makes no cards for it. An admin adds it on the{' '}
                  <Link to="/staff/properties" className="underline" onClick={close}>Rooms page</Link>.
                </p>
              )}
              {view.cards.length ? (
                <ul className="divide-y rounded-lg border">
                  {view.cards.map((c) => (
                    <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                      <span className="text-muted-foreground">
                        Made {hotelTime(c.createdAt)}<br />
                        <span className="text-foreground">{canOpenDoor(c) ? 'Opens' : 'Opened'} room {c.roomNumber ?? room} until {hotelTime(c.validUntil)}</span>
                      </span>
                      <Badge variant="outline">{STATUS_LABEL[c.status]}</Badge>
                    </li>
                  ))}
                </ul>
              ) : view.hasLock && <p className="text-muted-foreground">No cards have been made for this stay.</p>}

              {view.hasLock && staying && (
                <div className="space-y-2 rounded-lg border bg-muted/40 p-3">
                  <p>Cards should work until <span className="font-medium">{describeKeyEnd(view.booking)}</span>.</p>
                  {hasStayRules(view.booking) && keyCardDays(view.checkIn, view.checkOut).length > 1 && (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-muted-foreground">Stop them on</span>
                      <Select
                        value={String(view.booking.keyCardsUntil ?? view.checkOut).slice(0, 10)}
                        onValueChange={(d) => void changeDay(d)}
                        disabled={savingDay}
                      >
                        <SelectTrigger className="h-8 w-56" aria-label="The day the cards stop on"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {keyCardDays(view.checkIn, view.checkOut).map((d, i, all) => (
                            <SelectItem key={d} value={d}>
                              {hotelDay(d)}{i === all.length - 1 ? ' (check-out)' : ` (${i + 1} night${i ? 's' : ''})`}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {savingDay && <Loader2 className="h-4 w-4 animate-spin" />}
                    </div>
                  )}
                  {view.paid && view.paid.paid < view.paid.nights && (
                    <p className="text-xs text-muted-foreground">
                      Paid for {view.paid.paid} of {view.paid.nights} night{view.paid.nights === 1 ? '' : 's'}.
                      {!view.booking.keyCardsUntil && ' The cards work for the whole stay unless you stop them sooner.'}
                    </p>
                  )}
                </div>
              )}

              {view.outOfStep > 0 && (
                <p className="flex items-start gap-2 text-amber-900">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  {view.outOfStep === 1 ? 'A card no longer matches' : `${view.outOfStep} cards no longer match`} the stay
                  (until {describeKeyEnd(view.booking)}, room {room}). Update {view.outOfStep === 1 ? 'it' : 'them'} at the encoder.
                </p>
              )}

              {confirmLost && (
                <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">
                  <p>
                    New cards replace every card of this stay: once one of them opens the door, all the old ones stop working
                    there, including those the guest still has. Make a card for each one the guest needs.
                  </p>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => cardReq && then(() => promptKeyCards({ ...cardReq, replace: true }))}>Make new cards</Button>
                    <Button size="sm" variant="outline" onClick={() => setConfirmLost(false)}>Not now</Button>
                  </div>
                </div>
              )}

              {!confirmLost && (
                <div className="flex flex-wrap gap-2">
                  {staying && view.hasLock && cardReq && (
                    <Button size="sm" onClick={() => then(() => promptKeyCards(cardReq))}>
                      <CreditCard className="mr-1 h-4 w-4" />{working.length ? 'Make another card' : 'Make cards'}
                    </Button>
                  )}
                  {view.outOfStep > 0 && request && (
                    <Button size="sm" variant="outline" onClick={() => then(() => promptUpdateCards({ bookingId: request.bookingId, guestName: guest, roomNumber: room }))}>
                      <CalendarClock className="mr-1 h-4 w-4" />Update the cards
                    </Button>
                  )}
                  {staying && working.length > 0 && (
                    <Button size="sm" variant="outline" onClick={() => setConfirmLost(true)}>
                      <SearchX className="mr-1 h-4 w-4" />Card lost
                    </Button>
                  )}
                  {view.status === 'checked-in' && request && (
                    <Button size="sm" variant="outline" onClick={() => then(() => promptLateCheckout({ bookingId: request.bookingId, guestName: guest, roomNumber: room }))}>
                      <Clock className="mr-1 h-4 w-4" />Late check-out
                    </Button>
                  )}
                  {staying && working.length > 0 && (
                    <Button size="sm" variant="outline" onClick={() => {
                      try {
                        printCardSleeve({ roomNumber: room, guestName: guest, stay: view.booking, cards: working.length })
                      } catch (e) {
                        toast.error(e instanceof Error ? e.message : 'Could not print')
                      }
                    }}>
                      <Printer className="mr-1 h-4 w-4" />Print the card sleeve
                    </Button>
                  )}
                  {!staying && out.length > 0 && request && (
                    <Button size="sm" variant="outline" onClick={() => then(() => promptCollectCards({ bookingId: request.bookingId, guestName: guest, roomNumber: room }))}>
                      <PackageCheck className="mr-1 h-4 w-4" />Take back the cards
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}

        <DialogFooter>
          <Button variant="outline" onClick={close}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
