import { useCallback, useEffect, useState } from 'react'
import { IdCard, Loader2, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { db } from '@/lib/db'
import { useStaffRole } from '@/hooks/use-staff-role'
import { hotelDay } from '@/services/key-cards'
import {
  CARD_ENDS, STAFF_CARD_KINDS, UPKEEP_MIGRATION, addStaffCard, cardsHeldBy, endStaffCard, loadStaffCards, staffCardLabel,
  type CardEnd, type StaffCardKind, type StaffKeyCard,
} from '@/services/lock-upkeep'

const SOMEONE_ELSE = 'other'

/**
 * Staff cards made in Joney's program (master, floor, cleaner): who holds which. This
 * app never makes them; the register is so a leaver's cards are collected, or
 * cancelled in LQ015, and a lost one is cancelled at once.
 */
export function StaffCardsPanel() {
  const { staffRecord } = useStaffRole()
  const [state, setState] = useState<{ ready: boolean; cards: StaffKeyCard[] } | null>(null)
  const [staff, setStaff] = useState<Array<{ id: string; name: string }>>([])
  const [failed, setFailed] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [holder, setHolder] = useState('')
  const [otherName, setOtherName] = useState('')
  const [kind, setKind] = useState<StaffCardKind>('cleaner')
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [showPast, setShowPast] = useState(false)

  const load = useCallback(async () => {
    try {
      const [s, people] = await Promise.all([loadStaffCards(), db.staff.list({ limit: 500 }) as Promise<Array<{ id: string; name: string }>>])
      setState(s)
      setStaff([...people].sort((a, b) => String(a.name).localeCompare(String(b.name))))
      setFailed(null)
    } catch (e) {
      console.error('[StaffCardsPanel]', e)
      setFailed('The staff cards could not be loaded.')
    }
  }, [])
  useEffect(() => { void load() }, [load])

  async function add() {
    const person = staff.find((p) => p.id === holder)
    const name = holder === SOMEONE_ELSE ? otherName : person?.name ?? ''
    setBusy('add')
    try {
      await addStaffCard({ staffId: person?.id ?? null, holderName: name, kind, label, createdBy: staffRecord?.id ?? null })
      toast.success(`${staffCardLabel(kind)} recorded for ${name.trim()}`)
      setAdding(false)
      setHolder('')
      setOtherName('')
      setLabel('')
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not record the card')
    } finally {
      setBusy(null)
    }
  }

  async function end(card: StaffKeyCard, how: CardEnd) {
    setBusy(card.id)
    try {
      await endStaffCard(card.id, how)
      toast.success(`${card.holderName}'s ${staffCardLabel(card.kind).toLowerCase()}: ${CARD_ENDS[how].toLowerCase()}`)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update the card')
    } finally {
      setBusy(null)
    }
  }

  const held = state?.cards.filter((c) => !c.endedOn) ?? []
  const past = state?.cards.filter((c) => c.endedOn) ?? []
  const canAdd = holder && (holder !== SOMEONE_ELSE || otherName.trim())

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-lg"><IdCard className="h-5 w-5 text-primary" />Staff cards</CardTitle>
        <CardDescription>
          Master, floor and cleaner cards are made in Joney's program, never in this app. Record who holds which, so a leaver's
          cards are collected or cancelled in LQ015. A lost staff card opens doors until it is cancelled in LQ015: do that at once.
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
              {held.length ? (
                <div className="divide-y">
                  {held.map((c) => (
                    <div key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <div className="font-semibold">{c.holderName} <span className="font-normal text-muted-foreground">· {staffCardLabel(c.kind)}{c.label ? ` (${c.label})` : ''}</span></div>
                        <div className="text-xs text-muted-foreground">Since {hotelDay(c.givenOn)}{c.staffId ? '' : ' · not on the staff list'}</div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" disabled={busy === c.id} onClick={() => void end(c, 'returned')}>Handed back</Button>
                        <Button size="sm" variant="outline" disabled={busy === c.id} onClick={() => void end(c, 'cancelled')}>Cancelled in LQ015</Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : <p className="text-sm text-muted-foreground">No staff cards on record.</p>}

              {adding ? (
                <div className="space-y-3 rounded-md border p-3">
                  <div className="flex flex-wrap gap-3">
                    <div className="space-y-1">
                      <Label htmlFor="staff-card-holder">Who holds it</Label>
                      <Select value={holder} onValueChange={setHolder}>
                        <SelectTrigger id="staff-card-holder" className="w-56"><SelectValue placeholder="Choose" /></SelectTrigger>
                        <SelectContent>
                          {staff.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                          <SelectItem value={SOMEONE_ELSE}>Someone not on the list</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {holder === SOMEONE_ELSE && (
                      <div className="space-y-1">
                        <Label htmlFor="staff-card-name">Name</Label>
                        <Input id="staff-card-name" className="w-56" maxLength={120} value={otherName} onChange={(e) => setOtherName(e.target.value)} placeholder="e.g. the plumber" />
                      </div>
                    )}
                    <div className="space-y-1">
                      <Label htmlFor="staff-card-kind">Card</Label>
                      <Select value={kind} onValueChange={(v) => setKind(v as StaffCardKind)}>
                        <SelectTrigger id="staff-card-kind" className="w-44"><SelectValue /></SelectTrigger>
                        <SelectContent>{STAFF_CARD_KINDS.map((k) => <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="staff-card-label">Which one (optional)</Label>
                      <Input id="staff-card-label" className="w-44" maxLength={80} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Floor 2" />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">Don't write the card's number or code here: a name for the card is enough.</p>
                  <div className="flex gap-2">
                    <Button size="sm" disabled={!canAdd || busy === 'add'} onClick={() => void add()}>
                      {busy === 'add' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Record it
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <Button size="sm" variant="outline" onClick={() => setAdding(true)}><Plus className="mr-1 h-4 w-4" />Record a staff card</Button>
              )}

              {past.length > 0 && (
                <div className="pt-1">
                  <Button size="sm" variant="ghost" className="px-0 text-muted-foreground" onClick={() => setShowPast((v) => !v)}>
                    {showPast ? 'Hide' : 'Show'} past cards ({past.length})
                  </Button>
                  {showPast && (
                    <ul className="space-y-0.5 text-xs text-muted-foreground">
                      {past.map((c) => (
                        <li key={c.id}>
                          {c.holderName} · {staffCardLabel(c.kind)}{c.label ? ` (${c.label})` : ''} · {hotelDay(c.givenOn)} to {hotelDay(c.endedOn!)}: {CARD_ENDS[c.endedHow ?? 'returned'].toLowerCase()}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </>
          )}
      </CardContent>
    </Card>
  )
}

/**
 * For the employee delete dialog: the staff cards the person still holds, to collect
 * or cancel in LQ015 before they go. Nothing when they hold none, or the register
 * is not set up.
 */
export function LeaverStaffCards({ staffId, name }: { staffId: string; name: string }) {
  const [cards, setCards] = useState<StaffKeyCard[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    setCards(await cardsHeldBy(staffId))
  }, [staffId])
  useEffect(() => { void load() }, [load])

  async function end(card: StaffKeyCard, how: CardEnd) {
    setBusy(card.id)
    try {
      await endStaffCard(card.id, how)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update the card')
    } finally {
      setBusy(null)
    }
  }

  if (!cards?.length) return null
  return (
    <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
      <p className="flex items-center gap-2 font-semibold"><IdCard className="h-4 w-4" />{name} still holds {cards.length === 1 ? 'a staff key card' : `${cards.length} staff key cards`}</p>
      <p>Collect {cards.length === 1 ? 'it' : 'them'} before they go, or cancel {cards.length === 1 ? 'it' : 'them'} in LQ015: a staff card keeps opening doors until then.</p>
      <ul className="space-y-2">
        {cards.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center justify-between gap-2">
            <span>{staffCardLabel(c.kind)}{c.label ? ` (${c.label})` : ''}, since {hotelDay(c.givenOn)}</span>
            <span className="flex gap-2">
              <Button size="sm" variant="outline" className="h-7 bg-white" disabled={busy === c.id} onClick={() => void end(c, 'returned')}>Handed back</Button>
              <Button size="sm" variant="outline" className="h-7 bg-white" disabled={busy === c.id} onClick={() => void end(c, 'cancelled')}>Cancelled in LQ015</Button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
