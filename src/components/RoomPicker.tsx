import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { format } from 'date-fns'
import { Check, Lock, Wrench } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn, formatCurrencySync } from '@/lib/utils'

export interface PickerRoom {
  id: string
  number: string
  typeName: string
  /** Per night. */
  price: number
  state: 'free' | 'booked' | 'maintenance'
  /** The booking that has the room on the chosen dates. */
  bookedBy?: { guest: string; checkIn: string; checkOut: string }
}

interface RoomPickerProps {
  rooms: PickerRoom[]
  value: string
  onChange: (roomId: string) => void
  currency: string
  /** The stay being booked (YYYY-MM-DD). Until both are set, every room not under maintenance can be picked. */
  checkIn?: string
  checkOut?: string
  /** For the field's <Label htmlFor>. */
  id?: string
}

const byNumber = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true })
const day = (iso: string) => new Date(`${String(iso).slice(0, 10)}T00:00:00`)

/** "12–14 Nov", or "30 Nov – 2 Dec" across months. */
export function stayLabel(checkIn?: string, checkOut?: string): string {
  if (!checkIn || !checkOut) return ''
  const a = day(checkIn)
  const b = day(checkOut)
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return ''
  return a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()
    ? `${format(a, 'd')}–${format(b, 'd MMM')}`
    : `${format(a, 'd MMM')} – ${format(b, 'd MMM')}`
}

interface TypeGroup {
  key: string
  name: string
  price: number
  rooms: PickerRoom[]
}

/** One row per room type (same name and price), in room-number order. */
function groupByType(rooms: PickerRoom[]): TypeGroup[] {
  const groups = new Map<string, TypeGroup>()
  for (const r of [...rooms].sort((a, b) => byNumber(a.number, b.number))) {
    const key = `${r.typeName.trim().toLowerCase()}|${r.price}`
    const g = groups.get(key) ?? { key, name: r.typeName.trim() || 'Room', price: r.price, rooms: [] }
    g.rooms.push(r)
    groups.set(key, g)
  }
  return [...groups.values()]
}

/**
 * Choosing a room for a booking: every room on one screen, one row per room type with its
 * price, the room numbers as tiles. Rooms booked on the chosen dates, or under maintenance,
 * are greyed out. Once a room is chosen the grid folds into one line.
 */
export function RoomPicker({ rooms, value, onChange, currency, checkIn, checkOut, id }: RoomPickerProps) {
  const [open, setOpen] = useState(!value)
  const [note, setNote] = useState<string | null>(null)
  const [missing, setMissing] = useState(false)
  const [focusId, setFocusId] = useState<string | null>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const changeRef = useRef<HTMLButtonElement>(null)
  const noteId = useId()

  const groups = useMemo(() => groupByType(rooms), [rooms])
  const order = useMemo(() => groups.flatMap((g) => g.rooms), [groups])
  const selected = rooms.find((r) => r.id === value)
  const datesChosen = !!checkIn && !!checkOut
  const stay = stayLabel(checkIn, checkOut)
  const free = rooms.filter((r) => r.state === 'free').length
  const pickable = (r: PickerRoom) => r.state === 'free' || r.id === value

  // The page clears the room when new dates clash with it: open the grid again.
  useEffect(() => {
    if (!value) setOpen(true)
    else setMissing(false)
  }, [value])
  useEffect(() => { setNote(null) }, [checkIn, checkOut])

  // Roving focus: one tile is in the tab order; the arrow keys move between the rooms that can be picked.
  const tabStop = (selected && pickable(selected) ? selected.id : undefined) ?? order.find(pickable)?.id
  const current = focusId && order.some((r) => r.id === focusId && pickable(r)) ? focusId : tabStop

  function focusTile(roomId?: string) {
    if (!roomId) return
    setFocusId(roomId)
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-room="${CSS.escape(roomId)}"]`)?.focus()
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const live = order.filter(pickable)
    const at = live.findIndex((r) => r.id === current)
    let next: PickerRoom | undefined
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = live[Math.min(live.length - 1, at + 1)]
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = live[Math.max(0, at - 1)]
    else if (e.key === 'Home') next = live[0]
    else if (e.key === 'End') next = live[live.length - 1]
    else return
    e.preventDefault()
    focusTile(next?.id)
  }

  function choose(r: PickerRoom) {
    if (!pickable(r)) {
      setNote(r.state === 'maintenance'
        ? `Room ${r.number} is under maintenance.`
        : `Room ${r.number} is booked${r.bookedBy ? `: ${r.bookedBy.guest}, ${stayLabel(r.bookedBy.checkIn, r.bookedBy.checkOut)}` : ' on these dates'}.`)
      return
    }
    setNote(null)
    onChange(r.id)
    setOpen(false)
    requestAnimationFrame(() => changeRef.current?.focus())
  }

  function reopen() {
    setOpen(true)
    requestAnimationFrame(() => focusTile(tabStop))
  }

  const price = (n: number) => formatCurrencySync(n, currency)
  const stateWord = (r: PickerRoom) =>
    r.state === 'maintenance' ? 'under maintenance' : r.state === 'booked' ? 'booked' : datesChosen ? 'free' : 'not checked yet'

  return (
    <div className="space-y-2">
      {/* The form's own check: no room chosen stops the submit and points here. */}
      <input
        id={id}
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
        required
        value={value}
        onChange={() => undefined}
        onFocus={() => focusTile(tabStop)}
        onInvalid={(e) => {
          e.preventDefault()
          setMissing(true)
          setOpen(true)
          gridRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
        }}
      />

      {!open && selected ? (
        <div className="flex items-center gap-3 rounded-md border bg-background px-3 py-2">
          <Check className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
          <p className="min-w-0 flex-1 text-sm">
            <span className="font-semibold">Room {selected.number}</span>
            <span className="text-muted-foreground"> · {selected.typeName} · {price(selected.price)}/night</span>
          </p>
          <Button ref={changeRef} type="button" variant="outline" size="sm" onClick={reopen}>Change</Button>
        </div>
      ) : (
        <div className={cn('rounded-md border', missing && 'border-red-300 ring-2 ring-red-100')}>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b bg-muted/30 px-3 py-2 text-xs">
            <span className={cn('font-medium', missing ? 'text-red-700' : 'text-muted-foreground')}>
              {missing ? 'Choose a room for this booking.' : datesChosen ? `${free} of ${rooms.length} free · ${stay}` : 'Add the dates to see which rooms are free.'}
            </span>
            {datesChosen && (
              <span className="flex items-center gap-3 text-muted-foreground">
                <span className="inline-flex items-center gap-1"><Lock className="h-3 w-3" aria-hidden />booked</span>
                <span className="inline-flex items-center gap-1"><Wrench className="h-3 w-3" aria-hidden />maintenance</span>
              </span>
            )}
          </div>
          <div ref={gridRef} role="group" aria-label="Rooms" aria-describedby={note ? noteId : undefined} onKeyDown={onKeyDown} className="divide-y">
            {groups.map((g) => (
              <div key={g.key} className="gap-3 px-3 py-2 sm:grid sm:grid-cols-[10rem_1fr] sm:items-center">
                <div className="mb-1.5 flex items-baseline justify-between gap-2 sm:mb-0 sm:block">
                  <div className="text-sm font-medium leading-tight break-words">{g.name}</div>
                  <div className="text-xs text-muted-foreground">{price(g.price)}/night</div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {g.rooms.map((r) => {
                    const isSelected = r.id === value
                    const can = pickable(r)
                    return (
                      <button
                        key={r.id}
                        type="button"
                        data-room={r.id}
                        tabIndex={r.id === current ? 0 : -1}
                        aria-pressed={isSelected}
                        aria-disabled={!can || undefined}
                        aria-label={`Room ${r.number}, ${r.typeName}, ${price(r.price)} a night, ${isSelected ? 'chosen' : stateWord(r)}`}
                        onFocus={() => can && setFocusId(r.id)}
                        onClick={() => choose(r)}
                        className={cn(
                          'inline-flex min-h-[40px] min-w-[3.25rem] items-center justify-center gap-1 rounded-md border-2 px-2 text-sm font-bold tabular-nums transition-colors [@media(pointer:coarse)]:min-h-[44px]',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1',
                          isSelected && 'border-primary bg-primary text-primary-foreground shadow-sm',
                          !isSelected && can && datesChosen && 'border-emerald-300 bg-emerald-50 text-emerald-800 hover:border-emerald-500 hover:bg-emerald-100',
                          !isSelected && can && !datesChosen && 'border-stone-200 bg-white text-stone-700 hover:border-primary/50 hover:bg-stone-50',
                          !isSelected && r.state === 'booked' && 'cursor-not-allowed border-red-100 bg-red-50/60 text-red-400',
                          !isSelected && r.state === 'maintenance' && 'cursor-not-allowed border-stone-200 bg-stone-100 text-stone-400',
                        )}
                      >
                        {r.number}
                        {!isSelected && r.state === 'booked' && <Lock className="h-3 w-3" aria-hidden />}
                        {!isSelected && r.state === 'maintenance' && <Wrench className="h-3 w-3" aria-hidden />}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
            {groups.length === 0 && <p className="px-3 py-6 text-center text-sm text-muted-foreground">No rooms set up yet: add them on the Rooms page.</p>}
          </div>
          {note && <p id={noteId} role="status" className="border-t bg-amber-50 px-3 py-2 text-xs text-amber-900">{note}</p>}
        </div>
      )}
    </div>
  )
}
