import { useEffect, useState } from 'react'
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
      const user = await auth.me()

      // Load properties AND bookings
      const [data, allBookings] = await Promise.all([
        db.properties.list({
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
      const types = await (db as any).roomTypes.list({ orderBy: { column: 'createdAt', ascending: true } })

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
          await (db as any).roomTypes.create({
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
        const allTypes = await (db as any).roomTypes.list({ orderBy: { column: 'createdAt', ascending: true } })
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
      const user = await auth.me().catch(() => null)

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
        await db.properties.update(editingId, payload)
        // Sync with rooms table (canonical for bookings)
        await (db as any).rooms.update(editingId, {
          roomNumber: payload.roomNumber,
          status: (formData as any).status || 'active',
          updatedAt: payload.updatedAt
        }).catch((e: any) => console.warn('[PropertiesPage] Room sync failed:', e))
        
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
        await db.properties.create(createPayload)
        
        // Sync with rooms table (canonical for bookings)
        await (db as any).rooms.create({
          id: createPayload.id,
          roomNumber: createPayload.roomNumber,
          status: createPayload.status,
          createdAt: createPayload.createdAt,
          updatedAt: createPayload.updatedAt
        }).catch((e: any) => console.warn('[PropertiesPage] Room sync failed:', e))

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
      const propToDelete = properties.find(p => p.id === deleteId)
      await db.properties.delete(deleteId)
      await (db as any).rooms.delete(deleteId).catch(() => null)
      
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
                      <div className="flex items-center gap-2 mb-1.5">
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
                            propertyTypeId: property.propertyTypeId || (roomTypes.find(rt => rt.name.toLowerCase() === (property.propertyType || '').toLowerCase())?.id || ''),
                            bedrooms: Number(property.bedrooms ?? 1),
                            bathrooms: Number(property.bathrooms ?? 1),
                            maxGuests: Number(property.maxGuests ?? 2),
                            basePrice: Number(property.basePrice ?? 0),
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