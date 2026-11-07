import { useEffect, useMemo, useState } from 'react'
import { KeyRound, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { db } from '@/lib/db'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { isLockNo, normalizeLockNo, saveRoomLocks, type RoomLock } from '@/services/key-cards'

interface RoomRow {
  id: string
  roomNumber?: string
  name?: string
}

const split = (s: string) => s.split(/[\s,]+/).map(normalizeLockNo).filter(Boolean)

/**
 * Admins set which door lock(s) each room's guest card opens: the 6-character
 * code Joney's Lock Management System gives each door. A room with two doors (a
 * suite) gets two, separated by a comma. Reading a card made in Joney's program
 * at the reception PC (Key cards → Read a card) adds a door's code without typing.
 */
export function RoomLockNumbers({ rooms }: { rooms: RoomRow[] }) {
  const [locks, setLocks] = useState<RoomLock[]>([])
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let alive = true
    ;(db.roomLocks.list() as Promise<RoomLock[]>)
      .then((rows) => { if (alive) setLocks(rows) })
      .catch((e) => console.warn('[RoomLockNumbers] could not load lock numbers', e))
      .finally(() => { if (alive) setLoaded(true) })
    return () => { alive = false }
  }, [])

  const current = useMemo(() => {
    const m = new Map<string, string>()
    for (const l of [...locks].sort((a, b) => a.lockNo.localeCompare(b.lockNo))) {
      m.set(l.roomId, m.has(l.roomId) ? `${m.get(l.roomId)}, ${l.lockNo}` : l.lockNo)
    }
    return m
  }, [locks])

  const sorted = useMemo(
    () => [...rooms].sort((a, b) => String(a.roomNumber ?? '').localeCompare(String(b.roomNumber ?? ''), undefined, { numeric: true })),
    [rooms],
  )
  const withoutLock = sorted.filter((r) => !current.has(r.id)).length

  async function save(room: RoomRow) {
    const value = drafts[room.id] ?? current.get(room.id) ?? ''
    const numbers = split(value)
    const bad = numbers.find((n) => !isLockNo(n))
    if (bad) {
      toast.error(`"${bad}" is not a lock number: 6 characters, 0-9 and A-F (e.g. 01020A).`)
      return
    }
    setSaving(room.id)
    try {
      await saveRoomLocks(room.id, numbers.map((lockNo) => ({ lockNo })))
      setLocks((prev) => [
        ...prev.filter((l) => l.roomId !== room.id),
        ...numbers.map((lockNo) => ({ id: `${room.id}:${lockNo}`, roomId: room.id, lockNo, label: null })),
      ])
      setDrafts((d) => { const next = { ...d }; delete next[room.id]; return next })
      toast.success(numbers.length ? `Room ${room.roomNumber}: lock ${numbers.join(', ')}` : `Room ${room.roomNumber}: lock number removed`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save the lock number')
    } finally {
      setSaving(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <KeyRound className="w-5 h-5 text-primary" />
          Door lock numbers
        </CardTitle>
        <CardDescription>
          The lock each room's key card opens: the 6-character code (0-9 and A-F) Joney's Lock Management
          System gives the door. To fill one in without typing, make a card for the room in Joney's program
          and read it at the reception PC under Key cards → Read a card. For a room with two doors, enter
          both codes separated by a comma.
          {loaded && rooms.length > 0 && (withoutLock ? ` ${withoutLock} of ${rooms.length} rooms have no lock number yet.` : ' Every room has a lock number.')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!loaded ? (
          <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="divide-y rounded-md border">
            {sorted.map((room) => {
              const saved = current.get(room.id) ?? ''
              const value = drafts[room.id] ?? saved
              const changed = split(value).join(',') !== split(saved).join(',')
              return (
                <form
                  key={room.id}
                  className="flex flex-wrap items-center gap-3 px-3 py-2"
                  onSubmit={(e) => { e.preventDefault(); if (changed) void save(room) }}
                >
                  <div className="w-28 shrink-0">
                    <div className="font-semibold text-sm">Room {room.roomNumber ?? '?'}</div>
                    {room.name && <div className="text-xs text-muted-foreground truncate">{room.name}</div>}
                  </div>
                  <Input
                    aria-label={`Lock number for room ${room.roomNumber}`}
                    className="flex-1 min-w-[10rem] font-mono"
                    autoCapitalize="characters"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="e.g. 01020A"
                    value={value}
                    onChange={(e) => setDrafts((d) => ({ ...d, [room.id]: e.target.value }))}
                  />
                  <Button type="submit" size="sm" variant={changed ? 'default' : 'outline'} disabled={!changed || saving === room.id}>
                    {saving === room.id ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
                  </Button>
                </form>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
