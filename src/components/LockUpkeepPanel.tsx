import { useCallback, useEffect, useRef, useState } from 'react'
import { BatteryLow, Clock, Loader2, Plus, Wrench } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useStaffRole } from '@/hooks/use-staff-role'
import { hotelDay } from '@/services/key-cards'
import {
  BATTERY_MONTHS, CLOCK_MONTHS, UPKEEP_KINDS, UPKEEP_MIGRATION, loadUpkeep, logUpkeep,
  type DoorUpkeep, type UpkeepKind,
} from '@/services/lock-upkeep'

const todayInHotel = () => new Date().toISOString().slice(0, 10)
const kindLabel = (k: UpkeepKind) => UPKEEP_KINDS.find((x) => x.value === k)?.label ?? k

/**
 * Each door lock's upkeep: when its batteries were changed and its clock set, and any
 * fault not yet fixed. The locks are offline and cannot report this themselves.
 */
export function LockUpkeepPanel({ doors }: { doors: Array<{ roomId: string; roomNumber: string }> }) {
  const { staffRecord } = useStaffRole()
  const [state, setState] = useState<{ ready: boolean; doors: DoorUpkeep[] } | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [logging, setLogging] = useState<DoorUpkeep | null>(null)
  const [kind, setKind] = useState<UpkeepKind>('battery')
  const [doneOn, setDoneOn] = useState(todayInHotel)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  // The board hands over a new list on every reload: reload the upkeep only when the doors change.
  const doorsRef = useRef(doors)
  doorsRef.current = doors
  const doorKey = doors.map((d) => `${d.roomId}:${d.roomNumber}`).join('|')
  const load = useCallback(async () => {
    try {
      setState(await loadUpkeep(doorsRef.current))
      setFailed(null)
    } catch (e) {
      console.error('[LockUpkeepPanel]', e)
      setFailed('The lock upkeep could not be loaded.')
    }
  }, [doorKey])
  useEffect(() => { void load() }, [load])

  function open(d: DoorUpkeep) {
    setLogging(d)
    setKind(d.openFault ? 'fixed' : 'battery')
    setDoneOn(todayInHotel())
    setNote('')
  }

  async function save() {
    if (!logging) return
    if ((kind === 'fault' || kind === 'note') && !note.trim()) {
      toast.error('Say what was wrong, in a few words.')
      return
    }
    setSaving(true)
    try {
      await logUpkeep({ roomId: logging.roomId, kind, note, doneOn, staffId: staffRecord?.id ?? null, staffName: staffRecord?.name ?? null })
      toast.success(`Room ${logging.roomNumber}: ${kindLabel(kind).toLowerCase()} logged`)
      setLogging(null)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not log it')
    } finally {
      setSaving(false)
    }
  }

  const rows = state?.doors ?? []
  const faults = rows.filter((d) => d.openFault).length
  const batteries = rows.filter((d) => d.batteryDue).length
  const clocks = rows.filter((d) => d.clockDue).length
  const unknown = rows.filter((d) => !d.battery).length

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-lg"><Wrench className="h-5 w-5 text-primary" />Lock upkeep</CardTitle>
        <CardDescription>
          The locks are not connected to anything, so they cannot say how they are. Log each battery change, clock setting and
          fault here. Batteries are due every {BATTERY_MONTHS} months, the clock every {CLOCK_MONTHS}.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {failed ? <p className="text-sm text-red-700">{failed}</p>
          : !state ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading…</p>
          : !state.ready ? (
            <p className="text-sm text-amber-800">
              This needs a database update first: an admin runs <code className="text-xs">{UPKEEP_MIGRATION}</code> in the Supabase SQL editor.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2 text-xs">
                {faults > 0 && <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700">{faults} fault{faults === 1 ? '' : 's'} open</Badge>}
                {batteries > 0 && <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800">{batteries} due for batteries</Badge>}
                {clocks > 0 && <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800">{clocks} due for the clock</Badge>}
                {unknown > 0 && <span className="text-muted-foreground">{unknown} of {rows.length} lock{rows.length === 1 ? ' has' : 's have'} no battery change on record yet: log the next one as it is done.</span>}
              </div>
              <div className="divide-y">
                {rows.map((d) => (
                  <div key={d.roomId} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="min-w-0 space-y-0.5">
                      <div className="font-semibold">Room {d.roomNumber}</div>
                      <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                        <span className={d.batteryDue ? 'text-amber-800' : ''}>
                          <BatteryLow className="mr-1 inline h-3.5 w-3.5" />
                          {d.battery ? `Batteries ${hotelDay(d.battery)}${d.batteryDue ? ' · due' : ''}` : 'Batteries: not on record'}
                        </span>
                        <span className={d.clockDue ? 'text-amber-800' : ''}>
                          <Clock className="mr-1 inline h-3.5 w-3.5" />
                          {d.clock ? `Clock ${hotelDay(d.clock)}${d.clockDue ? ' · due' : ''}` : 'Clock: not on record'}
                        </span>
                      </div>
                      {d.openFault && (
                        <p className="text-xs text-red-700">Fault since {hotelDay(d.openFault.doneOn)}: {d.openFault.note || 'no details'}</p>
                      )}
                    </div>
                    <Button size="sm" variant="outline" onClick={() => open(d)}><Plus className="mr-1 h-4 w-4" />Log</Button>
                  </div>
                ))}
              </div>
            </>
          )}
      </CardContent>

      <Dialog open={!!logging} onOpenChange={(o) => { if (!o && !saving) setLogging(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Room {logging?.roomNumber}: lock upkeep</DialogTitle>
            <DialogDescription>What was done to the lock, and when.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap gap-3">
              <div className="space-y-1">
                <Label htmlFor="upkeep-kind">What</Label>
                <Select value={kind} onValueChange={(v) => setKind(v as UpkeepKind)}>
                  <SelectTrigger id="upkeep-kind" className="w-52"><SelectValue /></SelectTrigger>
                  <SelectContent>{UPKEEP_KINDS.map((k) => <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="upkeep-day">Day</Label>
                <Input id="upkeep-day" type="date" className="w-40" value={doneOn} max={todayInHotel()} onChange={(e) => e.target.value && setDoneOn(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="upkeep-note">{kind === 'fault' ? 'What is wrong' : 'Note (optional)'}</Label>
              <Textarea id="upkeep-note" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)}
                placeholder={kind === 'fault' ? 'e.g. refuses guest cards, staff card works' : ''} />
            </div>
            {logging && logging.entries.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Last logged</p>
                <ul className="space-y-0.5 text-xs text-muted-foreground">
                  {logging.entries.slice(0, 5).map((e) => (
                    <li key={e.id}>{hotelDay(e.doneOn)} · {kindLabel(e.kind)}{e.note ? `: ${e.note}` : ''}{e.staffName ? ` (${e.staffName})` : ''}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" disabled={saving} onClick={() => setLogging(null)}>Cancel</Button>
            <Button disabled={saving} onClick={() => void save()}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Log it</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
