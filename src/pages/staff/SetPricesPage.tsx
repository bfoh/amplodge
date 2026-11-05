import { useEffect, useMemo, useState } from 'react'
import { db, auth } from '@/lib/db'
import type { RoomType } from '@/types'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { formatCurrencySync, getCurrencySymbol } from '@/lib/utils'
import { toast } from 'sonner'
import { useCurrency } from '@/hooks/use-currency'
import { activityLogService } from '@/services/activity-log-service'
import { RefreshCw, Plus, Tag, Pencil } from 'lucide-react'
import {
  canonicalRoomTypes,
  findTypeNamed,
  mirrorPriceUpdate,
  newRoomTypeRow,
  normalizeName,
  roomPriceUpdate,
  roomTypeDetailsUpdate,
  roomTypePriceUpdate,
  typeCapacity,
  typePrice,
  type RoomTypeGroup,
} from '@/lib/room-types'

type TypeRow = RoomType & Record<string, any>

/** The add / edit room type form. `id` is null when adding. */
interface TypeForm {
  id: string | null
  originalName: string
  name: string
  capacity: string
  price: string
  description: string
}

const NEW_TYPE: TypeForm = { id: null, originalName: '', name: '', capacity: '2', price: '', description: '' }

const MAX_CAPACITY = 100

/** A nightly price typed into the page, or null if it isn't one. */
const parsePrice = (value: string | undefined): number | null => {
  const n = Number(value)
  return value !== undefined && value.trim() !== '' && Number.isFinite(n) && n > 0 ? n : null
}

export function SetPricesPage() {
  const [types, setTypes] = useState<TypeRow[]>([])
  const [rooms, setRooms] = useState<Record<string, any>[]>([])
  const [edited, setEdited] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<TypeForm | null>(null)
  const { currency } = useCurrency()

  const load = async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const [typeRows, roomRows] = await Promise.all([
        db.roomTypes.list({ orderBy: { column: 'createdAt', ascending: true } }),
        db.properties.list(),
      ])
      setTypes((typeRows || []) as TypeRow[])
      setRooms(roomRows || [])
    } catch (err: any) {
      console.error('[SetPrices] Failed to load room types', err)
      setLoadError(err?.message || 'Could not load room types')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  // One row per room type: the row the website shows and bookings charge.
  // Older duplicate rows (left by the Rooms page's old auto-seeding) are hidden.
  // Oldest first, so rows stay put when a price changes and new types go last.
  const groups = useMemo(
    () => canonicalRoomTypes(types, rooms).sort((a, b) => String(a.type.createdAt ?? '').localeCompare(String(b.type.createdAt ?? ''))),
    [types, rooms],
  )
  const hiddenDuplicates = groups.reduce((n, g) => n + g.duplicates.length, 0)
  const stranded = groups.filter((g) => g.strandedRooms > 0)

  const dirtyIds = Object.keys(edited).filter((id) => {
    const group = groups.find((g) => g.type.id === id)
    return group && parsePrice(edited[id]) !== typePrice(group.type)
  })

  const currentUserId = async () => (await auth.me().catch(() => null))?.id || 'system'

  /**
   * Bring every room's stored copy of the price into line. Bookings charge the
   * type's price, so a failure here leaves a stale copy, never a wrong charge.
   */
  const syncRoomPrices = async (typeId: string, price: number): Promise<boolean> => {
    try {
      const [typeRooms, mirrors] = await Promise.all([
        db.properties.list({ where: { propertyTypeId: typeId } }),
        db.rooms.list({ where: { roomTypeId: typeId } }),
      ])
      await Promise.all([
        ...typeRooms.map((r: any) => db.properties.update(r.id, roomPriceUpdate(price))),
        ...mirrors.map((r: any) => db.rooms.update(r.id, mirrorPriceUpdate(price))),
      ])
      return true
    } catch (err) {
      console.warn('[SetPrices] Rooms of type', typeId, 'kept an old copy of the price:', err)
      return false
    }
  }

  /** Price one type. Throws if the type itself could not be saved. */
  const applyPrice = async (group: RoomTypeGroup<TypeRow>, price: number) => {
    await db.roomTypes.update(group.type.id, roomTypePriceUpdate(price))
    setTypes((prev) => prev.map((t) => (t.id === group.type.id ? { ...t, basePrice: price } : t)))
    setEdited((prev) => {
      const copy = { ...prev }
      delete copy[group.type.id]
      return copy
    })
    const roomsSynced = group.roomCount === 0 || (await syncRoomPrices(group.type.id, price))
    activityLogService
      .log({
        action: 'updated',
        entityType: 'room',
        entityId: group.type.id,
        details: {
          roomTypeName: group.type.name,
          oldPrice: typePrice(group.type) ?? 0,
          newPrice: price,
          priceChange: true,
          updatedAt: new Date().toISOString(),
        },
        userId: await currentUserId(),
      })
      .catch((logError: unknown) => console.error('Activity logging failed:', logError))
    return roomsSynced
  }

  const saveOne = async (group: RoomTypeGroup<TypeRow>) => {
    const price = parsePrice(edited[group.type.id])
    if (price === null) {
      toast.error('Enter a nightly price above zero')
      return
    }
    setSaving(true)
    try {
      const roomsSynced = await applyPrice(group, price)
      if (roomsSynced) toast.success(`${group.type.name} is now ${formatCurrencySync(price, currency)} a night`)
      else toast.warning(`${group.type.name}'s price is saved, but some rooms still list the old price. Press Refresh, then save it again.`)
    } catch (err: any) {
      console.error('[SetPrices] Price update failed', err)
      toast.error(`Could not save the price for ${group.type.name}`, { description: err?.message })
    } finally {
      setSaving(false)
    }
  }

  const saveAll = async () => {
    const pending = dirtyIds.map((id) => groups.find((g) => g.type.id === id)!).filter(Boolean)
    const invalid = pending.filter((g) => parsePrice(edited[g.type.id]) === null)
    if (invalid.length) {
      toast.error(`Enter a nightly price above zero for ${invalid.map((g) => g.type.name).join(', ')}`)
      return
    }
    setSaving(true)
    const failed: string[] = []
    let staleRooms = false
    for (const group of pending) {
      try {
        if (!(await applyPrice(group, parsePrice(edited[group.type.id])!))) staleRooms = true
      } catch (err) {
        console.error('[SetPrices] Price update failed for', group.type.name, err)
        failed.push(group.type.name)
      }
    }
    setSaving(false)
    const saved = pending.length - failed.length
    if (failed.length) toast.error(`Could not save: ${failed.join(', ')}`, { description: saved ? `${saved} other price${saved === 1 ? '' : 's'} saved.` : undefined })
    else if (staleRooms) toast.warning('Prices saved, but some rooms still list an old price. Press Refresh, then save again.')
    else toast.success(`${saved} price${saved === 1 ? '' : 's'} saved`)
  }

  const openEdit = (group: RoomTypeGroup<TypeRow>) =>
    setForm({
      id: group.type.id,
      originalName: group.type.name,
      name: group.type.name,
      capacity: String(typeCapacity(group.type) ?? ''),
      price: String(typePrice(group.type) ?? ''),
      description: group.type.description || '',
    })

  const submitForm = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form) return
    const name = form.name.trim().replace(/\s+/g, ' ')
    const capacity = Number(form.capacity)
    const price = parsePrice(form.price)

    if (!name) return void toast.error('Give the room type a name')
    if (normalizeName(name) !== normalizeName(form.originalName) && findTypeNamed(types, name)) {
      return void toast.error(`There is already a room type called "${name}"`)
    }
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > MAX_CAPACITY) {
      return void toast.error(`Max guests must be a whole number from 1 to ${MAX_CAPACITY}`)
    }
    if (!form.id && price === null) return void toast.error('Enter a nightly price above zero')

    setSaving(true)
    try {
      let typeId = form.id
      if (typeId) {
        await db.roomTypes.update(typeId, roomTypeDetailsUpdate({ name, capacity, description: form.description }))
        toast.success(`${name} updated`)
      } else {
        const row = newRoomTypeRow({ name, capacity, basePrice: price!, description: form.description })
        await db.roomTypes.create(row)
        typeId = row.id
        toast.success(`${name} added at ${formatCurrencySync(price!, currency)} a night`, {
          description: 'Add its rooms on the Rooms page. It appears on the website once it has a room.',
        })
      }
      activityLogService
        .log({
          action: form.id ? 'updated' : 'created',
          entityType: 'room',
          entityId: typeId,
          details: { roomTypeName: name, capacity, ...(form.id ? {} : { basePrice: price }), roomType: true },
          userId: await currentUserId(),
        })
        .catch((logError: unknown) => console.error('Activity logging failed:', logError))
      setForm(null)
      await load()
    } catch (err: any) {
      console.error('[SetPrices] Saving room type failed', err)
      toast.error(form.id ? 'Could not update the room type' : 'Could not add the room type', { description: err?.message })
    } finally {
      setSaving(false)
    }
  }

  if (loading && types.length === 0) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="flex items-center gap-3 text-muted-foreground">
          <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span>Loading room types...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="p-1.5 rounded-lg bg-primary/10">
              <Tag className="w-5 h-5 text-primary" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">Set Prices</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Each room type has one nightly price. Every room of that type, the website and all bookings use it.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={load} disabled={loading || saving}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button variant="outline" onClick={() => setForm(NEW_TYPE)} disabled={saving || !!loadError}>
            <Plus className="w-4 h-4 mr-2" />
            Add room type
          </Button>
          <Button onClick={saveAll} disabled={saving || dirtyIds.length === 0}>
            {saving ? 'Saving…' : dirtyIds.length > 0 ? `Save all (${dirtyIds.length})` : 'Save all'}
          </Button>
        </div>
      </div>

      {loadError ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-4 py-12 text-center">
            <p className="text-sm text-red-700">Room types could not be loaded: {loadError}</p>
            <Button variant="outline" onClick={load}>
              <RefreshCw className="w-4 h-4 mr-2" />
              Try again
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Room types</CardTitle>
            <CardDescription>Edit the price per night, then press Save. To sell rooms at a different price, add a room type for them.</CardDescription>
          </CardHeader>
          <CardContent>
            {groups.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <p className="text-muted-foreground mb-4">No room types yet.</p>
                <Button onClick={() => setForm(NEW_TYPE)} disabled={saving}>
                  <Plus className="w-4 h-4 mr-2" />
                  Add your first room type
                </Button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50 hover:bg-muted/50">
                      <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground py-3">Type</TableHead>
                      <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground py-3">Rooms</TableHead>
                      <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground py-3">Max guests</TableHead>
                      <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground py-3">Current price</TableHead>
                      <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground py-3">New price</TableHead>
                      <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground py-3 w-40">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {groups.map((group) => {
                      const rt = group.type
                      const price = typePrice(rt)
                      const draft = edited[rt.id]
                      const changed = draft !== undefined && parsePrice(draft) !== price
                      return (
                        <TableRow key={rt.id}>
                          <TableCell className="font-medium">{rt.name}</TableCell>
                          <TableCell className="text-muted-foreground">{group.roomCount || 'None yet'}</TableCell>
                          <TableCell>{typeCapacity(rt) ?? '-'}</TableCell>
                          <TableCell>{price !== null ? formatCurrencySync(price, currency) : 'Not set'}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <span className="text-muted-foreground">{getCurrencySymbol(currency)}</span>
                              <Input
                                type="number"
                                min={1}
                                step="any"
                                inputMode="decimal"
                                aria-label={`New price per night for ${rt.name}`}
                                className="w-32"
                                value={draft ?? String(price ?? '')}
                                onChange={(e) => setEdited((prev) => ({ ...prev, [rt.id]: e.target.value }))}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' && changed && !saving) saveOne(group)
                                }}
                              />
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1">
                              <Button variant={changed ? 'default' : 'outline'} size="sm" onClick={() => saveOne(group)} disabled={saving || !changed}>
                                Save
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => openEdit(group)} disabled={saving} aria-label={`Edit ${rt.name}`}>
                                <Pencil className="w-4 h-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
            {stranded.length > 0 && (
              <p className="mt-4 text-sm text-amber-700">
                Some rooms are linked to an old duplicate of {stranded.map((g) => g.type.name).join(', ')}, so they can't be booked online.
                On the Rooms page, edit each of them and press Save Changes to fix it.
              </p>
            )}
            {hiddenDuplicates > 0 && (
              <p className="mt-4 text-xs text-muted-foreground">
                {hiddenDuplicates} old duplicate {hiddenDuplicates === 1 ? 'entry is' : 'entries are'} hidden. The website and bookings don't use them.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={!!form} onOpenChange={(open) => !open && !saving && setForm(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{form?.id ? `Edit ${form.originalName}` : 'Add room type'}</DialogTitle>
            <DialogDescription>
              {form?.id
                ? 'Change the price in the table. A new name shows on the website straight away.'
                : 'A kind of room you sell at one price, for example "Executive Suite". Add its rooms on the Rooms page afterwards.'}
            </DialogDescription>
          </DialogHeader>
          {form && (
            <form onSubmit={submitForm} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="type-name">Name*</Label>
                <Input id="type-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={60} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="type-capacity">Max guests*</Label>
                  <Input
                    id="type-capacity"
                    type="number"
                    min={1}
                    max={MAX_CAPACITY}
                    step={1}
                    value={form.capacity}
                    onChange={(e) => setForm({ ...form, capacity: e.target.value })}
                    required
                  />
                </div>
                {!form.id && (
                  <div className="space-y-2">
                    <Label htmlFor="type-price">Price per night ({getCurrencySymbol(currency)})*</Label>
                    <Input
                      id="type-price"
                      type="number"
                      min={1}
                      step="any"
                      inputMode="decimal"
                      value={form.price}
                      onChange={(e) => setForm({ ...form, price: e.target.value })}
                      required
                    />
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="type-description">Description</Label>
                <textarea
                  id="type-description"
                  className="w-full px-3 py-2 border rounded-md min-h-[80px] text-sm"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Shown on the website when there is no tagline for this room"
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setForm(null)} disabled={saving}>
                  Cancel
                </Button>
                <Button type="submit" disabled={saving}>
                  {saving ? 'Saving…' : form.id ? 'Save changes' : 'Add room type'}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default SetPricesPage
