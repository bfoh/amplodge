import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, CalendarClock, CreditCard, KeyRound, Loader2, PackageCheck, SearchX } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { db } from '@/lib/db'
import {
  cardsOutOfStep, promptCollectCards, promptKeyCards, promptUpdateCards, subscribeStayPrompt,
  type KeyCardRequest, type StayCardsRequest,
} from '@/services/key-card-prompt'
import { STATUS_LABEL, canOpenDoor, hotelDay, hotelTime, loadStayCards, type KeyCard } from '@/services/key-cards'

interface StayView {
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
      const b = (await db.bookings.get(req.bookingId)) as { roomId: string; status: string; checkIn: string; checkOut: string } | null
      if (!b) throw new Error('The booking could not be found.')
      const [rooms, locks, cards, behind] = await Promise.all([
        db.rooms.list({ where: { id: b.roomId }, limit: 1 }) as Promise<Array<{ roomNumber: string }>>,
        db.roomLocks.list({ where: { roomId: b.roomId }, limit: 10 }) as Promise<unknown[]>,
        loadStayCards(req.bookingId),
        cardsOutOfStep(req.bookingId),
      ])
      setView({
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

              {view.outOfStep > 0 && (
                <p className="flex items-start gap-2 text-amber-900">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  {view.outOfStep === 1 ? 'A card no longer matches' : `${view.outOfStep} cards no longer match`} the stay
                  (check-out {hotelDay(view.checkOut)}, room {room}). Update {view.outOfStep === 1 ? 'it' : 'them'} at the encoder.
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
