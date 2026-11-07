import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, KeyRound, Loader2, RefreshCw } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { db } from '@/lib/db'
import { cardsOutOfStep, subscribeUpdatePrompt, type StayCardsRequest } from '@/services/key-card-prompt'
import { hotelDay, hotelTime, identifyCard, markCard, stayKeyEnd, withinLocks, type KeyCard, type StayTimes } from '@/services/key-cards'
import { OrderRefused, getEncoderPc, prepareCardUpdate, prepareKeyCards, readCard, writeKeyCard, type CardReading } from '@/services/lock-bridge'
import { useHandsFreeRead } from '@/hooks/use-hands-free-read'
import { HandsFreeHint } from '@/components/HandsFreeHint'

/** The stay as it is now: its room, that room's doors, and its check-out day. */
interface Stay {
  roomNumber: string
  doors: string[]
  checkOut: string
  /** When the cards should stop now: check-out, a late check-out or the last paid day (stayKeyEnd). */
  keyEnd: string
}

type Phase =
  | { kind: 'loading' }
  | { kind: 'failed'; message: string }
  | { kind: 'ready' }
  | { kind: 'working'; what: string }
  | { kind: 'done' }

type Note = { tone: 'good' | 'bad'; text: string } | null

/** A card the encoder found that is not one of the guest's, said for the desk. */
function notTheirs(reading: CardReading, guest: string): string {
  switch (reading.kind) {
    case 'none': return reading.message || 'No card on the encoder. Lay one card flat on it, then try again.'
    case 'blank': return `This card is blank. Lay one of ${guest}'s cards on the encoder.`
    case 'staff': return 'This is a staff card. Put it away safely, and lay one of the guest\'s cards on the encoder.'
    case 'otherHotel': return 'This card is not one of this hotel\'s.'
    default: return reading.message || 'This card could not be read. Lay it flat on the encoder and try again.'
  }
}

/**
 * "Update the key cards" after a stay is extended or moves room. Mounted once at
 * the app root. The guest's cards still stop on the old check-out day, or open the
 * old room: one by one, each is read at the encoder and written again so that it
 * matches the stay. An update keeps the card's DAI, so it works alongside the
 * guest's other cards while they wait their turn.
 */
export function UpdateCardsDialog() {
  const [request, setRequest] = useState<StayCardsRequest | null>(null)
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  const [stay, setStay] = useState<Stay | null>(null)
  const [todo, setTodo] = useState<KeyCard[]>([])
  const [updated, setUpdated] = useState<string[]>([])
  const [newEnd, setNewEnd] = useState<string | null>(null)
  const [note, setNote] = useState<Note>(null)
  const closed = useRef<(() => void) | null>(null)
  // What this dialog wrote, so a card laid on the encoder again is known to be done.
  const written = useRef<Array<{ lockNo: string; until: number }>>([])
  const encoderPc = !!getEncoderPc()

  useEffect(() => {
    subscribeUpdatePrompt((req, onClosed) => {
      closed.current?.()
      closed.current = onClosed
      setRequest(req)
      setPhase({ kind: 'loading' })
      setStay(null)
      setTodo([])
      setUpdated([])
      setNewEnd(null)
      setNote(null)
      written.current = []
      void load(req)
    })
    return () => subscribeUpdatePrompt(null)
  }, [])

  async function load(req: StayCardsRequest) {
    try {
      const booking = (await db.bookings.get(req.bookingId)) as (StayTimes & { roomId: string; checkOut: string }) | null
      if (!booking) throw new Error('The booking could not be found.')
      const [locks, rooms, cards] = await Promise.all([
        db.roomLocks.list({ where: { roomId: booking.roomId }, limit: 10 }) as Promise<Array<{ lockNo: string }>>,
        db.rooms.list({ where: { id: booking.roomId }, limit: 1 }) as Promise<Array<{ roomNumber: string }>>,
        cardsOutOfStep(req.bookingId),
      ])
      setStay({ roomNumber: String(rooms[0]?.roomNumber ?? req.roomNumber ?? '?'), doors: locks.map((l) => l.lockNo), checkOut: String(booking.checkOut).slice(0, 10), keyEnd: stayKeyEnd(booking) })
      setTodo(cards)
      setPhase(cards.length ? { kind: 'ready' } : { kind: 'done' })
    } catch (e) {
      setPhase({ kind: 'failed', message: e instanceof Error ? e.message : 'The stay\'s cards could not be loaded.' })
    }
  }

  const busy = phase.kind === 'working'

  function close() {
    if (busy) return
    setRequest(null)
    const done = closed.current
    closed.current = null
    done?.()
  }

  const guest = request?.guestName || todo[0]?.guestName || 'the guest'
  const moved = !!stay && todo.some((c) => !withinLocks(c.lockNos ?? [], stay.doors))
  const left = todo.length - updated.length

  /** Reads the card on the encoder (or takes the one read hands-free), checks it is one of this stay's, and writes it again. */
  async function updateOne(given?: CardReading) {
    if (!request || !stay) return
    setNote(null)
    setPhase({ kind: 'working', what: 'Reading the card…' })
    try {
      const reading = given ?? await readCard()
      if (reading.kind !== 'guest' || !reading.lockNo) {
        setNote({ tone: 'bad', text: notTheirs(reading, guest) })
        return setPhase({ kind: 'ready' })
      }
      const until = reading.validUntil ? Date.parse(reading.validUntil) : NaN
      if (written.current.some((w) => w.lockNo === reading.lockNo?.toUpperCase() && Math.abs(w.until - until) <= 60_000)) {
        setNote({ tone: 'good', text: 'This card is done already. Lay another of the guest\'s cards on the encoder.' })
        return setPhase({ kind: 'ready' })
      }
      const identity = await identifyCard(reading)
      const card = identity.records.find((c) => c.bookingId === request.bookingId && todo.some((t) => t.id === c.id) && !updated.includes(c.id))
      if (!card) {
        const theirs = identity.records.find((c) => c.bookingId === request.bookingId)
        setNote({
          tone: theirs ? 'good' : 'bad',
          text: theirs ? `This is one of ${guest}'s cards, and it already matches the stay. Lay another one on the encoder.`
            : identity.room ? `This card opens room ${identity.room.roomNumber}${identity.records[0]?.guestName ? ` (${identity.records[0].guestName})` : ''}: it is not one of ${guest}'s cards.`
            : `This card is not one of ${guest}'s cards.`,
        })
        return setPhase({ kind: 'ready' })
      }

      const moving = !withinLocks(card.lockNos ?? [], stay.doors)
      if (moving && stay.doors.length > 1) {
        setNote({ tone: 'bad', text: `Room ${stay.roomNumber} has ${stay.doors.length} doors, so this card cannot simply be written over. Make the room's cards with Make cards on the Key cards page, and mark this one returned.` })
        return setPhase({ kind: 'ready' })
      }

      setPhase({ kind: 'working', what: 'Getting the card details…' })
      let prepared
      try {
        prepared = moving ? await prepareKeyCards(request.bookingId, 1) : await prepareCardUpdate(request.bookingId, card.id)
      } catch (e) {
        if (e instanceof OrderRefused && e.upToDate) {
          setUpdated((u) => [...u, card.id])
          setNote({ tone: 'good', text: 'This card already works until the end of the stay. Lay the next one on the encoder.' })
          return setPhase({ kind: 'ready' })
        }
        throw e
      }

      setPhase({ kind: 'working', what: 'Writing the card. Keep it on the encoder.' })
      let result
      try {
        result = await writeKeyCard(prepared, prepared.cardNos[0])
      } catch (e) {
        result = { outcome: 'failed' as const, error: e instanceof Error ? e.message : 'The lock bridge could not be reached.' }
      }
      if (result.outcome !== 'issued') {
        setNote({
          tone: 'bad',
          text: result.outcome === 'unknown'
            ? `${result.error ?? 'Writing was cut off.'} Try the card at the door. It is listed under "Check these cards" on the Key cards page.`
            : `${result.error ?? 'The card was not written.'} Try again.`,
        })
        return setPhase({ kind: 'ready' })
      }

      written.current.push({ lockNo: (moving ? stay.doors[0] : card.lockNos[0]).toUpperCase(), until: Date.parse(prepared.validUntil) })
      setNewEnd(prepared.validUntil)
      try {
        await markCard(card.id, 'erased', moving ? `Written again for room ${stay.roomNumber}.` : `Written again: it works until ${hotelTime(prepared.validUntil)}.`)
      } catch (e) {
        // The card itself is right. The old record stops by itself at its old end time.
        console.warn('[UpdateCards] could not close the old record', e)
      }
      const done = updated.length + 1
      setUpdated((u) => [...u, card.id])
      if (done >= todo.length) return setPhase({ kind: 'done' })
      setNote({ tone: 'good', text: `Done: it opens room ${stay.roomNumber} until ${hotelTime(prepared.validUntil)}. Take it off the encoder.` })
      setPhase({ kind: 'ready' })
    } catch (e) {
      setNote({ tone: 'bad', text: e instanceof Error ? e.message : 'The card could not be updated.' })
      setPhase({ kind: 'ready' })
    }
  }

  // Lay a card down and it is updated: no click (lock bridge 0.1.3+).
  const handsFree = useHandsFreeRead(!!request && encoderPc, phase.kind !== 'ready', (r) => updateOne(r))

  const firstStop = todo.map((c) => c.validUntil).sort()[0]
  const why = stay && (moved
    ? <>{guest} has moved to room {stay.roomNumber}, but {todo.length === 1 ? 'the card still opens' : `${todo.length} cards still open`} room {todo[0]?.roomNumber ?? 'the old room'}.</>
    : stay.keyEnd.slice(0, 10) === stay.checkOut && stay.keyEnd.slice(11, 16) === '12:00'
      ? <>The stay now ends {hotelDay(stay.checkOut)}, but {todo.length === 1 ? 'the card stops' : `${todo.length} cards stop`} {firstStop ? hotelTime(firstStop) : 'sooner'}.</>
      : <>The cards should now work until {hotelTime(stay.keyEnd)}, but {todo.length === 1 ? 'the card stops' : `${todo.length} cards stop`} {firstStop ? hotelTime(firstStop) : 'sooner'}.</>)

  let body: ReactNode = null
  let footer: ReactNode = null
  switch (phase.kind) {
    case 'loading':
      body = <p className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" /> Looking at the stay's cards…</p>
      break
    case 'failed':
      body = <p className="text-sm text-red-700">{phase.message}</p>
      footer = <Button onClick={close}>Close</Button>
      break
    case 'done':
      body = (
        <p className="flex items-start gap-2 text-sm">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
          {todo.length === 0
            ? 'Every card of this stay already matches it.'
            : <>{todo.length === 1 ? 'The card is' : todo.length === 2 ? 'Both cards are' : `All ${todo.length} cards are`} up to date: {todo.length === 1 ? 'it opens' : 'they open'} room {stay?.roomNumber}{newEnd ? ` until ${hotelTime(newEnd)}` : ''}. Hand {todo.length === 1 ? 'it' : 'them'} back to {guest}.</>}
        </p>
      )
      footer = <Button onClick={close}>Done</Button>
      break
    case 'ready':
    case 'working':
      if (!encoderPc) {
        body = (
          <div className="space-y-3 text-sm">
            <p>{why}</p>
            <p className="text-muted-foreground">
              Cards are written at the reception PC with the card encoder. The stay is listed there on the{' '}
              <Link to="/staff/key-cards" className="underline" onClick={close}>Key cards page</Link> under "Update these cards".
            </p>
          </div>
        )
        footer = <Button onClick={close}>OK</Button>
        break
      }
      body = (
        <div className="space-y-3 text-sm">
          <div className="rounded-lg border bg-muted/40 p-3">
            <p>{why}</p>
            <p className="mt-1 font-medium">{updated.length} of {todo.length} updated</p>
          </div>
          {note && (
            <p className={`flex items-start gap-2 ${note.tone === 'good' ? 'text-emerald-800' : 'text-amber-900'}`}>
              {note.tone === 'good' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
              {note.text}
            </p>
          )}
          {phase.kind === 'working'
            ? <p className="flex items-center gap-2 font-medium"><Loader2 className="h-4 w-4 animate-spin" /> {phase.what}</p>
            : <p className="font-medium">Lay {updated.length ? 'another' : 'one'} of {guest}'s cards flat on the encoder{left > 1 ? ` (${left} to go)` : ''}.</p>}
          <HandsFreeHint state={handsFree} what="each of the guest's cards laid on it is updated by itself" />
        </div>
      )
      footer = (
        <>
          <Button variant="outline" disabled={busy} onClick={close}>{updated.length ? 'Stop here' : 'Not now'}</Button>
          <Button disabled={busy} onClick={() => void updateOne()}><RefreshCw className="mr-2 h-4 w-4" />Update this card</Button>
        </>
      )
      break
  }

  return (
    <Dialog open={!!request} onOpenChange={(open) => { if (!open) close() }}>
      <DialogContent
        className="sm:max-w-md"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => { if (busy) e.preventDefault() }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><KeyRound className="h-5 w-5 text-primary" />Update the key cards</DialogTitle>
          <DialogDescription>{stay ? `Room ${stay.roomNumber}` : request?.roomNumber ? `Room ${request.roomNumber}` : ''}{request?.guestName ? ` · ${request.guestName}` : ''}</DialogDescription>
        </DialogHeader>
        {body}
        {footer && <DialogFooter className="gap-2 sm:gap-0">{footer}</DialogFooter>}
      </DialogContent>
    </Dialog>
  )
}
