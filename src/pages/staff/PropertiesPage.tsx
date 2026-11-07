import { BrandLoader } from '@/components/BrandLoader'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useSubscription } from '@/hooks/use-subscription'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '../../components/ui/dialog'
import { Plus, Building2, Bed, Users, DollarSign, MoreVertical, Pencil, Trash2, ShieldAlert } from 'lucide-react'
import { db, auth } from '@/lib/db'
import { bookingEngine } from '@/services/booking-engine'
import type { RoomType } from '@/types'
import { toast } from 'sonner'
import { activityLogService } from '@/services/activity-log-service'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '../../components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../components/ui/alert-dialog"
import { usePermissions } from '@/hooks/use-permissions'
import { Permission } from '@/components/Permission'
import { RoomLockNumbers } from '@/components/RoomLockNumbers'
import { DoorStatusChip } from '@/components/DoorStatus'
import { useDoorStatus } from '@/hooks/use-door-status'
import { useIsAdmin } from '@/hooks/use-is-admin'
import { cn, formatCurrencySync } from '@/lib/utils'
import { useCurrency } from '@/hooks/use-currency'
import {
  canonicalRoomTypes,
  groupOf,
  linkedTypeId,
  newRoomMirrorRow,
  newRoomRow,
  normalizeName,
  roomFields,
  roomMirrorFields,
  roomWithNumber,
  typeCapacity,
  typePrice,
} from '@/lib/room-types'

const EMPTY_FORM = {
  name: '',
  roomNumber: '',
  address: '',
  propertyTypeId: '',
  bedrooms: 1,
  bathrooms: 1,
  maxGuests: 2,
  description: ''
}

/**
 * Keep the legacy `rooms` row in step with the room. Bookings point at it and
 * the AI concierge reads it. A failure is not fatal: the booking engine
 * creates a missing row before the room's first booking.
 */
async function syncRoomMirror(id: string, room: { roomNumber: string; roomTypeId: string; price: number | null }) {
  try {
    const existing = await (db as any).rooms.get(id).catch(() => null)
    if (existing) await (db as any).rooms.update(id, roomMirrorFields(room))
    else await (db as any).rooms.create(newRoomMirrorRow(id, room), { returning: 'minimal' })
  } catch (e) {
    console.warn('[PropertiesPage] Room mirror sync failed for', room.roomNumber, e)
  }
}

export function PropertiesPage() {
  const permissions = usePermissions()
  const { isAdmin } = useIsAdmin()
  const { currency } = useCurrency()
  const doors = useDoorStatus()
  const [properties, setProperties] = useState<any[]>([])
  const [bookings, setBookings] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([])
  const [saving, setSaving] = useState(false)
  const [formData, setFormData] = useState(EMPTY_FORM)

  // One choice per room type: the row the website shows and bookings charge,
  // not the ~65 old duplicates the page's former auto-seeding left behind.
  const typeGroups = useMemo(
    () => canonicalRoomTypes(roomTypes as any[], properties).sort((a, b) => String(a.type.name).localeCompare(String(b.type.name))),
    [roomTypes, properties]
  )
  const selectedType = typeGroups.find((g) => g.type.id === formData.propertyTypeId)?.type

  /** The room type a room should be edited under: its own, or the live row of the same name. */
  const typeForRoom = (property: any): string => {
    const own = groupOf(typeGroups, linkedTypeId(property))
    if (own) return own.type.id
    const byName = typeGroups.find((g) => normalizeName(g.type.name) === normalizeName(property.propertyType))
    return byName?.type.id || ''
  }

  const chooseType = (typeId: string) => {
    const type = typeGroups.find((g) => g.type.id === typeId)?.type
    setFormData((prev) => ({ ...prev, propertyTypeId: typeId, maxGuests: typeCapacity(type) ?? prev.maxGuests }))
  }

  useEffect(() => {
    loadRoomTypes()
  }, [])

  // Realtime: refresh whenever room/property rows, bookings, housekeeping
  // tasks, or room-type prices change so admins see status transitions
  // (occupied -> cleaning -> available) AND price edits without a manual
  // reload.
  const propertiesUpdated = useSubscription('properties')
  const bookingsUpdated = useSubscription('bookings')
  const tasksUpdated = useSubscription('housekeeping_tasks')
  const roomTypesUpdated = useSubscription('room_types')

  useEffect(() => {
    // Re-pull room types when the table emits a realtime update so the
    // matching loop downstream sees the new prices on the next render.
    loadRoomTypes()
  }, [roomTypesUpdated])

  useEffect(() => {
    loadProperties()
  }, [roomTypes, propertiesUpdated, bookingsUpdated, tasksUpdated])

  const loadProperties = async () => {
    try {
      // Wait for authentication to be fully initialized
      const user = await auth.me()

      // Load properties AND bookings
      const [data, allBookings] = await Promise.all([
        db.properties.list({
          orderBy: { column: 'createdAt', ascending: false }
        }),
        bookingEngine.getAllBookings()
      ])

      setBookings(allBookings)

      // Derive room type by id first, then by name (case-insensitive), and
      // compute the display price with a robust fallback chain so the cards
      // never show GHC0 when a real price exists somewhere in the row.
      //
      // Price source priority:
      //   1. matching room type's basePrice  (what bookings charge, edited via Set Prices)
      //   2. property's own basePrice        (the room's copy of it)
      //   3. property's legacy `price` field (older rows pre-rename)
      //   4. 0                                (genuinely unpriced)
      const propertiesWithPrices = data.map((prop: any) => {
        const matchingType =
          roomTypes.find((rt) => rt.id === prop.propertyTypeId) ||
          roomTypes.find((rt) => (rt.name || '').toLowerCase() === (prop.propertyType || '').toLowerCase())

        const rate = Number(matchingType?.basePrice ?? 0)
        const ownPrice = Number(prop.basePrice ?? prop.price ?? 0)
        const displayPrice = rate > 0 ? rate : ownPrice

        return {
          ...prop,
          roomTypeName: matchingType?.name || prop.propertyType || '',
          displayPrice,
        }
      })

      setProperties(propertiesWithPrices)
    } catch (error) {
      console.error('Failed to load rooms:', error)
      toast.error('Failed to load rooms')
    } finally {
      setLoading(false)
    }
  }

  // Helper to check room status.
  //
  // Lifecycle source of truth:
  //   property.status = 'occupied' | 'cleaning' | 'maintenance' | 'available' | 'active' | null
  //
  // Transitions (driven by other parts of the app):
  //   - Check-in     -> 'occupied'   (src/hooks/use-check-in.ts)
  //   - Check-out    -> 'cleaning'   (src/services/booking-engine.ts updateBookingStatus)
  //   - Task done    -> 'available'  (src/services/housekeeping-service.ts + HousekeepingPage)
  //   - Task deleted -> 'available'  (HousekeepingPage confirmDelete / bulk delete)
  //
  // 'available' and the legacy 'active' both mean "free"; either is fine.
  const getRoomStatus = (property: any): { status: 'available' | 'occupied' | 'maintenance' | 'cleaning', booking?: any } => {
    if (!property.roomNumber) return { status: 'unknown' as any }

    const dbStatus = String(property.status || '').toLowerCase()

    // Direct DB states win first — they reflect explicit lifecycle moves.
    if (dbStatus === 'maintenance') return { status: 'maintenance' }
    if (dbStatus === 'cleaning')    return { status: 'cleaning' }

    // Normalize today
    const todayIso = new Date().toISOString().split('T')[0]

    const activeBooking = bookings.find((b: any) => {
      if (b.status === 'cancelled' || !['reserved', 'confirmed', 'checked-in'].includes(b.status)) {
        return false
      }
      if (String(b.roomNumber) !== String(property.roomNumber)) return false
      const checkIn = (b.dates?.checkIn || b.checkIn || '').split('T')[0]
      const checkOut = (b.dates?.checkOut || b.checkOut || '').split('T')[0]
      return checkIn <= todayIso && checkOut > todayIso
    })

    // DB says occupied OR a checked-in/confirmed booking covers today -> occupied.
    if (dbStatus === 'occupied' || activeBooking) {
      return { status: 'occupied', booking: activeBooking }
    }

    return { status: 'available' }
  }

  // Read only. This used to create any of five default types it could not
  // find, at old prices. Each insert's realtime echo re-ran the check before
  // the earlier inserts were visible, so one visit could add dozens of
  // duplicate types (57 in 18 seconds on 2026-06-05). Types are now added on
  // the Set Prices page.
  const loadRoomTypes = async () => {
    try {
      const types = await (db as any).roomTypes.list({ orderBy: { column: 'createdAt', ascending: true } })
      setRoomTypes(types)
    } catch (error) {
      console.error('Failed to load room types:', error)
      toast.error('Could not load room types', { description: 'Press Refresh in your browser to try again.' })
    }
  }


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    // Check permissions before creating/updating
    const action = editingId ? 'update' : 'create'
    if (!permissions.can('properties', action)) {
      toast.error('Permission denied', {
        description: `You do not have permission to ${action} properties`
      })
      return
    }

    const name = formData.name.trim()
    const roomNumber = (formData.roomNumber ?? '').toString().trim()
    const type = selectedType

    if (!name) {
      toast.error('Give the room a name')
      return
    }
    if (!roomNumber) {
      toast.error('Enter a room number', { description: 'Bookings, housekeeping and the calendar find rooms by number.' })
      return
    }
    const clash = roomWithNumber(properties, roomNumber, editingId ?? undefined)
    if (clash) {
      toast.error(`Room number ${roomNumber} is already used by ${clash.name || 'another room'}`)
      return
    }
    if (!type) {
      toast.error('Choose a room type')
      return
    }

    // The room's price is its type's price: that is what the website shows
    // and every booking charges. The room keeps a copy so the two agree.
    const fields = roomFields({ ...formData, name, roomNumber }, type)
    const basePrice = fields.basePrice
    const typeName = type.name

    setSaving(true)
    try {
      // Get current user but don't require it - properties are project-scoped
      const user = await auth.me().catch(() => null)
      const now = fields.updatedAt

      let roomId = editingId
      if (roomId) {
        await db.properties.update(roomId, fields)
      } else {
        roomId = crypto.randomUUID()
        await db.properties.create(newRoomRow(roomId, fields))
      }
      await syncRoomMirror(roomId, { roomNumber, roomTypeId: type.id, price: basePrice })

      toast.success(editingId ? 'Room updated' : `Room ${roomNumber} added as ${typeName}`)

      try {
        await activityLogService.log({
          action: editingId ? 'updated' : 'created',
          entityType: 'room',
          entityId: roomId,
          details: {
            roomName: name,
            roomNumber,
            roomType: typeName,
            basePrice,
            maxGuests: fields.maxGuests,
            [editingId ? 'updatedAt' : 'createdAt']: now
          },
          userId: user?.id || 'system'
        })
      } catch (logError) {
        console.error('Activity logging failed:', logError)
      }

      setDialogOpen(false)
      setEditingId(null)
      setFormData(EMPTY_FORM)
      loadProperties()
    } catch (error: any) {
      console.error('Failed to save room:', error)
      toast.error('Failed to save room', { description: error?.message })
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteClick = (id: string) => {
    setDeleteId(id)
  }

  const confirmDelete = async () => {
    if (!deleteId) return

    // Check delete permission
    if (!permissions.can('properties', 'delete')) {
      toast.error('Permission denied', {
        description: 'You do not have permission to delete properties'
      })
      setDeleteId(null)
      return
    }

    try {
      const propToDelete = properties.find(p => p.id === deleteId)

      // A room with bookings must stay. Its bookings point at it, so the
      // database refuses to drop its `rooms` row; deleting the room from this
      // list anyway used to leave that row behind and the bookings showing no
      // room number.
      const bookingCount = await db.bookings.count({ where: { roomId: deleteId } })
      if (bookingCount === null) throw new Error('Could not check the room for bookings')
      if (bookingCount > 0) {
        toast.error(`Room ${propToDelete?.roomNumber || ''} has ${bookingCount} booking${bookingCount === 1 ? '' : 's'} on record, so it can't be deleted`, {
          description: 'Edit it instead: change its name, number or room type.'
        })
        return
      }

      await db.properties.delete(deleteId)
      await (db as any).rooms.delete(deleteId).catch((e: any) => console.warn('[PropertiesPage] Room mirror delete failed:', e))

      toast.success('Room deleted')

      // Log room deletion
      try {
        const user = await auth.me().catch(() => null)
        await activityLogService.log({
          action: 'deleted',
          entityType: 'room',
          entityId: deleteId,
          details: {
            roomNumber: propToDelete?.roomNumber || 'unknown',
            roomName: propToDelete?.name || '',
            deletedAt: new Date().toISOString()
          },
          userId: user?.id || 'system'
        })
      } catch (logError) {
        console.error('Activity logging failed:', logError)
      }

      loadProperties()
    } catch (error) {
      console.error('Failed to delete room:', error)
      toast.error('Failed to delete room')
    } finally {
      setDeleteId(null)
    }
  }

  if (loading) {
    return <BrandLoader label="Loading rooms" />
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="p-1.5 rounded-lg bg-primary/10">
              <Building2 className="w-5 h-5 text-primary" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">Rooms</h1>
          </div>
          <p className="text-sm text-muted-foreground">Manage your rooms inventory — {properties.length} total</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={() => {
              setEditingId(null)
              setFormData(EMPTY_FORM)
            }}>
              <Plus className="w-4 h-4 mr-2" />
              Add Room
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingId ? 'Edit Room' : 'Add New Room'}</DialogTitle>
              <DialogDescription>Enter the room details</DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="name">Room Name*</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    required
                    placeholder="Deluxe King"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="roomNumber">Room Number*</Label>
                  <Input
                    id="roomNumber"
                    value={formData.roomNumber}
                    onChange={(e) => setFormData({ ...formData, roomNumber: e.target.value })}
                    required
                    placeholder="101"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="propertyTypeId">Room Type*</Label>
                <select
                  id="propertyTypeId"
                  className="w-full px-3 py-2 border rounded-md bg-background"
                  value={formData.propertyTypeId}
                  onChange={(e) => chooseType(e.target.value)}
                  required
                >
                  <option value="" disabled>{typeGroups.length ? 'Choose a room type' : 'No room types yet: add one in Set Prices'}</option>
                  {typeGroups.map(({ type }) => {
                    const rate = typePrice(type)
                    const cap = typeCapacity(type)
                    return (
                      <option key={type.id} value={type.id}>
                        {type.name} · {rate !== null ? `${formatCurrencySync(rate, currency)} per night` : 'no price set'}{cap ? ` · up to ${cap} guests` : ''}
                      </option>
                    )
                  })}
                </select>
                <div className="rounded-md border bg-stone-50 px-3 py-2 text-sm space-y-1">
                  {selectedType ? (
                    typePrice(selectedType) !== null ? (
                      <p>
                        This room will be sold at <span className="font-semibold">{formatCurrencySync(typePrice(selectedType)!, currency)} per night</span>, the {selectedType.name} price.{' '}
                        <Link to="/staff/set-prices" className="text-primary underline underline-offset-2">Change it in Set Prices</Link>.
                      </p>
                    ) : (
                      <p className="text-amber-700">
                        {selectedType.name} has no price yet, so it can't be booked. <Link to="/staff/set-prices" className="underline underline-offset-2">Set one in Set Prices</Link>.
                      </p>
                    )
                  ) : (
                    <p className="text-muted-foreground">A room's price per night comes from its room type.</p>
                  )}
                  <p className="text-muted-foreground">
                    Selling it at a different price, or a new kind of room? <Link to="/staff/set-prices" className="text-primary underline underline-offset-2">Add a room type in Set Prices</Link> first.
                  </p>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="bedrooms">Number of Beds</Label>
                  <Input
                    id="bedrooms"
                    type="number"
                    min="0"
                    value={formData.bedrooms}
                    onChange={(e) => setFormData({ ...formData, bedrooms: parseInt(e.target.value) })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="bathrooms">Bathrooms</Label>
                  <Input
                    id="bathrooms"
                    type="number"
                    min="0"
                    value={formData.bathrooms}
                    onChange={(e) => setFormData({ ...formData, bathrooms: parseInt(e.target.value) })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="maxGuests">Max Guests</Label>
                  <Input
                    id="maxGuests"
                    type="number"
                    min="1"
                    value={formData.maxGuests}
                    onChange={(e) => setFormData({ ...formData, maxGuests: parseInt(e.target.value) })}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <textarea
                  id="description"
                  className="w-full px-3 py-2 border rounded-md min-h-[100px]"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Describe your room..."
                />
              </div>

              <div className="flex justify-end gap-3">
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
                  Cancel
                </Button>
                <Button type="submit" disabled={saving}>{saving ? 'Saving…' : editingId ? 'Save Changes' : 'Add Room'}</Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {properties.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Building2 className="w-16 h-16 text-muted-foreground mb-4 opacity-50" />
            <h3 className="text-xl font-semibold mb-2">No Rooms Yet</h3>
            <p className="text-muted-foreground text-center mb-6 max-w-md">
              Get started by adding your first room to the system
            </p>
            <Button onClick={() => setDialogOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Add Your First Room
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {properties.map((property: any) => {
            const { status, booking } = getRoomStatus(property)

            let statusColor = 'bg-emerald-500'
            let statusBg = 'bg-emerald-50 text-emerald-700 border-emerald-100'
            let statusText = 'Available'
            let tooltipText = 'Room is available for booking'

            if (status === 'occupied') {
              statusColor = 'bg-rose-500'
              statusBg = 'bg-rose-50 text-rose-700 border-rose-100'
              statusText = 'Occupied'
              if (booking) {
                const guestName = booking.guest?.fullName || booking.guest?.name || 'Guest'
                const checkOut = (booking.dates?.checkOut || booking.checkOut || '').split('T')[0]
                tooltipText = `Occupied by ${guestName} until ${checkOut}`
              }
            } else if (status === 'cleaning') {
              statusColor = 'bg-sky-500'
              statusBg = 'bg-sky-50 text-sky-700 border-sky-100'
              statusText = 'Cleaning'
              tooltipText = 'Awaiting housekeeping — room becomes available when the cleaning task is completed.'
            } else if (status === 'maintenance') {
              statusColor = 'bg-amber-500'
              statusBg = 'bg-amber-50 text-amber-700 border-amber-100'
              statusText = 'Maintenance'
              tooltipText = 'Room is under maintenance'
            }

            return (
              <Card 
                key={property.id} 
                className="group relative overflow-hidden border-border/40 hover:border-primary/20 hover:shadow-xl transition-all duration-300 active:scale-[0.98] sm:active:scale-100" 
                title={tooltipText}
              >
                {/* Visual Status Indicator (Mobile Focused) */}
                <div className={cn("absolute top-0 right-0 h-1.5 w-1/3 rounded-bl-full z-10", statusColor)} />

                <CardHeader className="p-4 sm:p-6 pb-2">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0 pr-4">
                      <div className="flex flex-wrap items-center gap-2 mb-1.5">
                        <span className={cn(
                          "px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border",
                          statusBg
                        )}>
                          {statusText}
                        </span>
                        {property.roomNumber && (
                          <span className="text-[10px] font-black bg-stone-100 text-stone-600 px-2 py-0.5 rounded shadow-sm">
                            #{property.roomNumber}
                          </span>
                        )}
                        <DoorStatusChip status={doors?.byRoomId.get(property.id) ?? doors?.byRoomNumber.get(String(property.roomNumber ?? ''))} />
                      </div>
                      <CardTitle className="text-lg font-bold leading-tight text-stone-800 line-clamp-1 group-hover:text-primary transition-colors">
                        {property.name}
                      </CardTitle>
                      <p className="text-xs font-medium text-stone-400 mt-0.5 truncate">
                        {property.roomTypeName || property.propertyType || 'Standard Unit'}
                      </p>
                    </div>

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-10 w-10 -mt-1 -mr-2 rounded-full hover:bg-stone-100 active:bg-stone-200 shrink-0">
                          <MoreVertical className="h-5 w-5 text-stone-400" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48">
                        <DropdownMenuItem onClick={() => {
                          setEditingId(property.id)
                          setFormData({
                            name: property.name || '',
                            roomNumber: property.roomNumber || '',
                            address: property.address || '',
                            propertyTypeId: typeForRoom(property),
                            bedrooms: Number(property.bedrooms ?? 1),
                            bathrooms: Number(property.bathrooms ?? 1),
                            maxGuests: Number(property.maxGuests ?? 2),
                            description: property.description || ''
                          })
                          setDialogOpen(true)
                        }} className="py-2.5">
                          <Pencil className="h-4 w-4 mr-2" />
                          Edit Details
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => handleDeleteClick(property.id)}
                          className="text-destructive focus:text-destructive py-2.5"
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Delete Room
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </CardHeader>

                <CardContent className="p-4 sm:p-6 pt-2 space-y-4">
                  {/* Features Grid */}
                  <div className="grid grid-cols-2 gap-3 bg-stone-50/50 rounded-xl p-3 border border-stone-100/50">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded-lg bg-white shadow-sm border border-stone-100">
                        <Bed className="w-3.5 h-3.5 text-primary" />
                      </div>
                      <div className="flex flex-col">
                        <span className="text-[10px] font-bold text-stone-400 uppercase tracking-tighter leading-none">Beds</span>
                        <span className="text-xs font-bold text-stone-700">{property.bedrooms} Units</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 border-l border-stone-200 pl-3">
                      <div className="p-1.5 rounded-lg bg-white shadow-sm border border-stone-100">
                        <Users className="w-3.5 h-3.5 text-primary" />
                      </div>
                      <div className="flex flex-col">
                        <span className="text-[10px] font-bold text-stone-400 uppercase tracking-tighter leading-none">Guests</span>
                        <span className="text-xs font-bold text-stone-700">Max {property.maxGuests}</span>
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-between pt-1">
                    <div className="flex flex-col">
                      <span className="text-xl font-black text-primary tracking-tighter leading-none">
                        {formatCurrencySync(property.displayPrice, currency)}
                      </span>
                      <span className="text-[10px] text-stone-400 font-bold uppercase tracking-widest mt-1">per night</span>
                    </div>
                    <Button variant="outline" size="sm" className="h-9 px-4 rounded-xl text-[11px] font-bold uppercase tracking-wider border-stone-200 hover:bg-primary hover:text-white hover:border-primary transition-all duration-300">
                      View Details
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {isAdmin && properties.length > 0 && <RoomLockNumbers rooms={properties} />}

      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the room property.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}