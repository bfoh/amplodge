import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, CalendarClock, CheckCircle2, CreditCard, DoorOpen, KeyRound, Link2, Loader2, ScanLine, Wrench } from 'lucide-react'
import { format } from 'date-fns'
import { toast } from 'sonner'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { useHandsFreeRead } from '@/hooks/use-hands-free-read'
import { HandsFreeHint } from '@/components/HandsFreeHint'
import { readCard, type CardReading } from '@/services/lock-bridge'
import {
  STATUS_LABEL, hotelDay, identifyCard, markCard, placeDoorCode, recordJoneyCard, saveRoomLocks, staysInRoom,
  type CardIdentity, type CardMark, type DoorPlacement, type KeyCard, type RoomStay,
} from '@/services/key-cards'
import { promptKeyCards, promptUpdateCards } from '@/services/key-card-prompt'
import { logUpkeep } from '@/services/lock-upkeep'
import { useStaffRole } from '@/hooks/use-staff-role'

const when = (d: string | Date) => format(new Date(d), 'EEE d MMM, HH:mm')
/** What key-card-mark lets staff mark returned. */
const RETURNABLE: KeyCard['status'][] = ['issued', 'unknown', 'not_returned', 'replaced', 'locked_out']
const and = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)

type PlaceRoom = DoorPlacement['rooms'][number]

// This PC's choice: read each card as it is laid down. Off until switched on: the page may stay open all day.
const HANDS_FREE_KEY = 'amp.keyCards.readByItself'
const handsFreeChosen = () => { try { return localStorage.getItem(HANDS_FREE_KEY) === '1' } catch { return false } }

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
  const [byItself, setByItself] = useState(handsFreeChosen)
  const { staffRecord } = useStaffRole()
  const [faultLogged, setFaultLogged] = useState<string | null>(null)

  async function read(given?: CardReading) {
    setReading(true)
    try {
      const r = given ?? await readCard()
      setResult({ reading: r, identity: r.kind === 'guest' && r.lockNo ? await identifyCard(r) : null })
      setFaultLogged(null)
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

  /** The card no longer matches its stay (extended, or moved room): write the stay's cards again. */
  async function update(bookingId: string, guestName: string | null) {
    setBusy(true)
    try {
      await promptUpdateCards({ bookingId, guestName })
    } finally {
      setBusy(false)
    }
    // What was read is out of date now: read the card again to see it.
    setResult(null)
    await onChanged()
  }

  /** The card reads fine, but the door refuses it: logged for the lock's upkeep (Key cards → Lock upkeep). */
  async function logFault(roomId: string, roomNumber: string) {
    setBusy(true)
    try {
      await logUpkeep({
        roomId,
        kind: 'fault',
        note: 'A guest card that reads fine at the encoder did not open the door.',
        staffId: staffRecord?.id ?? null,
        staffName: staffRecord?.name ?? null,
      })
      setFaultLogged(roomId)
      toast.success(`Logged for room ${roomNumber}'s lock (Lock upkeep)`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not log it')
    } finally {
      setBusy(false)
    }
  }

  /** A card made in Joney's program can't be updated here: the stay gets new cards from the app, which replace it. */
  async function remake(bookingId: string, guestName: string | null, roomNumber: string) {
    setBusy(true)
    try {
      await promptKeyCards({ bookingId, guestName, roomNumber })
    } finally {
      setBusy(false)
    }
    setResult(null)
    await onChanged()
  }

  /** A card made in Joney's program (the app could not make one): recorded against the stay. */
  async function record(stay: RoomStay, r: CardReading) {
    if (!r.lockNo || !r.validUntil) return
    setBusy(true)
    try {
      const { stopped } = await recordJoneyCard(stay.bookingId, r.lockNo, r.validUntil)
      toast.success(`Recorded as ${stay.guestName}'s card${stopped ? `. ${stopped} older card${stopped === 1 ? '' : 's'} for the door marked as stopping` : ''}`)
      setResult({ reading: r, identity: await identifyCard(r) })
      await onChanged()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not record the card')
    } finally {
      setBusy(false)
    }
  }

  const handsFree = useHandsFreeRead(byItself, reading || busy, (r) => read(r))
  function chooseByItself(on: boolean) {
    setByItself(on)
    try { localStorage.setItem(HANDS_FREE_KEY, on ? '1' : '0') } catch { /* kept for this visit only */ }
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
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Button variant="outline" disabled={reading || busy} onClick={() => void read()}>
            {reading ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <ScanLine className="w-4 h-4 mr-1" />}
            {reading ? 'Reading…' : result ? 'Read another card' : 'Read the card'}
          </Button>
          {handsFree.supported && (
            <div className="flex items-center gap-2">
              <Switch id="read-by-itself" checked={byItself} onCheckedChange={chooseByItself} />
              <Label htmlFor="read-by-itself" className="font-normal">Read each card as it is laid down</Label>
            </div>
          )}
        </div>
        <HandsFreeHint state={handsFree} />
        {result && !reading && (
          <div role="status" className="rounded-lg border p-4 text-sm space-y-2">
            {'error' in result
              ? <Warn>{result.error}</Warn>
              : <Described reading={result.reading} identity={result.identity} isAdmin={isAdmin} busy={busy} mark={mark} place={place} update={update} remake={remake} record={record} logFault={logFault} faultLogged={faultLogged} />}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

const Warn = ({ children }: { children: ReactNode }) => (
  <p className="flex items-start gap-2 text-amber-900"><AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />{children}</p>
)

function Described({ reading, identity, isAdmin, busy, mark, place, update, remake, record, logFault, faultLogged }: {
  reading: CardReading
  identity: CardIdentity | null
  isAdmin: boolean
  busy: boolean
  mark: (card: KeyCard, status: CardMark, r: CardReading) => void
  place: (room: PlaceRoom, lockNo: string, replace: boolean, r: CardReading) => void
  update: (bookingId: string, guestName: string | null) => void
  remake: (bookingId: string, guestName: string | null, roomNumber: string) => void
  record: (stay: RoomStay, r: CardReading) => void
  logFault: (roomId: string, roomNumber: string) => void
  faultLogged: string | null
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

  const { room, validUntil, expired, records, newer, madeInJoney, lockNo, stay } = identity
  const first = records[0]
  const out = records.find((c) => RETURNABLE.includes(c.status))
  const cutOff = records.length === 1 && first.status === 'unknown' && !expired
  // Why a card of a stay still under way may not open the door, and the fix.
  const staying = stay?.status === 'checked-in'
  const theirs = staying ? records.find((c) => c.bookingId === stay.bookingId && ['issued', 'unknown'].includes(c.status)) : undefined
  const moved = !!theirs && !!room && stay!.roomId !== room.roomId
  const short = !!theirs && !moved && !!validUntil && validUntil.getTime() < Date.parse(stay!.keyEnd) - 60_000
  const fine = !expired && !newer && !!room && !moved && !short && (staying || madeInJoney || first?.kind === 'lockout')
  const guest = theirs?.guestName ?? 'The guest'

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
      {theirs && (short || moved) && !newer && (
        <div className="space-y-2">
          <Warn>
            {moved
              ? <>{guest} has moved to room {stay!.roomNumber}, but this card still opens room {room!.roomNumber}.</>
              : <>{guest}'s cards should work until {when(stay!.keyEnd)}, but this card {expired ? 'has stopped' : `stops ${when(validUntil!)}`}.</>}
          </Warn>
          {theirs.dai === 0 ? (
            <Button size="sm" disabled={busy} onClick={() => remake(stay!.bookingId, theirs.guestName, stay!.roomNumber)}>
              <CreditCard className="w-4 h-4 mr-1" /> Make new cards for the stay
            </Button>
          ) : (
            <Button size="sm" disabled={busy} onClick={() => update(stay!.bookingId, theirs.guestName)}>
              {moved ? <KeyRound className="w-4 h-4 mr-1" /> : <CalendarClock className="w-4 h-4 mr-1" />}
              {moved ? `Write it for room ${stay!.roomNumber}` : 'Update this card'}
            </Button>
          )}
        </div>
      )}
      {fine && (
        <div className="space-y-2">
          <p className="text-muted-foreground">
            If it still does not open the door, the lock itself may be the trouble: hold a staff card to it. If the lock refuses
            that too, it needs new batteries, or its clock set with the clock card from Joney's program.
          </p>
          {room && (faultLogged === room.roomId
            ? <p className="flex items-center gap-2 text-emerald-700"><CheckCircle2 className="w-4 h-4" />Logged under Lock upkeep.</p>
            : (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => logFault(room.roomId, room.roomNumber)}>
                <Wrench className="w-4 h-4 mr-1" /> The door refused it: log it for the lock
              </Button>
            ))}
        </div>
      )}
      {newer && !expired && (
        <Warn>
          A newer card was made for this door on {when(newer.createdAt)}
          {newer.kind === 'lockout' ? ' (a lock-out card)' : newer.guestName ? ` (${newer.guestName})` : ''}. Once that one
          has been used at the door, the lock refuses this card.
        </Warn>
      )}
      {madeInJoney && !first && room && validUntil && !expired && (
        <RecordJoney roomId={room.roomId} roomNumber={room.roomNumber} busy={busy} onRecord={(st) => record(st, reading)} />
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

/**
 * A card made in Joney's program while the app could not make one (no internet): recorded
 * against the stay in its room, so it is collected at check-out like the app's cards.
 */
function RecordJoney({ roomId, roomNumber, busy, onRecord }: { roomId: string; roomNumber: string; busy: boolean; onRecord: (stay: RoomStay) => void }) {
  const [stays, setStays] = useState<RoomStay[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [chosen, setChosen] = useState('')

  useEffect(() => {
    let alive = true
    setStays(null)
    staysInRoom(roomId)
      .then((s) => { if (alive) setStays(s) })
      .catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [roomId])

  if (failed) return <Warn>The stays in room {roomNumber} could not be loaded.</Warn>
  if (!stays) return <p className="flex items-center gap-2 text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" />Looking for the stay in room {roomNumber}…</p>
  if (!stays.length) return <p className="text-muted-foreground">No guest is staying in room {roomNumber} today, so there is no stay to record it against.</p>

  const stay = stays.find((s) => s.bookingId === chosen) ?? (stays.length === 1 ? stays[0] : undefined)
  return (
    <div className="space-y-2 rounded-md bg-muted/40 p-3">
      <p className="flex items-center gap-2 font-medium"><Link2 className="w-4 h-4" />Record it against the stay</p>
      <p className="text-muted-foreground">
        For a card made in Joney's program while this app could not make one. Once recorded, it is collected at check-out like the app's cards.
      </p>
      {stays.length > 1 && (
        <Select value={chosen} onValueChange={setChosen}>
          <SelectTrigger className="w-full sm:w-72" aria-label="The stay this card is for"><SelectValue placeholder="Whose card is it?" /></SelectTrigger>
          <SelectContent>
            {stays.map((s) => <SelectItem key={s.bookingId} value={s.bookingId}>{s.guestName} · until {hotelDay(s.checkOut)}</SelectItem>)}
          </SelectContent>
        </Select>
      )}
      {stay && stay.appCards > 0 && (
        <Warn>
          {stay.guestName} has {stay.appCards === 1 ? 'a card' : `${stay.appCards} cards`} from this app. This card has another code (DAI): once it
          opens the door, the lock refuses the app's cards. Record it only if the guest is to use this one.
        </Warn>
      )}
      <Button size="sm" disabled={!stay || busy} onClick={() => stay && onRecord(stay)}>
        <Link2 className="w-4 h-4 mr-1" /> {stay ? `Record it as ${stay.guestName}'s card` : 'Record it'}
      </Button>
    </div>
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
