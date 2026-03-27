import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '../../components/ui/dialog'
import { Plus, Building2, Bed, Users, DollarSign, MoreVertical, Pencil, Trash2, ShieldAlert } from 'lucide-react'
import { blink } from '../../blink/client'
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
import { formatCurrencySync } from '@/lib/utils'
import { useCurrency } from '@/hooks/use-currency'

export function PropertiesPage() {
  const permissions = usePermissions()
  const { currency } = useCurrency()
  const [properties, setProperties] = useState<any[]>([])
  const [bookings, setBookings] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([])
  const [formData, setFormData] = useState({
    name: '',
    roomNumber: '',
    address: '',
    propertyTypeId: '',
    bedrooms: 1,
    bathrooms: 1,
    maxGuests: 2,
    basePrice: 100,
    description: ''
  })

  useEffect(() => {
    loadRoomTypes()
  }, [])

  useEffect(() => {
    loadProperties()
  }, [roomTypes])

  const loadProperties = async () => {
    try {
      // Wait for authentication to be fully initialized
      const user = await blink.auth.me()

      // Load properties AND bookings
      const [data, allBookings] = await Promise.all([
        blink.db.properties.list({
          orderBy: { column: 'createdAt', ascending: false }
        }),
        bookingEngine.getAllBookings()
      ])

      setBookings(allBookings)

      // Derive room type by id first, fallback to name, and compute display fields
      const propertiesWithPrices = data.map((prop: any) => {
        const matchingType =
          roomTypes.find((rt) => rt.id === prop.propertyTypeId) ||
          roomTypes.find((rt) => rt.name.toLowerCase() === (prop.propertyType || '').toLowerCase())
        return {
          ...prop,
          roomTypeName: matchingType?.name || prop.propertyType || '',
          displayPrice: matchingType?.basePrice ?? 0
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

  // Helper to check room status
  const getRoomStatus = (property: any): { status: 'available' | 'occupied' | 'maintenance', booking?: any } => {
    if (!property.roomNumber) return { status: 'unknown' as any }
    if (property.status === 'maintenance') return { status: 'maintenance' }

    // Normalize today
    const todayIso = new Date().toISOString().split('T')[0]

    const activeBooking = bookings.find((b: any) => {
      // Check status
      if (b.status === 'cancelled' || !['reserved', 'confirmed', 'checked-in'].includes(b.status)) {
        return false
      }

      // Match room (handle both Room Number strings/numbers)
      // Note: bookingEngine returns bookings with normalized roomNumber usually
      if (String(b.roomNumber) !== String(property.roomNumber)) return false

      // Check date overlap with TODAY
      const checkIn = (b.dates?.checkIn || b.checkIn || '').split('T')[0]
      const checkOut = (b.dates?.checkOut || b.checkOut || '').split('T')[0]

      return checkIn <= todayIso && checkOut > todayIso
    })

    return activeBooking
      ? { status: 'occupied', booking: activeBooking }
      : { status: 'available' }
  }

  const loadRoomTypes = async () => {
    try {
      const types = await (blink.db as any).roomTypes.list<RoomType>({ orderBy: { column: 'createdAt', ascending: true } })

      // Ensure default types exist (robust check)
      const defaults = [
        { name: 'Standard Room', capacity: 2, basePrice: 100 },
        { name: 'Executive Suite', capacity: 2, basePrice: 250 },
        { name: 'Deluxe Room', capacity: 2, basePrice: 150 },
        { name: 'Family Room', capacity: 4, basePrice: 200 },
        { name: 'Presidential Suite', capacity: 5, basePrice: 500 }
      ]

      let seeded = false
      for (const def of defaults) {
        // Check if this specific type exists (case-insensitive)
        const exists = types.some(t => t.name?.toLowerCase() === def.name.toLowerCase())
        if (!exists) {
          await (blink.db as any).roomTypes.create({
            id: crypto.randomUUID(),
            ...def,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          })
          seeded = true
        }
      }

      if (seeded) {
        toast.info('Initializing missing room types...')
        // Reload if we added anything
        const allTypes = await (blink.db as any).roomTypes.list<RoomType>({ orderBy: { column: 'createdAt', ascending: true } })
        setRoomTypes(allTypes)
        if (!formData.propertyTypeId && allTypes.length > 0) {
          setFormData((prev) => ({ ...prev, propertyTypeId: allTypes[0].id }))
        }
        toast.success('Room types updated')
      } else {
        setRoomTypes(types)
        if (!formData.propertyTypeId && types.length > 0) {
          setFormData((prev) => ({ ...prev, propertyTypeId: types[0].id }))
        }
      }
    } catch (error) {
      console.error('Failed to load room types:', error)
    }
  }

  // Sync corresponding entry in rooms table so booking dropdown shows only created rooms
  const syncRoomWithProperty = async (payload: { roomNumber: string; propertyTypeId: string; basePrice: number }) => {
    const db = blink.db as any
    const rn = (payload.roomNumber || '').toString().trim()
    if (!rn) return
    const rtId = payload.propertyTypeId
    const price = Number(payload.basePrice) || 0
    try {
      const existing = (await db.rooms.list({ where: { roomNumber: rn }, limit: 1 }))?.[0]
      if (existing) {
        await db.rooms.update(existing.id, {
          roomTypeId: rtId,
          price,
          status: existing.status || 'available'
        })
      } else {
        await db.rooms.create({
          id: crypto.randomUUID(),
          roomNumber: rn,
          roomTypeId: rtId,
          status: 'available',
          price,
          imageUrls: ''
        })
      }
    } catch (e) {
      console.warn('Failed to sync room record:', e)
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

    try {
      // Get current user but don't require it - properties are project-scoped
      const user = await blink.auth.me().catch(() => null)

      if (!formData.propertyTypeId) {
        toast.error('Please select a room type')
        return
      }

      if (editingId) {
        const payload = {
          name: formData.name?.trim() || '',
          roomNumber: (formData.roomNumber ?? '').toString().trim(),
          address: formData.address?.trim() || '',
          propertyTypeId: formData.propertyTypeId || '',
          bedrooms: Number.isFinite(Number(formData.bedrooms)) ? Number(formData.bedrooms) : 0,
          bathrooms: Number.isFinite(Number(formData.bathrooms)) ? Number(formData.bathrooms) : 0,
          maxGuests: Number.isFinite(Number(formData.maxGuests)) ? Number(formData.maxGuests) : 1,
          basePrice: Number.isFinite(Number(formData.basePrice)) ? Number(formData.basePrice) : 0,
          description: formData.description || '',
          updatedAt: new Date().toISOString()
        }
        await blink.db.properties.update(editingId, payload)
        await syncRoomWithProperty({ roomNumber: payload.roomNumber, propertyTypeId: payload.propertyTypeId, basePrice: payload.basePrice })
        toast.success('Room updated')

        // Log room update
        try {
          const userId = user?.id || 'system'
          await activityLogService.log({
            action: 'updated',
            entityType: 'room',
            entityId: editingId,
            details: {
              roomName: payload.name,
              roomNumber: payload.roomNumber,
              roomType: roomTypes.find(rt => rt.id === payload.propertyTypeId)?.name || '',
              basePrice: payload.basePrice,
              maxGuests: payload.maxGuests,
              updatedAt: new Date().toISOString()
            },
            userId
          })
        } catch (logError) {
          console.error('Activity logging failed:', logError)
        }
      } else {
        // Create property with explicit field mapping to match database schema
        // Note: properties table doesn't have a user_id column
        const createPayload = {
          id: crypto.randomUUID(),
          name: formData.name?.trim() || '',
          roomNumber: (formData.roomNumber ?? '').toString().trim(),
          address: formData.address?.trim() || '',
          propertyTypeId: formData.propertyTypeId || '',
          bedrooms: Number.isFinite(Number(formData.bedrooms)) ? Number(formData.bedrooms) : 1,
          bathrooms: Number.isFinite(Number(formData.bathrooms)) ? Number(formData.bathrooms) : 1,
          maxGuests: Number.isFinite(Number(formData.maxGuests)) ? Number(formData.maxGuests) : 2,
          basePrice: Number.isFinite(Number(formData.basePrice)) ? Number(formData.basePrice) : 100,
          description: formData.description || '',
          status: 'active',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
        console.log('[PropertiesPage] Creating property with payload:', createPayload)
        await blink.db.properties.create(createPayload)
        await syncRoomWithProperty({ roomNumber: createPayload.roomNumber, propertyTypeId: createPayload.propertyTypeId, basePrice: createPayload.basePrice })
        toast.success('Room added successfully')

        // Log room creation
        try {
          const userId = user?.id || 'system'
          await activityLogService.log({
            action: 'created',
            entityType: 'room',
            entityId: createPayload.id,
            details: {
              roomName: createPayload.name,
              roomNumber: createPayload.roomNumber,
              roomType: roomTypes.find(rt => rt.id === createPayload.propertyTypeId)?.name || '',
              basePrice: createPayload.basePrice,
              maxGuests: createPayload.maxGuests,
              createdAt: new Date().toISOString()
            },
            userId
          })
        } catch (logError) {
          console.error('Activity logging failed:', logError)
        }
      }
      setDialogOpen(false)
      setEditingId(null)
      setFormData({
        name: '',
        roomNumber: '',
        address: '',
        propertyTypeId: roomTypes[0]?.id || '',
        bedrooms: 1,
        bathrooms: 1,
        maxGuests: 2,
        basePrice: 100,
        description: ''
      })
      loadProperties()
    } catch (error) {
      console.error('Failed to save room:', error)
      toast.error('Failed to save room')
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
      // Find property to know its roomNumber for room sync delete
      const prop = (await blink.db.properties.list({ where: { id: deleteId }, limit: 1 }))?.[0]
      await blink.db.properties.delete(deleteId)
      if (prop?.roomNumber) {
        try {
          const existing = (await (blink.db as any).rooms.list({ where: { roomNumber: String(prop.roomNumber).trim() }, limit: 1 }))?.[0]
          if (existing) {
            await (blink.db as any).rooms.delete(existing.id)
          }
        } catch (e) {
          console.warn('Failed to delete synced room record:', e)
        }
      }
      toast.success('Room deleted')

      // Log room deletion
      try {
        const user = await blink.auth.me().catch(() => null)
        await activityLogService.log({
          action: 'deleted',
          entityType: 'room',
          entityId: deleteId,
          details: {
            roomNumber: prop?.roomNumber || 'unknown',
            roomName: prop?.name || '',
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
    return (
      <div className="flex items-center justify-center h-96">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
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
              setFormData({
                name: '',
                roomNumber: '',
                address: '',
                propertyTypeId: roomTypes[0]?.id || '',
                bedrooms: 1,
                bathrooms: 1,
                maxGuests: 2,
                basePrice: 100,
                description: ''
              })
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
              <div className="grid gap-4 md:grid-cols-3">
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
                  <Label htmlFor="roomNumber">Room Number</Label>
                  <Input
                    id="roomNumber"
                    value={formData.roomNumber}
                    onChange={(e) => setFormData({ ...formData, roomNumber: e.target.value })}
                    placeholder="101"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="propertyTypeId">Room Type</Label>
                  <select
                    id="propertyTypeId"
                    className="w-full px-3 py-2 border rounded-md"
                    value={formData.propertyTypeId}
                    onChange={(e) => setFormData({ ...formData, propertyTypeId: e.target.value })}
                    required
                  >
                    {!formData.propertyTypeId && <option value="">Select type</option>}
                    {roomTypes.length > 0 ? (
                      roomTypes.map((rt) => (
                        <option key={rt.id} value={rt.id}>{rt.name}</option>
                      ))
                    ) : (
                      /* Fallback options if room types not loaded from database */
                      <>
                        <option value="standard_room">Standard Room</option>
                        <option value="executive_suite">Executive Suite</option>
                        <option value="deluxe_room">Deluxe Room</option>
                        <option value="family_room">Family Room</option>
                        <option value="presidential_suite">Presidential Suite</option>
                      </>
                    )}
                  </select>
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
                <Label htmlFor="basePrice">Price (per night)</Label>
                <Input
                  id="basePrice"
                  type="number"
                  min="0"
                  step="0.01"
                  value={formData.basePrice}
                  onChange={(e) => setFormData({ ...formData, basePrice: parseFloat(e.target.value) })}
                />
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
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit">{editingId ? 'Save Changes' : 'Add Room'}</Button>
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
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {properties.map((property: any) => {
            const { status, booking } = getRoomStatus(property)

            let statusColor = 'bg-green-500'
            let statusText = 'Available'
            let tooltipText = 'Room is available for booking'

            if (status === 'occupied') {
              statusColor = 'bg-red-500'
              statusText = 'Occupied'
              if (booking) {
                const guestName = booking.guest?.fullName || booking.guest?.name || 'Guest'
                const checkOut = (booking.dates?.checkOut || booking.checkOut || '').split('T')[0]
                tooltipText = `Occupied by ${guestName} until ${checkOut}`
              }
            } else if (status === 'maintenance') {
              statusColor = 'bg-yellow-500'
              statusText = 'Maintenance'
              tooltipText = 'Room is under maintenance'
            }

            return (
              <Card key={property.id} className="hover:shadow-lg transition-shadow relative overflow-hidden" title={tooltipText}>
                {/* Status Badge */}
                <div className={`absolute top-0 right-0 px-3 py-1 text-xs font-bold text-white rounded-bl-lg z-10 ${statusColor}`}>
                  {statusText}
                </div>

                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex-1 pr-8">
                      <CardTitle className="line-clamp-1">{property.name}</CardTitle>
                      <CardDescription className="line-clamp-1 mt-1">
                        {property.roomNumber ? `Room ${property.roomNumber}` : ''}
                        {property.roomNumber && (property.roomTypeName || property.propertyType) ? ' • ' : ''}
                        {property.roomTypeName || property.propertyType || ''}
                      </CardDescription>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => {
                          setEditingId(property.id)
                          setFormData({
                            name: property.name || '',
                            roomNumber: property.roomNumber || '',
                            address: property.address || '',
                            propertyTypeId: property.propertyTypeId || (roomTypes.find(rt => rt.name.toLowerCase() === (property.propertyType || '').toLowerCase())?.id || ''),
                            bedrooms: Number(property.bedrooms ?? 1),
                            bathrooms: Number(property.bathrooms ?? 1),
                            maxGuests: Number(property.maxGuests ?? 2),
                            basePrice: Number(property.basePrice ?? 0),
                            description: property.description || ''
                          })
                          setDialogOpen(true)
                        }}>
                          <Pencil className="h-4 w-4 mr-2" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => handleDeleteClick(property.id)}
                          className="text-destructive"
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {property.roomNumber && (
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <Building2 className="w-4 h-4" />
                        <span>{property.roomNumber}</span>
                      </div>
                    </div>
                  )}
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <Bed className="w-4 h-4" />
                      <span>{property.bedrooms}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Users className="w-4 h-4" />
                      <span>{property.maxGuests}</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between pt-2 border-t">
                    <div className="flex items-center gap-1 text-primary font-semibold">
                      <span>{formatCurrencySync(property.displayPrice, currency)}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">per night</span>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

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