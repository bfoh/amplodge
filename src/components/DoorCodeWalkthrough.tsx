import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, DoorOpen, Loader2, ScanLine, SkipForward } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { doorsOf, loadDoorRooms, saveRoomLocks, type DoorPlacement } from '@/services/key-cards'
import { readCard, type CardReading } from '@/services/lock-bridge'
import { useHandsFreeRead, type HandsFreeAnswer } from '@/hooks/use-hands-free-read'
import { HandsFreeHint } from '@/components/HandsFreeHint'

type DoorRoom = DoorPlacement['rooms'][number]
type Note = { tone: 'good' | 'bad'; text: string } | null

/** A room still short of door codes: one per door ("110+109" has two). */
const missing = (r: DoorRoom) => r.locks.length < doorsOf(r.roomNumber)

/**
 * Door-code setup, room by room, at the reception PC (admins). Joney's program
 * numbers doors in the order the locks were set up, not by room number, so each
 * room's code is read from a card made for it in Joney's program: the walk-through
 * names the next room without a code, reads the card laid on the encoder, and
 * saves the code to that room in one click.
 */
export function DoorCodesCard({ onChanged }: { onChanged: () => void | Promise<void> }) {
  const [rooms, setRooms] = useState<DoorRoom[] | null>(null)
  const [open, setOpen] = useState(false)

  const load = useCallback(async () => {
    try { setRooms(await loadDoorRooms()) } catch { setRooms(null) }
  }, [])
  useEffect(() => { void load() }, [load])

  const short = rooms?.filter(missing) ?? []
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-lg"><DoorOpen className="w-5 h-5 text-primary" />Door codes</CardTitle>
        <CardDescription>
          {!rooms ? 'Counting the rooms…'
            : short.length === 0 ? 'Every room has its door code.'
            : `${short.length} of ${rooms.length} rooms have no door code yet. Go through them one by one: make a card for the room in Joney's program, lay it on the encoder, save.`}
        </CardDescription>
      </CardHeader>
      {short.length > 0 && (
        <CardContent>
          <Button variant="outline" onClick={() => setOpen(true)}><ScanLine className="w-4 h-4 mr-1" />Set up door codes</Button>
        </CardContent>
      )}
      <DoorCodeWalkthrough open={open} onOpenChange={(o) => { setOpen(o); if (!o) { void load(); void onChanged() } }} />
    </Card>
  )
}

export function DoorCodeWalkthrough({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [rooms, setRooms] = useState<DoorRoom[] | null>(null)
  const [skipped, setSkipped] = useState<string[]>([])
  const [found, setFound] = useState<string | null>(null)
  const [target, setTarget] = useState('')
  const [busy, setBusy] = useState<'read' | 'save' | null>(null)
  const [note, setNote] = useState<Note>(null)

  useEffect(() => {
    if (!open) return
    setSkipped([]); setFound(null); setNote(null); setRooms(null)
    loadDoorRooms().then(setRooms, () => setNote({ tone: 'bad', text: 'The rooms could not be loaded.' }))
  }, [open])

  const current = rooms?.find((r) => missing(r) && !skipped.includes(r.roomId)) ?? null
  const short = rooms?.filter(missing) ?? []
  const done = rooms ? rooms.length - short.length : 0

  /** Reads the card on the encoder (or takes the one read hands-free). "again": a blank card, to be looked at again once Joney's program has written it. */
  async function read(given?: CardReading): Promise<HandsFreeAnswer> {
    if (!rooms || !current) return
    setBusy('read'); setNote(null); setFound(null)
    try {
      const r = given ?? await readCard()
      if (r.kind !== 'guest' || !r.lockNo) {
        setNote({
          tone: 'bad',
          text: r.kind === 'none' ? (r.message || 'No card on the encoder. Lay the card flat on it, then read again.')
            : r.kind === 'blank' ? `This card is blank. In Joney's program, make a guest card for room ${current.roomNumber} first.`
            : r.kind === 'staff' ? 'This is a staff card: it opens many doors, so it tells no room\'s code. Use a guest card made for the room.'
            : 'This card is not one of this hotel\'s guest cards.',
        })
        return r.kind === 'blank' ? 'again' : undefined
      }
      const code = r.lockNo.toUpperCase()
      const owner = rooms.find((x) => x.locks.some((l) => l.lockNo === code))
      if (owner) {
        setNote(owner.roomId === current.roomId
          ? { tone: 'good', text: `Room ${owner.roomNumber} has this code already.` }
          : { tone: 'bad', text: `This card opens room ${owner.roomNumber}, which has its code (${code}) already. Lay room ${current.roomNumber}'s card on the encoder.` })
        return
      }
      setFound(code)
      setTarget(current.roomId)
    } catch (e) {
      setNote({ tone: 'bad', text: e instanceof Error ? e.message : 'The card could not be read.' })
    } finally {
      setBusy(null)
    }
  }

  async function save() {
    const room = rooms?.find((r) => r.roomId === target)
    if (!room || !found) return
    setBusy('save')
    try {
      await saveRoomLocks(room.roomId, [...room.locks.map((l) => ({ lockNo: l.lockNo, label: l.label })), { lockNo: found }])
      toast.success(`Room ${room.roomNumber}: door code ${found} saved`)
      const fresh = await loadDoorRooms()
      setRooms(fresh)
      const after = fresh.find((r) => r.roomId === room.roomId)
      setNote({
        tone: 'good',
        text: after && missing(after)
          ? `Saved. Room ${room.roomNumber} has another door: lay a card made for that door on the encoder.`
          : `Saved to room ${room.roomNumber}. Try the card at its door when you pass: it should open.`,
      })
      setFound(null)
    } catch (e) {
      setNote({ tone: 'bad', text: e instanceof Error ? e.message : 'The code could not be saved.' })
    } finally {
      setBusy(null)
    }
  }

  function skip() {
    if (!current) return
    setSkipped((s) => [...s, current.roomId])
    setFound(null); setNote(null)
  }

  // Lay the room's card down and it is read: no click (lock bridge 0.1.3+). A blank card is
  // watched until Joney's program has written it.
  const handsFree = useHandsFreeRead(open && !!rooms, !!busy || !!found || !current, (r) => read(r))

  const skippedRooms = rooms?.filter((r) => skipped.includes(r.roomId) && missing(r)) ?? []
  const doors = current ? doorsOf(current.roomNumber) : 1

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o) }}>
      <DialogContent className="sm:max-w-md" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><DoorOpen className="h-5 w-5 text-primary" />Set up door codes</DialogTitle>
          <DialogDescription>{rooms ? `${done} of ${rooms.length} rooms have their codes` : 'Loading the rooms…'}</DialogDescription>
        </DialogHeader>

        {!rooms ? (
          note ? <p className="text-sm text-red-700">{note.text}</p> : <p className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" /> Loading the rooms…</p>
        ) : !current ? (
          <div className="space-y-2 text-sm">
            {note && <p className="flex items-start gap-2 text-emerald-800"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />{note.text}</p>}
            <p className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              {skippedRooms.length ? `Done, except the rooms you skipped: ${skippedRooms.map((r) => r.roomNumber).join(', ')}.` : 'Every room has its door code.'}
            </p>
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            <div className="rounded-lg border bg-muted/40 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-base font-semibold">Room {current.roomNumber}</span>
                <Button size="sm" variant="ghost" className="h-7 px-2" disabled={!!busy} onClick={skip}>
                  <SkipForward className="mr-1 h-4 w-4" />Skip
                </Button>
              </div>
              <p className="text-muted-foreground">
                {doors > 1
                  ? `It has ${doors} doors (door ${current.locks.length + 1} of ${doors}). In Joney's program, make a guest card for this door, then lay it flat on the encoder.`
                  : 'In Joney\'s program, make a guest card for this room (any dates), then lay it flat on the encoder.'}
              </p>
            </div>
            {!found && <HandsFreeHint state={handsFree} />}
            {note && (
              <p className={`flex items-start gap-2 ${note.tone === 'good' ? 'text-emerald-800' : 'text-amber-900'}`}>
                {note.tone === 'good' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
                {note.text}
              </p>
            )}
            {found && (
              <div className="space-y-2 rounded-lg border p-3">
                <p>The card opens door <strong>{found}</strong>, which no room has yet. Save it to:</p>
                <div className="flex flex-wrap items-center gap-2">
                  <Select value={target} onValueChange={setTarget}>
                    <SelectTrigger className="w-full sm:w-48" aria-label="Room for this door code"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {short.map((r) => <SelectItem key={r.roomId} value={r.roomId}>Room {r.roomNumber}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Button size="sm" disabled={!!busy} onClick={() => void save()}>
                    {busy === 'save' && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Save to room {rooms.find((r) => r.roomId === target)?.roomNumber}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" disabled={!!busy} onClick={() => onOpenChange(false)}>{current ? 'Stop here' : 'Done'}</Button>
          {current && !found && (
            <Button disabled={!!busy} onClick={() => void read()}>
              {busy === 'read' ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <ScanLine className="mr-1 h-4 w-4" />}Read the card
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
