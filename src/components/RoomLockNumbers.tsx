import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, ArrowRight, Check, KeyRound, Loader2, Pencil, X } from 'lucide-react'
import { toast } from 'sonner'
import { db } from '@/lib/db'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { isLockNo, normalizeLockNo, saveRoomLocks, type RoomLock } from '@/services/key-cards'

export interface LockRoom {
  id: string
  roomNumber?: string
  name?: string
  typeName?: string
}

const split = (s: string) => s.split(/[\s,]+/).map(normalizeLockNo).filter(Boolean)
const byNumber = (a: LockRoom, b: LockRoom) => String(a.roomNumber ?? '').localeCompare(String(b.roomNumber ?? ''), undefined, { numeric: true })

export interface RoomLocks {
  loaded: boolean
  /** Room id → its lock code, or its codes separated by a comma for a room with two doors. */
  codes: Map<string, string>
  /** Saves a room's codes. Resolves true when saved; says what is wrong otherwise. */
  save: (room: LockRoom, value: string) => Promise<boolean>
}

/**
 * The door lock(s) each room's guest card opens: the 6-character code Joney's Lock
 * Management System gives each door. Loaded once for the page and shared by the Door
 * locks list and each room's details.
 */
export function useRoomLocks(enabled = true): RoomLocks {
  const [locks, setLocks] = useState<RoomLock[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!enabled) return
    let alive = true
    ;(db.roomLocks.list() as Promise<RoomLock[]>)
      .then((rows) => { if (alive) setLocks(rows) })
      .catch((e) => console.warn('[RoomLockNumbers] could not load lock numbers', e))
      .finally(() => { if (alive) setLoaded(true) })
    return () => { alive = false }
  }, [enabled])

  const codes = useMemo(() => {
    const m = new Map<string, string>()
    for (const l of [...locks].sort((a, b) => a.lockNo.localeCompare(b.lockNo))) {
      m.set(l.roomId, m.has(l.roomId) ? `${m.get(l.roomId)}, ${l.lockNo}` : l.lockNo)
    }
    return m
  }, [locks])

  const save = useCallback(async (room: LockRoom, value: string) => {
    const numbers = split(value)
    const bad = numbers.find((n) => !isLockNo(n))
    if (bad) {
      toast.error(`"${bad}" is not a lock number: 6 characters, 0-9 and A-F (e.g. 01020A).`)
      return false
    }
    try {
      await saveRoomLocks(room.id, numbers.map((lockNo) => ({ lockNo })))
      setLocks((prev) => [
        ...prev.filter((l) => l.roomId !== room.id),
        ...numbers.map((lockNo) => ({ id: `${room.id}:${lockNo}`, roomId: room.id, lockNo, label: null })),
      ])
      toast.success(numbers.length ? `Room ${room.roomNumber}: lock ${numbers.join(', ')}` : `Room ${room.roomNumber}: lock number removed`)
      return true
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save the lock number')
      return false
    }
  }, [])

  return { loaded, codes, save }
}

/** A box for one room's lock code(s), with Save. */
export function LockCodeField({ room, locks, autoFocus, onDone, className, inputId }: {
  room: LockRoom
  inputId?: string
  locks: RoomLocks
  autoFocus?: boolean
  /** Called after a save, or on Escape. */
  onDone?: () => void
  className?: string
}) {
  const saved = locks.codes.get(room.id) ?? ''
  const [value, setValue] = useState(saved)
  const [saving, setSaving] = useState(false)
  useEffect(() => { setValue(saved) }, [saved])
  const changed = split(value).join(',') !== split(saved).join(',')

  async function submit() {
    if (!changed) { onDone?.(); return }
    setSaving(true)
    const ok = await locks.save(room, value)
    setSaving(false)
    if (ok) onDone?.()
  }

  return (
    <form className={cn('flex items-center gap-2', className)} onSubmit={(e) => { e.preventDefault(); void submit() }}>
      <Input
        id={inputId}
        aria-label={`Lock code for room ${room.roomNumber}`}
        className="h-9 min-w-0 flex-1 font-mono uppercase placeholder:font-sans placeholder:normal-case"
        autoCapitalize="characters"
        autoComplete="off"
        spellCheck={false}
        autoFocus={autoFocus}
        placeholder="e.g. 01020A"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape' && onDone) { e.preventDefault(); e.stopPropagation(); setValue(saved); onDone() } }}
      />
      <Button type="submit" size="sm" className="h-9" variant={changed ? 'default' : 'outline'} disabled={saving || (!changed && !onDone)}>
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
      </Button>
    </form>
  )
}

/**
 * Door locks tab: every room's lock code in one compact list. A code is edited in its
 * own line (the pencil), and rooms without one are flagged and counted.
 */
export function RoomLockNumbers({ rooms, locks }: { rooms: LockRoom[]; locks: RoomLocks }) {
  const [editing, setEditing] = useState<string | null>(null)
  const sorted = useMemo(() => [...rooms].sort(byNumber), [rooms])
  const missing = sorted.filter((r) => !locks.codes.has(r.id)).length

  return (
    <Card>
      <CardHeader className="space-y-3 pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-lg">
              <KeyRound className="h-5 w-5 text-primary" />
              Door locks
            </CardTitle>
            <CardDescription>
              {!locks.loaded ? 'Loading the lock codes…'
                : missing ? `${sorted.length - missing} of ${sorted.length} doors have a lock code.`
                : `All ${sorted.length} doors have a lock code.`}
            </CardDescription>
          </div>
          {locks.loaded && missing > 0 && (
            <Button asChild size="sm" variant="outline">
              <Link to="/staff/key-cards">Set up the missing {missing} <ArrowRight className="ml-1 h-4 w-4" /></Link>
            </Button>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          The 6-character code (0-9 and A-F) Joney's program gives each door. For a room with two doors, separate the codes with a comma.
        </p>
        <details className="group text-sm text-muted-foreground">
          <summary className="cursor-pointer select-none font-medium text-foreground/80 hover:text-foreground">How to fill one in without typing</summary>
          <p className="mt-2">
            Make a card for the room in Joney's program and read it at the reception PC, under Key cards → Read a card. The app
            adds the door's code for you. At the reception PC, the Key cards page also walks you through every room without a code, one after another.
          </p>
        </details>
      </CardHeader>
      <CardContent>
        {!locks.loaded ? (
          <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <ul className="grid gap-x-6 sm:grid-cols-2">
            {sorted.map((room) => {
              const code = locks.codes.get(room.id)
              const isEditing = editing === room.id
              return (
                <li key={room.id} className="flex min-h-[52px] items-center gap-3 border-b py-2">
                  <span className="min-w-[4rem] shrink-0 font-semibold tabular-nums">{room.roomNumber ?? '?'}</span>
                  {isEditing ? (
                    <LockCodeField room={room} locks={locks} autoFocus onDone={() => setEditing(null)} className="flex-1" />
                  ) : (
                    <>
                      <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground" title={room.typeName || room.name}>{room.typeName || room.name}</span>
                      {code ? (
                        <span className="inline-flex items-center gap-1 font-mono text-sm"><Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden />{code}</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-sm font-medium text-amber-700"><AlertTriangle className="h-3.5 w-3.5" aria-hidden />None yet</span>
                      )}
                      <Button type="button" size="icon" variant="ghost" className="h-9 w-9 shrink-0" aria-label={`Edit the lock code for room ${room.roomNumber}`} onClick={() => setEditing(room.id)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </>
                  )}
                  {isEditing && (
                    <Button type="button" size="icon" variant="ghost" className="h-9 w-9 shrink-0" aria-label="Cancel" onClick={() => setEditing(null)}>
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
