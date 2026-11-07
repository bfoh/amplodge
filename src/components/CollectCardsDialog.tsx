import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, DoorClosed, KeyRound, Loader2, ScanLine, UserX } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cardsOut, promptLockoutCard, subscribeCollectPrompt, type StayCardsRequest } from '@/services/key-card-prompt'
import { STATUS_LABEL, hotelTime, identifyCard, loadStayCards, markCard, type KeyCard } from '@/services/key-cards'
import { getEncoderPc, readCard, type CardReading } from '@/services/lock-bridge'
import { useHandsFreeRead } from '@/hooks/use-hands-free-read'
import { HandsFreeHint } from '@/components/HandsFreeHint'
import { CardFeeOffer } from '@/components/CardFeeOffer'

type Note = { tone: 'good' | 'bad'; text: string } | null

/**
 * "Take back the key cards" after a check-out. Mounted once at the app root.
 * Each card the guest hands back is laid on the encoder and marked returned by
 * reading it, or marked by hand. A card the guest kept still opens the door
 * until its end time, so this offers a lock-out card for the door.
 */
export function CollectCardsDialog() {
  const [request, setRequest] = useState<StayCardsRequest | null>(null)
  const [cards, setCards] = useState<KeyCard[] | null>(null)
  const [kept, setKept] = useState<KeyCard[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<Note>(null)
  const [failed, setFailed] = useState<string | null>(null)
  // Cards marked as kept by the guest here: the card fee is offered for them.
  const [keptNow, setKeptNow] = useState(0)
  const closed = useRef<(() => void) | null>(null)
  const encoderPc = !!getEncoderPc()

  useEffect(() => {
    subscribeCollectPrompt((req, onClosed) => {
      closed.current?.()
      closed.current = onClosed
      setRequest(req)
      setCards(null)
      setKept([])
      setNote(null)
      setFailed(null)
      setKeptNow(0)
      void refresh(req.bookingId)
    })
    return () => subscribeCollectPrompt(null)
  }, [])

  async function refresh(bookingId: string) {
    try {
      const [out, all] = await Promise.all([cardsOut(bookingId), loadStayCards(bookingId)])
      setCards(out)
      setKept(all.filter((c) => c.status === 'not_returned' && new Date(c.validUntil) > new Date()))
    } catch (e) {
      setFailed(e instanceof Error ? e.message : 'The stay\'s cards could not be loaded.')
    }
  }

  function close() {
    if (busy) return
    setRequest(null)
    const done = closed.current
    closed.current = null
    done?.()
  }

  async function mark(card: KeyCard, status: 'returned' | 'not_returned', how?: string) {
    if (!request) return
    setBusy(card.id)
    try {
      await markCard(card.id, status, how)
      if (status === 'not_returned') setKeptNow((n) => n + 1)
      setNote({ tone: 'good', text: status === 'returned' ? 'A card is marked returned.' : 'A card is marked as kept by the guest.' })
      await refresh(request.bookingId)
    } catch (e) {
      setNote({ tone: 'bad', text: e instanceof Error ? e.message : 'Could not update the card.' })
    } finally {
      setBusy(null)
    }
  }

  /** Reads the card on the encoder (or takes the one read hands-free) and, if it is one of this stay's, marks it returned. */
  async function readReturned(given?: CardReading) {
    if (!request || !cards) return
    setBusy('read')
    setNote(null)
    try {
      const reading = given ?? await readCard()
      if (reading.kind !== 'guest' || !reading.lockNo) {
        setNote({
          tone: 'bad',
          text: reading.kind === 'none' ? (reading.message || 'No card on the encoder. Lay one card flat on it, then read again.')
            : reading.kind === 'blank' ? 'This card is blank: it is not one of the guest\'s. Mark their cards by hand below if they are blank.'
            : 'This is not one of the guest\'s cards.',
        })
        return
      }
      const identity = await identifyCard(reading)
      const card = identity.records.find((c) => c.bookingId === request.bookingId && cards.some((o) => o.id === c.id))
      if (!card) {
        const theirs = identity.records.some((c) => c.bookingId === request.bookingId)
        setNote({
          tone: theirs ? 'good' : 'bad',
          text: theirs ? 'This card is marked already. Lay the next one on the encoder.'
            : identity.room ? `This card opens room ${identity.room.roomNumber}${identity.records[0]?.guestName ? ` (${identity.records[0].guestName})` : ''}: it is not one of this stay's cards.`
            : 'This app has no record of this card: it is not one of this stay\'s cards.',
        })
        return
      }
      setBusy(null)
      await mark(card, 'returned', 'Read back at check-out')
    } catch (e) {
      setNote({ tone: 'bad', text: e instanceof Error ? e.message : 'The card could not be read.' })
    } finally {
      setBusy(null)
    }
  }

  const room = cards?.[0]?.roomNumber ?? kept[0]?.roomNumber ?? request?.roomNumber ?? '?'
  const guest = request?.guestName || cards?.[0]?.guestName || 'The guest'
  const doorRoomId = kept[0]?.roomId ?? null
  const lastEnd = kept.map((c) => c.validUntil).sort().at(-1)

  function lockOut() {
    if (!doorRoomId) return
    close()
    void promptLockoutCard(doorRoomId, room)
  }

  const allIn = cards !== null && cards.length === 0
  // Lay a returned card down and it is marked: no click (lock bridge 0.1.3+).
  const handsFree = useHandsFreeRead(!!request && encoderPc, !!busy || cards === null || allIn || !!failed, (r) => readReturned(r))

  return (
    <Dialog open={!!request} onOpenChange={(open) => { if (!open) close() }}>
      <DialogContent className="sm:max-w-md" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><KeyRound className="h-5 w-5 text-primary" />Take back the key cards</DialogTitle>
          <DialogDescription>Room {room} · {guest}</DialogDescription>
        </DialogHeader>

        {failed ? <p className="text-sm text-red-700">{failed}</p>
          : cards === null ? <p className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" /> Looking at the stay's cards…</p>
          : (
            <div className="space-y-3 text-sm">
              {!allIn && (
                <p>
                  {cards.length === 1 ? 'One card is' : `${cards.length} cards are`} still out. Ask for {cards.length === 1 ? 'it' : 'them'} back:
                  {' '}{cards.length === 1 ? 'it opens' : 'they open'} room {room} until {hotelTime(cards.map((c) => c.validUntil).sort().at(-1)!)}.
                  {encoderPc && ' Lay each card on the encoder and read it, or mark it below.'}
                </p>
              )}
              {encoderPc && !allIn && (
                <Button variant="outline" disabled={!!busy} onClick={() => void readReturned()}>
                  {busy === 'read' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ScanLine className="mr-2 h-4 w-4" />}
                  {busy === 'read' ? 'Reading…' : 'Read a returned card'}
                </Button>
              )}
              {encoderPc && !allIn && <HandsFreeHint state={handsFree} what="each returned card laid on it is marked by itself" />}
              {note && (
                <p className={`flex items-start gap-2 ${note.tone === 'good' ? 'text-emerald-800' : 'text-amber-900'}`}>
                  {note.tone === 'good' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
                  {note.text}
                </p>
              )}
              {cards.length > 0 && (
                <ul className="divide-y rounded-lg border">
                  {cards.map((c, i) => (
                    <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                      <span>Card {i + 1} <Badge variant="outline" className="ml-1">{STATUS_LABEL[c.status]}</Badge></span>
                      <span className="flex gap-2">
                        <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void mark(c, 'returned')}>
                          <CheckCircle2 className="mr-1 h-4 w-4" />Returned
                        </Button>
                        <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void mark(c, 'not_returned')}>
                          <UserX className="mr-1 h-4 w-4" />Guest kept it
                        </Button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {allIn && kept.length === 0 && (
                <p className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />Every card is back.</p>
              )}
              {request && keptNow > 0 && <CardFeeOffer bookingId={request.bookingId} why="kept" cards={keptNow} stillStaying={false} />}
              {kept.length > 0 && (
                <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">
                  <p>
                    {kept.length === 1 ? 'A card the guest kept still opens' : `${kept.length} cards the guest kept still open`} room {room}
                    {lastEnd ? ` until ${hotelTime(lastEnd)}` : ''}. The next guest's card stops {kept.length === 1 ? 'it' : 'them'} the
                    first time it opens the door. To stop {kept.length === 1 ? 'it' : 'them'} now, make a lock-out card and hold it to the lock once.
                  </p>
                  {encoderPc && doorRoomId && (
                    <Button size="sm" variant="outline" disabled={!!busy} onClick={lockOut}>
                      <DoorClosed className="mr-1 h-4 w-4" />Make a lock-out card
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant={allIn ? 'default' : 'outline'} disabled={!!busy} onClick={close}>{allIn || failed ? 'Done' : 'Later'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
