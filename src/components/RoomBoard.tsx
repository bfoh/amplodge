import { useRef, type RefObject } from 'react'
import { differenceInCalendarDays, format } from 'date-fns'
import { BedDouble, DoorClosed, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { DoorAlert, doorText } from '@/components/DoorStatus'
import { LockCodeField, type RoomLocks } from '@/components/RoomLockNumbers'
import { useIsMobile } from '@/hooks/use-mobile'
import { cn, formatCurrencySync } from '@/lib/utils'
import type { DoorStatus } from '@/services/door-status'

export type RoomState = 'available' | 'occupied' | 'cleaning' | 'maintenance'

export interface BoardRoom {
  id: string
  number: string
  name: string
  typeName: string
  price: number
  state: RoomState
  guest?: string
  checkIn?: string
  checkOut?: string
  beds?: number
  bathrooms?: number
  maxGuests?: number
  description?: string
  door?: DoorStatus | null
}

/** The page's existing status colours: green free, rose occupied, blue cleaning, amber maintenance. */
export const ROOM_STATES: Record<RoomState, { label: string; dot: string; tile: string; pill: string }> = {
  available: { label: 'Free', dot: 'bg-emerald-500', tile: 'border-emerald-200 bg-emerald-50/70 hover:border-emerald-400', pill: 'bg-emerald-100 text-emerald-800' },
  occupied: { label: 'Occupied', dot: 'bg-rose-500', tile: 'border-rose-200 bg-rose-50/70 hover:border-rose-400', pill: 'bg-rose-100 text-rose-800' },
  cleaning: { label: 'Cleaning', dot: 'bg-sky-500', tile: 'border-sky-200 bg-sky-50/70 hover:border-sky-400', pill: 'bg-sky-100 text-sky-800' },
  maintenance: { label: 'Maintenance', dot: 'bg-amber-500', tile: 'border-amber-200 bg-amber-50/70 hover:border-amber-400', pill: 'bg-amber-100 text-amber-800' },
}

const FLOOR_NAMES = ['Ground floor', 'First floor', 'Second floor', 'Third floor', 'Fourth floor', 'Fifth floor', 'Sixth floor']

/** The floor a room is on, from its number: 00 the ground floor, 1xx the first, 2xx the second ("110+109" with 110). */
export function roomFloor(number: string): { order: number; label: string } {
  const n = parseInt(String(number).split('+')[0].trim(), 10)
  if (Number.isNaN(n)) return { order: 999, label: 'Other rooms' }
  const floor = n < 100 ? 0 : Math.floor(n / 100)
  return { order: floor, label: FLOOR_NAMES[floor] ?? `Floor ${floor}` }
}

export const byRoomNumber = (a: { number: string }, b: { number: string }) => a.number.localeCompare(b.number, undefined, { numeric: true })

/** Rooms by floor, lowest floor first, each in number order. */
export function groupByFloor(rooms: BoardRoom[]): Array<{ key: string; label: string; rooms: BoardRoom[] }> {
  const floors = new Map<number, { key: string; label: string; rooms: BoardRoom[] }>()
  for (const r of rooms) {
    const f = roomFloor(r.number)
    const g = floors.get(f.order) ?? { key: String(f.order), label: f.label, rooms: [] }
    g.rooms.push(r)
    floors.set(f.order, g)
  }
  return [...floors.entries()].sort(([a], [b]) => a - b).map(([, g]) => ({ ...g, rooms: g.rooms.sort(byRoomNumber) }))
}

const day = (iso?: string) => (iso ? new Date(`${String(iso).slice(0, 10)}T00:00:00`) : null)
const short = (iso?: string) => { const d = day(iso); return d && !Number.isNaN(d.getTime()) ? format(d, 'EEE d') : '' }
const long = (iso?: string) => { const d = day(iso); return d && !Number.isNaN(d.getTime()) ? format(d, 'EEE d MMM') : '' }
const nights = (a?: string, b?: string) => {
  const from = day(a)
  const to = day(b)
  const n = from && to ? differenceInCalendarDays(to, from) : NaN
  return n > 0 ? ` · ${n} night${n === 1 ? '' : 's'}` : ''
}

function tileLine(room: BoardRoom, currency: string) {
  switch (room.state) {
    case 'occupied':
      return (
        <>
          <span className="line-clamp-2 break-words font-semibold text-stone-800">{room.guest || 'Guest in room'}</span>
          {room.checkOut && <span className="block text-[11px] text-stone-500">out {short(room.checkOut)}</span>}
        </>
      )
    case 'cleaning':
      return <span className="text-sky-800">Awaiting cleaning</span>
    case 'maintenance':
      return <span className="text-amber-800">Out of use</span>
    default:
      return <span className="text-stone-600">{formatCurrencySync(room.price, currency)}</span>
  }
}

/** One room on the board: number, status, type, and the guest or price. Opens the room's details. */
export function RoomTile({ room, currency, onOpen }: { room: BoardRoom; currency: string; onOpen: (tile: HTMLButtonElement) => void }) {
  const s = ROOM_STATES[room.state]
  const who = room.state === 'occupied' ? `, ${room.guest || 'guest in room'}${room.checkOut ? `, out ${long(room.checkOut)}` : ''}` : ''
  return (
    <button
      type="button"
      onClick={(e) => onOpen(e.currentTarget)}
      aria-label={`Room ${room.number}, ${room.typeName}, ${s.label}${who}${room.door ? `. ${doorText(room.door)}` : ''}`}
      className={cn(
        'flex h-full min-h-[104px] w-full flex-col rounded-xl border-2 p-2.5 text-left shadow-sm transition-all',
        'hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
        s.tile,
      )}
    >
      <span className="flex flex-wrap items-center justify-between gap-1">
        <span className={cn('font-bold leading-none tabular-nums text-stone-900', room.number.length > 4 ? 'text-base sm:text-lg' : 'text-lg')}>{room.number}</span>
        <span className={cn('hidden rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide sm:inline', s.pill)}>{s.label}</span>
        <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full sm:hidden', s.dot)} aria-hidden />
      </span>
      <span className="mt-1 line-clamp-2 break-words text-[11px] leading-snug text-stone-500" title={room.typeName}>{room.typeName}</span>
      <span className="mt-auto pt-1.5 text-xs leading-snug">{tileLine(room, currency)}</span>
      <DoorAlert status={room.door} className="mt-1" />
    </button>
  )
}

function plural(n: number | undefined, one: string, many: string) {
  return n == null ? null : `${n} ${n === 1 ? one : many}`
}

/**
 * Everything about one room in a side panel (a bottom sheet on a phone): what is
 * happening in it today, its door and lock code, its details, and Edit and Delete.
 */
export function RoomDetails({ room, onClose, currency, locks, canEditLocks, onEdit, onDelete, returnFocus }: {
  room: BoardRoom | null
  /** The tile that opened the panel: focus goes back to it on close (there is no Sheet trigger to return to). */
  returnFocus?: RefObject<HTMLElement | null>
  onClose: () => void
  currency: string
  locks: RoomLocks
  canEditLocks: boolean
  onEdit: (room: BoardRoom) => void
  onDelete: (room: BoardRoom) => void
}) {
  const isMobile = useIsMobile()
  // Keep the last room on screen while the panel slides away.
  const last = useRef<BoardRoom | null>(room)
  if (room) last.current = room
  const r = room ?? last.current
  const s = r ? ROOM_STATES[r.state] : null
  const facts = r ? [plural(r.beds, 'bed', 'beds'), plural(r.bathrooms, 'bathroom', 'bathrooms'), r.maxGuests ? `up to ${r.maxGuests} guest${r.maxGuests === 1 ? '' : 's'}` : null].filter(Boolean) : []
  const code = r ? locks.codes.get(r.id) : undefined

  return (
    <Sheet open={!!room} onOpenChange={(open) => { if (!open) onClose() }}>
      <SheetContent
        side={isMobile ? 'bottom' : 'right'}
        className={cn('flex flex-col gap-0 overflow-y-auto p-0', isMobile ? 'max-h-[88vh] rounded-t-2xl' : 'w-full sm:max-w-md')}
        onCloseAutoFocus={(e) => {
          e.preventDefault()
          // Not when Edit or Delete has opened a dialog of its own: that one keeps the focus.
          const tile = returnFocus?.current
          if (tile?.isConnected && !document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]')) tile.focus()
        }}
      >
        {r && s && (
          <>
            <SheetHeader className="space-y-1 border-b p-5 pr-12 text-left">
              <SheetTitle className="flex items-center gap-3 text-2xl">
                Room {r.number}
                <span className={cn('rounded-full px-2 py-0.5 font-sans text-xs font-semibold uppercase tracking-wide', s.pill)}>{s.label}</span>
              </SheetTitle>
              <SheetDescription>
                {r.name && r.name.trim().toLowerCase() !== r.typeName.trim().toLowerCase() ? `${r.name} · ` : ''}{r.typeName} · {formatCurrencySync(r.price, currency)} a night
              </SheetDescription>
            </SheetHeader>

            <div className="flex-1 space-y-5 p-5">
              <section className="space-y-1">
                <h3 className="font-sans text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Today</h3>
                {r.state === 'occupied' ? (
                  <>
                    <p className="font-semibold">{r.guest || 'A guest is in the room'}</p>
                    {r.checkIn && r.checkOut && <p className="text-sm text-muted-foreground">{long(r.checkIn)} to {long(r.checkOut)}{nights(r.checkIn, r.checkOut)}</p>}
                  </>
                ) : r.state === 'cleaning' ? (
                  <p className="text-sm">Waiting for housekeeping. It becomes free when its cleaning task is done.</p>
                ) : r.state === 'maintenance' ? (
                  <p className="text-sm">Under maintenance, so it can't be booked.</p>
                ) : (
                  <p className="text-sm">Free and ready for a guest.</p>
                )}
              </section>

              {(r.door || canEditLocks) && (
                <section className="space-y-2">
                  <h3 className="flex items-center gap-1.5 font-sans text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground"><DoorClosed className="h-3.5 w-3.5" />Door</h3>
                  {r.door ? (
                    <>
                      <p className="text-sm">{doorText(r.door)}</p>
                      <DoorAlert status={r.door} />
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">{code ? 'No key card the app knows of opens it.' : 'No lock code yet, so the app cannot make key cards for this room.'}</p>
                  )}
                  {canEditLocks && (
                    <div className="space-y-1 pt-1">
                      <label className="text-xs font-medium text-muted-foreground" htmlFor={`lock-${r.id}`}>Lock code</label>
                      <LockCodeField key={r.id} inputId={`lock-${r.id}`} room={{ id: r.id, roomNumber: r.number, name: r.name }} locks={locks} />
                    </div>
                  )}
                </section>
              )}

              <section className="space-y-1">
                <h3 className="flex items-center gap-1.5 font-sans text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground"><BedDouble className="h-3.5 w-3.5" />Room</h3>
                {facts.length > 0 && <p className="text-sm">{facts.join(' · ')}</p>}
                {r.description ? <p className="whitespace-pre-line text-sm text-muted-foreground">{r.description}</p> : <p className="text-sm text-muted-foreground">No description yet.</p>}
              </section>
            </div>

            <div className="flex flex-wrap gap-2 border-t p-5">
              <Button type="button" onClick={() => onEdit(r)}><Pencil className="mr-2 h-4 w-4" />Edit details</Button>
              <Button type="button" variant="ghost" className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => onDelete(r)}>
                <Trash2 className="mr-2 h-4 w-4" />Delete room
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
