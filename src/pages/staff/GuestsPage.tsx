import { useEffect, useState } from 'react'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '../../components/ui/dialog'
import { Plus, Users, Mail, Phone, Search, MoreVertical, Pencil, Trash2 } from 'lucide-react'
import { blink } from '../../blink/client'
import { activityLogService } from '@/services/activity-log-service'
import { bookingEngine } from '../../services/booking-engine'
import { toast } from 'sonner'
import { useStaffRole } from '@/hooks/use-staff-role'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '../../components/ui/dropdown-menu'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../components/ui/table"
import { Card, CardContent } from '../../components/ui/card'
import { formatCurrencySync } from '../../lib/utils'
import { useCurrency } from '../../hooks/use-currency'

export function GuestsPage() {
  const { currency } = useCurrency()
  const { role } = useStaffRole()
  const canDeleteGuests = role === 'admin' || role === 'manager' || role === 'owner'
  const [guests, setGuests] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    address: '',
    country: '',
    notes: ''
  })

  useEffect(() => {
    loadGuests()
  }, [])

  const loadGuests = async () => {
    try {
      // Fetch guests, bookings, rooms, and staff in parallel
      const [guestsData, bookingsData, roomsData, staffData] = await Promise.all([
        (blink.db as any).guests.list({ orderBy: { createdAt: 'desc' } }),
        (blink.db as any).bookings.list(),
        (blink.db as any).rooms.list(),
        (blink.db as any).staff.list({ include: ['user'] })
      ])

      // Map rooms for quick lookup
      const roomMap = new Map((roomsData || []).map((r: any) => [r.id, r.roomNumber]))

      // Map staff for name lookup (userId -> name)
      // Try to use staff name, fallback to user name if available
      const staffMap = new Map<string, string>((staffData || []).map((s: any) => {
        const name = s.name || s.user?.name || s.user?.email || 'Unknown Staff'
        return [s.userId, name] as [string, string]
      }))

      // Helper to resolve user name
      const resolveUserName = (userId?: string) => {
        if (!userId) return null
        return staffMap.get(userId) || 'System'
      }

      // Calculate stats per guest
      const guestStats = new Map<string, {
        revenue: number;
        lastBooking: {
          checkIn: string;
          checkOut: string;
          status: string;
          roomNumber: string;
          createdAt: string;
          source: string;
          createdBy?: string;
          createdByName?: string;
          checkInBy?: string;
          checkInByName?: string;
          checkOutBy?: string;
          checkOutByName?: string;
        } | null
      }>()

      bookingsData.forEach((booking: any) => {
        if (!booking.guestId) return

        // Skip cancelled bookings for stats
        if (booking.status === 'cancelled') return

        // Debug: Log booking check-in/out handler fields
        console.log('[GuestsPage] Booking for guest:', booking.guestId, 'Handler fields:', {
          checkInByName: booking.checkInByName,
          checkOutByName: booking.checkOutByName,
          status: booking.status
        })

        const current = guestStats.get(booking.guestId) || { revenue: 0, lastBooking: null }

        // Update revenue
        current.revenue += Number(booking.totalPrice || 0)

        // Determine if this booking should be the "displayed" one
        // Priority: 1. Checked-in (Active) 2. Most recent check-in date
        const bookingRoomNumber = roomMap.get(booking.roomId) || booking.roomNumber || ''

        const newBookingObj = {
          checkIn: booking.checkIn,
          checkOut: booking.checkOut,
          status: booking.status,
          roomNumber: bookingRoomNumber,
          createdAt: booking.createdAt,
          source: booking.source,
          createdBy: booking.createdBy || booking.created_by,
          createdByName: booking.createdByName || booking.created_by_name,
          checkInBy: booking.checkInBy || booking.check_in_by,
          checkInByName: booking.checkInByName || booking.check_in_by_name,
          checkOutBy: booking.checkOutBy || booking.check_out_by,
          checkOutByName: booking.checkOutByName || booking.check_out_by_name
        }

        if (!current.lastBooking) {
          current.lastBooking = newBookingObj
        } else {
          // If current stored is checked-in, keep it (unless this one is also checked-in and newer, which shouldn't happen usually)
          if (current.lastBooking.status === 'checked-in') {
            // Do nothing, keep the active check-in
          } else if (booking.status === 'checked-in') {
            // Found an active check-in, overwrite whatever was there
            current.lastBooking = newBookingObj
          } else {
            // Neither is checked-in, compare dates
            const newDate = new Date(booking.checkIn)
            const oldDate = new Date(current.lastBooking.checkIn)
            if (newDate > oldDate) {
              current.lastBooking = newBookingObj
            }
          }
        }

        guestStats.set(booking.guestId, current)
      })

      // Merge stats into guest objects
      const guestsWithStats = guestsData.map((guest: any) => {
        const stats = guestStats.get(guest.id) || { revenue: 0, lastBooking: null }

        // Debug: Log what history data we have for each guest
        // Note: Supabase wrapper converts snake_case to camelCase
        console.log('[GuestsPage] Guest:', guest.name, 'History fields:', {
          lastBookingDate: guest.lastBookingDate,
          lastSource: guest.lastSource,
          lastRoomNumber: guest.lastRoomNumber,
          lastCheckIn: guest.lastCheckIn,
          lastCheckOut: guest.lastCheckOut,
          totalRevenue: guest.totalRevenue,
          hasActiveBooking: !!stats.lastBooking
        })

        // If no active booking, use stored guest history as fallback
        // Check for ANY history field, not just createdAt
        const hasHistoryData = guest.lastBookingDate || guest.lastCheckIn || guest.lastRoomNumber || guest.lastSource
        const fallbackBooking = stats.lastBooking ? null : (hasHistoryData ? {
          createdAt: guest.lastBookingDate,
          source: guest.lastSource || 'reception',
          createdByName: guest.lastCreatedByName,
          roomNumber: guest.lastRoomNumber,
          checkIn: guest.lastCheckIn,
          checkOut: guest.lastCheckOut,
          checkInByName: guest.lastCheckInByName || guest.lastCreatedByName,
          checkOutByName: guest.lastCheckOutByName || guest.lastCreatedByName,
          status: 'checked-out' // Historical booking was completed
        } : null)

        return {
          ...guest,
          totalRevenue: stats.revenue || guest.totalRevenue || 0,
          lastBooking: stats.lastBooking || fallbackBooking
        }
      })

      setGuests(guestsWithStats)
      setStaffMap(staffMap)
    } catch (error) {
      console.error('Failed to load guests:', error)
      toast.error('Failed to load guests')
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const user = await blink.auth.me()
      if (editingId) {
        const oldGuest = guests.find(g => g.id === editingId)
        await blink.db.guests.update(editingId, {
          ...formData,
          userId: user.id,
          updatedAt: new Date().toISOString()
        })
        // Log activity
        await activityLogService.logGuestUpdated(editingId, {
          name: { old: oldGuest?.name, new: formData.name },
          email: { old: oldGuest?.email, new: formData.email },
          phone: { old: oldGuest?.phone, new: formData.phone },
        }, user.id).catch(err => console.error('Failed to log guest update:', err))
        toast.success('Guest updated')
      } else {
        const newGuestId = `guest_${Date.now()}`
        await blink.db.guests.create({
          id: newGuestId,
          userId: user.id,
          ...formData,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        })
        // Log activity
        await activityLogService.logGuestCreated(newGuestId, formData, user.id)
          .catch(err => console.error('Failed to log guest creation:', err))
        toast.success('Guest added successfully')
      }
      setDialogOpen(false)
      setEditingId(null)
      setFormData({ name: '', email: '', phone: '', address: '', country: '', notes: '' })
      loadGuests()
    } catch (error) {
      console.error('Failed to save guest:', error)
      toast.error('Failed to save guest')
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this guest? This will also delete all their bookings and history. This action cannot be undone.')) return
    try {
      const user = await blink.auth.me()
      const guest = guests.find(g => g.id === id)

      // 1. Delete associated bookings first (Cascade Delete)
      const guestBookings = await blink.db.bookings.list({ where: { guestId: id } })

      if (guestBookings.length > 0) {
        toast.message(`Deleting ${guestBookings.length} associated booking(s)...`)
        for (const booking of guestBookings) {
          try {
            await bookingEngine.deleteBooking(booking.id)
          } catch (err) {
            console.error(`Failed to delete booking ${booking.id}:`, err)
            // Continue deleting others even if one fails
          }
        }
      }

      // 2. Delete the guest
      await blink.db.guests.delete(id)

      // Log activity
      await activityLogService.logGuestDeleted(id, guest?.name || 'Unknown Guest', user.id)
        .catch(err => console.error('Failed to log guest deletion:', err))

      toast.success('Guest and associated data deleted')
      loadGuests()
    } catch (error) {
      console.error('Failed to delete guest:', error)
      toast.error('Failed to delete guest')
    }
  }

  const filteredGuests = guests.filter((guest: any) =>
    guest.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    guest.email?.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const getHandlerDisplay = (userId?: string) => {
    // We can't access staffMap here easily without refactoring, 
    // but the data is already resolved in loadGuests if we did it right... 
    // Wait, I didn't resolve names in loadGuests into the object.
    // Let's rely on the guest object having the IDs and we can fetch/lookup?
    // No, better to resolve names IN loadGuests and store them in lastBooking for display.
    // Let's modify loadGuests to modify the object structure above.
    return userId
  }

  // Refactor: We need a way to lookup names in the render.
  // Actually, let's keep it simple: we will just store the NAMES in the lastBooking object in loadGuests.
  // But wait, lastBooking object structure is defined in the Map generic.
  // Let's go back and ensure the Previous CHUNK handled resolving names? 
  // No, the previous chunk just stored the ID in 'checkInBy'.
  // I should update the 'newBookingObj' construction in the previous logic 
  // OR update the interface to store resolved names.
  // Let's Assume for this chunk I will display whatever is in 'checkInBy' 
  // and I will update the resolve logic in a separate chunk if needed or assume I did it?
  // Use a helper function inside the component? 
  // Let's inject a 'staffMap' state? 
  // Simplest: Resolve in loadGuests and store as 'checkInHandlerName'.

  // Actually, I can just use a state for staffMap.
  const [staffMap, setStaffMap] = useState<Map<string, string>>(new Map())

  // ... (inside loadGuests I will setStaffMap)

  // Let's adjust the PLAN. I will update loadGuests to SET the staffMap state.
  // And updated 'getHandlerDisplay' to use it.

  // But wait, I already wrote the first chunk without setStaffMap.
  // I can edit the first chunk? No, it's executed.
  // I will add 'setStaffMap(staffMap)' to the end of loadGuests in a NEW chunk.

  const resolveName = (id?: string) => {
    if (!id) return null
    return staffMap.get(id) || 'Staff'
  }

  const formatDate = (dateString: string | undefined) => {
    if (!dateString) return '-'
    return new Date(dateString).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    })
  }

  const getCheckOutDisplay = (booking: any) => {
    if (!booking) return '-'
    // If status is checked-in, user hasn't checked out yet
    if (booking.status === 'checked-in') {
      return <span className="text-orange-600 font-medium">Not yet</span>
    }
    return (
      <div className="flex flex-col">
        <span>{formatDate(booking.checkOut)}</span>
        {(booking.checkOutByName || booking.checkOutBy) && (
          <span className="text-[10px] text-muted-foreground">
            by {booking.checkOutByName || resolveName(booking.checkOutBy)}
          </span>
        )}
      </div>
    )
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
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold">Guests</h2>
          <p className="text-muted-foreground mt-1">Manage your guest database</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={() => {
              setEditingId(null)
              setFormData({ name: '', email: '', phone: '', address: '', country: '', notes: '' })
            }}>
              <Plus className="w-4 h-4 mr-2" />
              Add Guest
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingId ? 'Edit Guest' : 'Add New Guest'}</DialogTitle>
              <DialogDescription>Enter guest information</DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Full Name*</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                />
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phone">Phone</Label>
                  <Input
                    id="phone"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="address">Address</Label>
                <Input
                  id="address"
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="country">Country</Label>
                <Input
                  id="country"
                  value={formData.country}
                  onChange={(e) => setFormData({ ...formData, country: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="notes">Notes</Label>
                <textarea
                  id="notes"
                  className="w-full px-3 py-2 border rounded-md min-h-[80px]"
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                />
              </div>
              <div className="flex justify-end gap-3">
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit">{editingId ? 'Save Changes' : 'Add Guest'}</Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search guests by name or email..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pl-9"
        />
      </div>

      <div className="rounded-md border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Guest</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>Booked On</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Room No.</TableHead>
              <TableHead>Revenue</TableHead>
              <TableHead>Check In</TableHead>
              <TableHead>Check Out</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredGuests.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center">
                  <div className="flex flex-col items-center justify-center py-8">
                    <Users className="w-12 h-12 text-muted-foreground mb-4 opacity-50" />
                    <p className="text-lg font-medium text-muted-foreground">
                      {searchTerm ? 'No guests found' : 'No guests in the database'}
                    </p>
                    {!searchTerm && (
                      <Button variant="link" onClick={() => setDialogOpen(true)} className="mt-2">
                        Add your first guest
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              filteredGuests.map((guest) => (
                <TableRow key={guest.id}>
                  <TableCell className="font-medium">
                    <div className="flex flex-col">
                      <span className="text-base">{guest.name}</span>
                      {guest.country && (
                        <span className="text-xs text-muted-foreground">{guest.country}</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col text-sm text-muted-foreground">
                      {guest.email && (
                        <div className="flex items-center gap-1">
                          <Mail className="w-3 h-3" />
                          <span>{guest.email}</span>
                        </div>
                      )}
                      {guest.phone && (
                        <div className="flex items-center gap-1">
                          <Phone className="w-3 h-3" />
                          <span>{guest.phone}</span>
                        </div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {formatDate(guest.lastBooking?.createdAt)}
                  </TableCell>
                  <TableCell>
                    {(!guest.lastBooking?.source || guest.lastBooking?.source === 'online') ? (
                      <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                        Online
                      </span>
                    ) : (
                      <span className="text-sm text-muted-foreground">
                        Staff: {guest.lastBooking?.createdByName || resolveName(guest.lastBooking?.createdBy) || 'Unknown'}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>{guest.lastBooking?.roomNumber || '-'}</TableCell>
                  <TableCell>{formatCurrencySync(guest.totalRevenue || 0, currency)}</TableCell>
                  <TableCell>
                    <div className="flex flex-col">
                      <span>{formatDate(guest.lastBooking?.checkIn)}</span>
                      {(guest.lastBooking?.checkInByName || guest.lastBooking?.checkInBy) && (
                        <span className="text-[10px] text-muted-foreground">
                          by {guest.lastBooking?.checkInByName || resolveName(guest.lastBooking?.checkInBy)}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {getCheckOutDisplay(guest.lastBooking)}
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => {
                          setEditingId(guest.id)
                          setFormData({
                            name: guest.name || '',
                            email: guest.email || '',
                            phone: guest.phone || '',
                            address: guest.address || '',
                            country: guest.country || '',
                            notes: guest.notes || ''
                          })
                          setDialogOpen(true)
                        }}>
                          <Pencil className="h-4 w-4 mr-2" />
                          Edit
                        </DropdownMenuItem>
                        {canDeleteGuests && (
                          <DropdownMenuItem
                            onClick={() => handleDelete(guest.id)}
                            className="text-destructive"
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Delete
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
