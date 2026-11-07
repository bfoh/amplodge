import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, DoorOpen, Loader2, ScanLine } from 'lucide-react'
import { format } from 'date-fns'
import { toast } from 'sonner'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { readCard, type CardReading } from '@/services/lock-bridge'
import {
  STATUS_LABEL, identifyCard, markCard, placeDoorCode, saveRoomLocks,
  type CardIdentity, type CardMark, type DoorPlacement, type KeyCard,
} from '@/services/key-cards'

const when = (d: string | Date) => format(new Date(d), 'EEE d MMM, HH:mm')
/** What key-card-mark lets staff mark returned. */
const RETURNABLE: KeyCard['status'][] = ['issued', 'unknown', 'not_returned', 'replaced', 'locked_out']
const and = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)

type PlaceRoom = DoorPlacement['rooms'][number]

type Result =
  | { error: string }
  | { reading: CardReading; identity: CardIdentity | null }

/**
 * Read a card at the reception PC: which door it opens, until when, and whose it
 * is by our records. Reading writes nothing. The bridge tells only that much,
 * never the card's data, and nothing of a staff card but its kind.
 */
export function ReadCardPanel({ isAdmin, onChanged }: { isAdmin: boolean; onChanged: () => void | Promise<void> }) {
  const [reading, setReading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<Result | null>(null)

  async function read() {
    setReading(true)
    try {
      const r = await readCard()
      setResult({ reading: r, identity: r.kind === 'guest' && r.lockNo ? await identifyCard(r) : null })
    } catch (e) {
      setResult({ error: e instanceof Error ? e.message : 'The card could not be read.' })
    } finally {
      setReading(false)
    }
  }

  async function mark(card: KeyCard, status: CardMark, r: CardReading) {
    setBusy(true)
    try {
      await markCard(card.id, status, status === 'issued' ? 'Read back at the encoder' : undefined)
      toast.success(`Room ${card.roomNumber ?? '?'}, card ${card.cardNo + 1}: ${STATUS_LABEL[status].toLowerCase()}`)
      setResult({ reading: r, identity: await identifyCard(r) })
      await onChanged()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update the card')
    } finally {
      setBusy(false)
    }
  }

  /** Saves a door code read from a card to its room: added to the room's codes, or in place of them. */
  async function place(room: PlaceRoom, lockNo: string, replace: boolean, r: CardReading) {
    setBusy(true)
    try {
      const keep = replace ? [] : room.locks.map((l) => ({ lockNo: l.lockNo, label: l.label }))
      await saveRoomLocks(room.roomId, [...keep, { lockNo }])
      toast.success(`Room ${room.roomNumber}: door code ${lockNo} saved`)
      setResult({ reading: r, identity: await identifyCard(r) })
      await onChanged()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save the door code')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-lg"><ScanLine className="w-5 h-5 text-primary" />Read a card</CardTitle>
        <CardDescription>
          Lay a card flat on the encoder to see which door it opens, until when, and whose it is. Reading writes nothing on the card.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button variant="outline" disabled={reading || busy} onClick={() => void read()}>
          {reading ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <ScanLine className="w-4 h-4 mr-1" />}
          {reading ? 'Reading…' : result ? 'Read another card' : 'Read the card'}
        </Button>
        {result && !reading && (
          <div role="status" className="rounded-lg border p-4 text-sm space-y-2">
            {'error' in result
              ? <Warn>{result.error}</Warn>
              : <Described reading={result.reading} identity={result.identity} isAdmin={isAdmin} busy={busy} mark={mark} place={place} />}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

const Warn = ({ children }: { children: ReactNode }) => (
  <p className="flex items-start gap-2 text-amber-900"><AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />{children}</p>
)

function Described({ reading, identity, isAdmin, busy, mark, place }: {
  reading: CardReading
  identity: CardIdentity | null
  isAdmin: boolean
  busy: boolean
  mark: (card: KeyCard, status: CardMark, r: CardReading) => void
  place: (room: PlaceRoom, lockNo: string, replace: boolean, r: CardReading) => void
}) {
  switch (reading.kind) {
    case 'none':
      return <Warn>{reading.message || 'No card on the encoder. Lay one card flat on it, then read again.'}</Warn>
    case 'blank':
      return <p>A blank card. It opens no door, and can be used for a guest.</p>
    case 'otherHotel':
      return <p>A guest card, but not one of this hotel's: it opens none of our doors.</p>
    case 'staff':
      return <p>A staff or setup card: <strong>{reading.staffType || 'a staff card'}</strong>. These are made and kept in Joney's program; this app does not change them.</p>
    case 'unknown':
      return <Warn>{reading.message || 'This card could not be made sense of.'}</Warn>
  }
  if (!identity) return <Warn>A guest card, but its door could not be read.</Warn>

  const { room, validUntil, expired, records, newer, madeInJoney, lockNo } = identity
  const first = records[0]
  const out = records.find((c) => RETURNABLE.includes(c.status))
  const cutOff = records.length === 1 && first.status === 'unknown' && !expired

  return (
    <>
      <p className="text-base font-semibold">
        {room ? <>Opens room {room.roomNumber}{room.label ? ` (${room.label})` : ''}</> : <>Opens door {lockNo}, which no room has</>}
      </p>
      <p className={expired ? 'text-muted-foreground' : ''}>
        {!validUntil ? 'Its end time could not be read.'
          : expired ? `Expired ${when(validUntil)}: it opens no door any more.`
          : `Opens the door until ${when(validUntil)}.`}
      </p>

      {first ? (
        <div className="space-y-1">
          <p>
            {first.kind === 'lockout'
              ? <>A lock-out card, made {when(first.createdAt)}.</>
              : <>{first.guestName ?? 'A guest'}'s card, made {when(first.createdAt)}.</>}
            {records.length > 1 && ` One of ${records.length} cards made alike for this stay.`}
          </p>
          <div className="flex flex-wrap gap-2">
            {records.map((c) => (
              <Badge key={c.id} variant="outline">Card {c.cardNo + 1}: {STATUS_LABEL[c.status]}</Badge>
            ))}
          </div>
        </div>
      ) : madeInJoney ? (
        <p>Made in Joney's program, not in this app, so there is no record of it here.</p>
      ) : (
        <p>This app has no record of this card.</p>
      )}

      {cutOff && <p>Its writing was cut off, but it reads back as it should: it works.</p>}
      {newer && !expired && (
        <Warn>
          A newer card was made for this door on {when(newer.createdAt)}
          {newer.kind === 'lockout' ? ' (a lock-out card)' : newer.guestName ? ` (${newer.guestName})` : ''}. Once that one
          has been used at the door, the lock refuses this card.
        </Warn>
      )}
      {!room && (isAdmin
        ? <PlaceDoor lockNo={lockNo} busy={busy} onPlace={(r, replace) => place(r, lockNo, replace, reading)} />
        : (
          <p className="text-muted-foreground">
            If this is one of our doors, an admin can read this card here to add its code (<strong>{lockNo}</strong>) to the room.
          </p>
        ))}

      {(out || cutOff) && (
        <div className="flex flex-wrap gap-2 pt-1">
          {cutOff && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => mark(first, 'issued', reading)}>
              <CheckCircle2 className="w-4 h-4 mr-1" /> Mark it working
            </Button>
          )}
          {out && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => mark(out, 'returned', reading)}>
              <CheckCircle2 className="w-4 h-4 mr-1" /> Mark returned
            </Button>
          )}
        </div>
      )}
    </>
  )
}

/** An admin adds a door code read from a card to its room, with the likely room chosen already. */
function PlaceDoor({ lockNo, busy, onPlace }: { lockNo: string; busy: boolean; onPlace: (room: PlaceRoom, replace: boolean) => void }) {
  const [placement, setPlacement] = useState<DoorPlacement | null>(null)
  const [failed, setFailed] = useState(false)
  const [roomId, setRoomId] = useState('')

  useEffect(() => {
    let alive = true
    setPlacement(null)
    placeDoorCode(lockNo)
      .then((p) => { if (alive) { setPlacement(p); setRoomId(p.suggested ?? '') } })
      .catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [lockNo])

  if (failed) return <Warn>The rooms could not be loaded. Add the code {lockNo} on the <Link to="/staff/properties" className="underline">Rooms page</Link>.</Warn>
  if (!placement) return <p className="flex items-center gap-2 text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" />Loading the rooms…</p>

  const target = placement.rooms.find((r) => r.roomId === roomId)
  const has = target?.locks.map((l) => l.lockNo) ?? []
  return (
    <div className="space-y-2 rounded-md bg-muted/40 p-3">
      <p className="flex items-center gap-2 font-medium"><DoorOpen className="w-4 h-4" />Add door {lockNo} to its room</p>
      <p className="text-muted-foreground">
        {placement.suggested && roomId === placement.suggested
          ? <>Room {target?.roomNumber} is suggested: its code would follow the pattern of room{placement.basis.length > 1 ? 's' : ''} {and(placement.basis)}. Check it is the room the card was made for.</>
          : 'Choose the room the card was made for.'}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={roomId} onValueChange={setRoomId}>
          <SelectTrigger className="w-full sm:w-64" aria-label="Room for this door">
            <SelectValue placeholder="Choose a room" />
          </SelectTrigger>
          <SelectContent>
            {placement.rooms.map((r) => (
              <SelectItem key={r.roomId} value={r.roomId}>
                Room {r.roomNumber}{r.locks.length ? ` · has ${r.locks.map((l) => l.lockNo).join(', ')}` : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {target && !has.length && (
          <Button size="sm" disabled={busy} onClick={() => onPlace(target, false)}>Add to room {target.roomNumber}</Button>
        )}
        {target && has.length > 0 && (
          <>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => onPlace(target, true)}>Replace {has.join(', ')}</Button>
            {has.length < 4 && (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => onPlace(target, false)}>Add as another door</Button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
