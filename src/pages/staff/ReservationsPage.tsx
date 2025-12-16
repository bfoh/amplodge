import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { blink } from '@/blink/client'
import type { Booking, Room, Guest } from '@/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Download, Loader2 } from 'lucide-react'
import { format, parseISO, isBefore, isAfter } from 'date-fns'
import { formatCurrencySync } from '@/lib/utils'
import { useCurrency } from '@/hooks/use-currency'
import { toast } from 'sonner'
import { createInvoiceData, downloadInvoicePDF, generateInvoicePDF, sendInvoiceEmail } from '@/services/invoice-service'
import { activityLogService } from '@/services/activity-log-service'
import { housekeepingService } from '@/services/housekeeping-service'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { LogIn, LogOut, CheckCircle2 } from 'lucide-react'
import { calculateNights } from '@/lib/display'

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    confirmed: 'bg-emerald-100 text-emerald-700',
    'checked-in': 'bg-blue-100 text-blue-700',
    'checked-out': 'bg-gray-100 text-gray-700',
    cancelled: 'bg-rose-100 text-rose-700',
    reserved: 'bg-amber-100 text-amber-700'
  }
  const cls = map[status] || 'bg-secondary text-foreground'
  return <span className={`text-xs px-2 py-1 rounded-full ${cls}`}>{status}</span>
}

export function ReservationsPage() {
  const db = (blink.db as any)
  const navigate = useNavigate()
  const { currency } = useCurrency()
  const [user, setUser] = useState<any>(null)
  const [bookings, setBookings] = useState<Booking[]>([])
  const [rooms, setRooms] = useState<Room[]>([])
  const [guests, setGuests] = useState<Guest[]>([])

  // Filters
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<'all' | Booking['status']>('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [loading, setLoading] = useState(true)
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [processing, setProcessing] = useState(false)

  // Check-in/out dialogs
  const [checkInDialog, setCheckInDialog] = useState<Booking | null>(null)
  const [checkOutDialog, setCheckOutDialog] = useState<Booking | null>(null)
  const [downloadingInvoice, setDownloadingInvoice] = useState<string | null>(null)

  useEffect(() => {
    const unsub = blink.auth.onAuthStateChanged((state) => {
      setUser(state.user)
      if (!state.user && !state.isLoading) navigate('/staff')
    })
    return unsub
  }, [navigate])

  useEffect(() => {
    if (!user) return
    const load = async () => {
      try {
        const [b, r, g] = await Promise.all([
          db.bookings.list({ orderBy: { createdAt: 'desc' }, limit: 500 }),
          db.rooms.list({ limit: 500 }),
          db.guests.list({ limit: 500 })
        ])

        // Create temporary maps for lookup during deduplication
        const tempRoomMap = new Map(r.map((rm: Room) => [rm.id, rm]))
        const tempGuestMap = new Map(g.map((gm: Guest) => [gm.id, gm]))

        // Deduplicate bookings based on guest details, room, and normalized dates
        // When duplicates with different statuses exist, keep the one with more advanced status
        const statusPriority: Record<string, number> = {
          'checked-out': 5,
          'checked-in': 4,
          'confirmed': 3,
          'reserved': 2,
          'cancelled': 1
        }

        const uniqueBookings = (b as Booking[]).reduce((acc: Booking[], current) => {
          // Helper to normalize date (strip time)
          const normalizeDate = (d: string) => d ? format(parseISO(d), 'yyyy-MM-dd') : ''

          // Get resolved details for current booking
          const currentGuest = tempGuestMap.get(current.guestId)
          const currentRoom = tempRoomMap.get(current.roomId)

          const currentGuestName = (currentGuest?.name || '').trim().toLowerCase()
          const currentRoomNumber = (currentRoom?.roomNumber || '').trim()
          const currentCheckIn = normalizeDate(current.checkIn)
          const currentCheckOut = normalizeDate(current.checkOut)

          // Check if this is a duplicate by ID first
          const duplicateByIdIndex = acc.findIndex(item => item.id === current.id)
          if (duplicateByIdIndex >= 0) {
            console.warn(`[ReservationsPage] Skipping duplicate booking (same ID): ${current.id}`)
            return acc
          }

          // Check for logical duplicate (same guest, room, dates)
          const duplicateByDetailsIndex = acc.findIndex(item => {
            const itemGuest = tempGuestMap.get(item.guestId)
            const itemRoom = tempRoomMap.get(item.roomId)

            const itemGuestName = (itemGuest?.name || '').trim().toLowerCase()
            const itemRoomNumber = (itemRoom?.roomNumber || '').trim()
            const itemCheckIn = normalizeDate(item.checkIn)
            const itemCheckOut = normalizeDate(item.checkOut)

            return (
              itemGuestName === currentGuestName &&
              itemRoomNumber === currentRoomNumber &&
              itemCheckIn === currentCheckIn &&
              itemCheckOut === currentCheckOut
            )
          })

          if (duplicateByDetailsIndex >= 0) {
            const existing = acc[duplicateByDetailsIndex]
            const existingPriority = statusPriority[existing.status] || 0
            const currentPriority = statusPriority[current.status] || 0

            // Keep the one with higher priority status (more advanced in the booking lifecycle)
            if (currentPriority > existingPriority) {
              console.warn(`[ReservationsPage] Replacing duplicate booking ${existing.id} (status: ${existing.status}) with ${current.id} (status: ${current.status})`)
              acc[duplicateByDetailsIndex] = current
            } else {
              console.warn(`[ReservationsPage] Hidden duplicate booking: ${current.id} (status: ${current.status}) - keeping ${existing.id} (status: ${existing.status})`)
            }
            return acc
          }

          acc.push(current)
          return acc
        }, [])

        setBookings(uniqueBookings)
        setRooms(r)
        setGuests(g)
      } catch (e) {
        console.error('Failed to load reservations', e)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [user])

  const roomMap = useMemo(() => new Map(rooms.map(r => [r.id, r])), [rooms])
  const guestMap = useMemo(() => new Map(guests.map(g => [g.id, g])), [guests])

  const resolveRoomStatus = (booking: Booking, room?: Room) => {
    if (booking.status === 'checked-in') return 'occupied'
    // For checked-out bookings, use actual room status from database
    // Room can be 'cleaning' or 'available' depending on housekeeping task completion
    if (booking.status === 'checked-out') return room?.status || 'cleaning'
    if (booking.status === 'cancelled') return room?.status || 'cancelled'
    if (booking.status === 'confirmed' || booking.status === 'reserved') {
      if (room?.status && ['maintenance', 'cleaning'].includes(room.status)) {
        return room.status
      }
      return 'available'
    }
    return room?.status || 'available'
  }

  const filtered = useMemo(() => {
    return bookings.filter(b => {
      if (status !== 'all' && b.status !== status) return false
      if (from && isBefore(parseISO(b.checkOut), parseISO(from))) return false
      if (to && isAfter(parseISO(b.checkIn), parseISO(to))) return false
      if (query) {
        const guest = guestMap.get(b.guestId)
        const room = roomMap.get(b.roomId)
        const hay = `${guest?.name || ''} ${guest?.email || ''} ${room?.roomNumber || ''} ${b.id}`.toLowerCase()
        if (!hay.includes(query.toLowerCase().trim())) return false
      }
      return true
    })
  }, [bookings, status, from, to, query, guestMap, roomMap])

  const cancelBooking = async (id: string) => {
    const original = bookings
    setUpdatingId(id)
    // Optimistic update
    setBookings(prev => prev.map(b => (b.id === id ? { ...b, status: 'cancelled' } : b)))
    try {
      await db.bookings.update(id, { status: 'cancelled' })
      toast.success('Booking cancelled')
    } catch (e) {
      console.error('Cancel failed', e)
      setBookings(original)
      toast.error('Failed to cancel booking')
    } finally {
      setUpdatingId(null)
    }
  }

  // Check-in handler
  const handleCheckIn = async (booking: Booking) => {
    const room = roomMap.get(booking.roomId)

    // Enforce room availability logic
    if (room && room.status !== 'available') {
      if (room.status === 'occupied') {
        toast.error(`Cannot check in: Room ${room.roomNumber} is currently occupied. Check out the previous guest first.`)
        return
      }
      if (room.status === 'cleaning') {
        toast.error(`Cannot check in: Room ${room.roomNumber} is currently being cleaned. Please complete housekeeping first.`)
        return
      }
      if (room.status === 'maintenance') {
        toast.error(`Cannot check in: Room ${room.roomNumber} is under maintenance.`)
        return
      }
    }

    setProcessing(true)
    setCheckInDialog(null) // Close dialog immediately
    try {
      // Update booking status to checked-in
      await db.bookings.update(booking.id, {
        status: 'checked-in',
        actualCheckIn: new Date().toISOString()
      })

      // Update room status to occupied
      const room = roomMap.get(booking.roomId)
      if (room) {
        await db.rooms.update(room.id, { status: 'occupied' })
        // Optimistically reflect in UI immediately
        setRooms(prev => prev.map(r => (r.id === room.id ? { ...r, status: 'occupied' } : r)))

        // Log room status change
        try {
          await activityLogService.log({
            action: 'updated',
            entityType: 'room',
            entityId: room.id,
            details: {
              roomNumber: room.roomNumber,
              previousStatus: 'available',
              newStatus: 'occupied',
              reason: 'guest_check_in',
              guestName: guestMap.get(booking.guestId)?.name || 'Unknown Guest',
              bookingId: booking.id
            },
            userId: user?.id || 'system'
          })
        } catch (logError) {
          console.error('Failed to log room status change:', logError)
        }

        // Also update properties table for consistency
        const props = await db.properties.list({ limit: 500 })
        const prop = props.find((p: any) => p.id === room.id)
        if (prop) {
          await db.properties.update(prop.id, { status: 'occupied' })
        }
      }

      // Optimistic UI update
      setBookings(prev => prev.map(b =>
        b.id === booking.id ? { ...b, status: 'checked-in' as const } : b
      ))

      // Send check-in notification
      const guest = guestMap.get(booking.guestId)
      if (guest && room) {
        try {
          const { sendCheckInNotification } = await import('@/services/notifications')

          // Create booking object with the structure expected by notifications
          const bookingForNotification = {
            id: booking.id,
            checkIn: booking.checkIn,
            checkOut: booking.checkOut,
            actualCheckIn: booking.actualCheckIn,
            actualCheckOut: booking.actualCheckOut
          }

          await sendCheckInNotification(guest, room, bookingForNotification)
          console.log('✅ [ReservationsPage] Check-in notification sent successfully!')
        } catch (notificationError) {
          console.error('❌ [ReservationsPage] Check-in notification error:', notificationError)
        }
      }

      // Log check-in activity
      try {
        const guest = guestMap.get(booking.guestId)
        const room = roomMap.get(booking.roomId)
        await activityLogService.log({
          action: 'checked_in',
          entityType: 'booking',
          entityId: booking.id,
          details: {
            guestName: guest?.name || booking.guestName || 'Unknown Guest',
            roomNumber: room?.roomNumber || 'Unknown Room',
            checkInDate: booking.checkIn,
            actualCheckIn: new Date().toISOString(),
            bookingId: booking.id
          },
          userId: user?.id || 'system'
        })
        console.log('✅ [ReservationsPage] Check-in activity logged successfully!')
      } catch (logError) {
        console.error('❌ [ReservationsPage] Failed to log check-in activity:', logError)
      }

      toast.success(`Guest ${guestMap.get(booking.guestId)?.name || 'Guest'} checked in successfully!`)
    } catch (error) {
      console.error('Check-in failed:', error)
      toast.error(error instanceof Error ? error.message : 'Failed to check in guest')
      // Reload data to restore correct state
      const [b] = await Promise.all([db.bookings.list({ orderBy: { createdAt: 'desc' }, limit: 500 })])
      setBookings(b)
    } finally {
      setProcessing(false)
    }
  }

  // Check-out handler
  const handleDownloadInvoice = async (booking: Booking) => {
    const guest = guestMap.get(booking.guestId)
    const room = roomMap.get(booking.roomId)

    if (!guest || !room) {
      toast.error('Guest or room information not available')
      return
    }

    setDownloadingInvoice(booking.id)
    try {
      console.log('📄 [ReservationsPage] Generating invoice for staff download...', {
        bookingId: booking.id,
        guestEmail: guest.email,
        roomNumber: room.roomNumber
      })

      // Create booking with details for invoice
      const bookingWithDetails = {
        ...booking,
        guest: guest,
        room: {
          roomNumber: room.roomNumber,
          roomType: room.roomType || 'Standard Room'
        }
      }

      // Generate invoice data
      const invoiceData = await createInvoiceData(bookingWithDetails, room)

      // Download PDF using service function
      await downloadInvoicePDF(invoiceData)

      toast.success(`Invoice downloaded for ${guest.name}`)
      console.log('✅ [ReservationsPage] Invoice downloaded successfully')
    } catch (error: any) {
      console.error('❌ [ReservationsPage] Invoice download failed:', error)
      toast.error('Failed to download invoice')
    } finally {
      setDownloadingInvoice(null)
    }
  }

  // Check-out handler
  const handleCheckOut = async (booking: Booking) => {
    setProcessing(true)
    setCheckOutDialog(null) // Close dialog immediately
    try {
      let housekeepingTaskCreated = false

      // Update booking status to checked-out
      await db.bookings.update(booking.id, {
        status: 'checked-out',
        actualCheckOut: new Date().toISOString()
      })

      // Update room status to cleaning
      const room = roomMap.get(booking.roomId)
      if (room) {
        await db.rooms.update(room.id, { status: 'cleaning' })
        // Optimistically reflect in UI immediately
        setRooms(prev => prev.map(r => (r.id === room.id ? { ...r, status: 'cleaning' } : r)))

        // Log room status change
        try {
          await activityLogService.log({
            action: 'updated',
            entityType: 'room',
            entityId: room.id,
            details: {
              roomNumber: room.roomNumber,
              previousStatus: 'occupied',
              newStatus: 'cleaning',
              reason: 'guest_check_out',
              guestName: guestMap.get(booking.guestId)?.name || 'Unknown Guest',
              bookingId: booking.id
            },
            userId: user?.id || 'system'
          })
        } catch (logError) {
          console.error('Failed to log room status change:', logError)
        }

        // Update properties table if a matching property exists (best-effort)
        try {
          const props = await db.properties.list({ limit: 500 })
          const prop = props.find((p: any) => p.id === room.id)
          if (prop) {
            await db.properties.update(prop.id, { status: 'cleaning' })
          }
        } catch (e) {
          console.warn('Properties update skipped:', e)
        }

        // Create housekeeping task using the new service
        try {
          const guestName = guestMap.get(booking.guestId)?.name || 'Guest'
          const newTask = await housekeepingService.createCheckoutTask(booking, room, guestName, user)

          if (newTask) {
            housekeepingTaskCreated = true
          }
        } catch (taskError) {
          console.error('❌ [Checkout] Failed to create housekeeping task via service:', taskError)
        }
      }

      // Optimistic UI update
      setBookings(prev => prev.map(b =>
        b.id === booking.id ? { ...b, status: 'checked-out' as const } : b
      ))

      // Get guest and room data for notifications
      const guest = guestMap.get(booking.guestId)

      // Send check-out notification FIRST (before invoice processing)
      if (guest && room) {
        console.log('📧 [ReservationsPage] Preparing to send check-out notification...', {
          guestEmail: guest.email,
          guestName: guest.name,
          roomNumber: room.roomNumber,
          bookingId: booking.id
        })

        try {
          // Import notification service directly
          const { sendCheckOutNotification } = await import('@/services/notifications')

          // Create booking object with the structure expected by notifications
          // Use the updated actualCheckOut from the database update
          const bookingForNotification = {
            id: booking.id,
            checkIn: booking.checkIn,
            checkOut: booking.checkOut,
            actualCheckIn: booking.actualCheckIn,
            actualCheckOut: new Date().toISOString() // Use the same timestamp as the database update
          }

          // Prepare invoice data for the notification
          const invoiceData = {
            invoiceNumber: `INV-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`,
            totalAmount: booking.totalPrice || 0,
            downloadUrl: `${window.location.origin}/invoice/INV-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`
          }

          console.log('📧 [ReservationsPage] Calling sendCheckOutNotification with invoice data:', invoiceData)

          // Call notification service directly
          await sendCheckOutNotification(guest, room, bookingForNotification, invoiceData)
          console.log('✅ [ReservationsPage] Check-out notification sent successfully!')
        } catch (notificationError) {
          console.error('❌ [ReservationsPage] Check-out notification error:', notificationError)
        }
      } else {
        console.warn('⚠️ [ReservationsPage] Cannot send check-out notification - missing guest or room data:', {
          hasGuest: !!guest,
          hasRoom: !!room,
          guestId: booking.guestId,
          roomId: booking.roomId
        })
      }

      // Generate and send invoice (separate from check-out notification)
      if (guest && room) {
        try {
          console.log('🚀 [ReservationsPage] Starting invoice generation...', {
            bookingId: booking.id,
            guestEmail: guest.email,
            roomNumber: room.roomNumber,
            guestName: guest.name
          })

          // Create booking with details for invoice
          const bookingWithDetails = {
            ...booking,
            guest: guest,
            room: {
              roomNumber: room.roomNumber,
              roomType: room.roomType || 'Standard Room'
            }
          }

          console.log('📊 [ReservationsPage] Creating invoice data...')
          // Generate invoice data
          const invoiceData = await createInvoiceData(bookingWithDetails, room)
          console.log('✅ [ReservationsPage] Invoice data created:', invoiceData.invoiceNumber)

          console.log('📄 [ReservationsPage] Generating invoice PDF...')
          // Generate invoice PDF
          const invoicePdf = await generateInvoicePDF(invoiceData)
          console.log('✅ [ReservationsPage] Invoice PDF generated')

          console.log('📧 [ReservationsPage] Sending invoice email...')
          // Send invoice email
          const emailResult = await sendInvoiceEmail(invoiceData, invoicePdf)
          console.log('📧 [ReservationsPage] Email result:', emailResult)

          if (emailResult.success) {
            console.log('✅ [ReservationsPage] Invoice sent successfully')
            toast.success(`✅ Invoice sent to ${guest.email}`)
          } else {
            console.warn('⚠️ [ReservationsPage] Invoice email failed:', emailResult.error)
            toast.error(`❌ Invoice email failed: ${emailResult.error}`)
          }
        } catch (invoiceError: any) {
          console.error('❌ [ReservationsPage] Invoice generation failed:', invoiceError)
          console.error('❌ [ReservationsPage] Error details:', {
            message: invoiceError.message,
            stack: invoiceError.stack,
            name: invoiceError.name
          })
          toast.error(`❌ Invoice generation failed: ${invoiceError.message}`)
        }
      } else {
        console.warn('⚠️ [ReservationsPage] Missing guest or room data for invoice generation:', {
          hasGuest: !!guest,
          hasRoom: !!room,
          guestId: booking.guestId,
          roomId: booking.roomId
        })
        toast.error('❌ Cannot generate invoice: Missing guest or room data')
      }

      // Log check-out activity
      try {
        const guest = guestMap.get(booking.guestId)
        const room = roomMap.get(booking.roomId)
        await activityLogService.log({
          action: 'checked_out',
          entityType: 'booking',
          entityId: booking.id,
          details: {
            guestName: guest?.name || booking.guestName || 'Unknown Guest',
            roomNumber: room?.roomNumber || 'Unknown Room',
            checkOutDate: booking.checkOut,
            actualCheckOut: new Date().toISOString(),
            bookingId: booking.id
          },
          userId: user?.id || 'system'
        })
        console.log('✅ [ReservationsPage] Check-out activity logged successfully!')
      } catch (logError) {
        console.error('❌ [ReservationsPage] Failed to log check-out activity:', logError)
      }

      const taskMessage = housekeepingTaskCreated ? ' Cleaning task created.' : ' (Cleaning task creation failed - please check console)'
      toast.success(`Guest ${guestMap.get(booking.guestId)?.name || 'Guest'} checked out successfully!${taskMessage}`)
    } catch (error) {
      console.error('Check-out failed:', error)
      toast.error('Failed to check out guest')
      // Reload data to restore correct state
      const [b] = await Promise.all([db.bookings.list({ orderBy: { createdAt: 'desc' }, limit: 500 })])
      setBookings(b)
    } finally {
      setProcessing(false)
    }
  }

  // Determine if check-in is allowed
  const canCheckIn = (booking: Booking) => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const checkInDate = new Date(booking.checkIn)
    checkInDate.setHours(0, 0, 0, 0)
    return booking.status === 'confirmed' && checkInDate <= today
  }

  // Determine if check-out is allowed
  const canCheckOut = (booking: Booking) => {
    return booking.status === 'checked-in'
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Loading reservations…</p>
        </div>
      </div>
    )
  }

  return (
    <>
      {/* Check-In Dialog */}
      <Dialog open={!!checkInDialog} onOpenChange={(open) => !open && setCheckInDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Guest Check-In</DialogTitle>
            <DialogDescription>
              Verify guest details before checking in
            </DialogDescription>
          </DialogHeader>
          {checkInDialog && (
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Guest Name</p>
                  <p className="text-base font-semibold">{guestMap.get(checkInDialog.guestId)?.name || 'Guest'}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Room Number</p>
                  <p className="text-base font-semibold">
                    {roomMap.get(checkInDialog.roomId)?.roomNumber || 'N/A'}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Check-in Date</p>
                  <p className="text-base">{format(parseISO(checkInDialog.checkIn), 'PPP')}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Check-out Date</p>
                  <p className="text-base">{format(parseISO(checkInDialog.checkOut), 'PPP')}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Number of Guests</p>
                  <p className="text-base">{checkInDialog.numGuests || 1}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Total Amount</p>
                  <p className="text-base font-semibold text-primary">
                    {formatCurrencySync(checkInDialog.totalPrice, currency)}
                  </p>
                </div>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Email</p>
                <p className="text-base">{guestMap.get(checkInDialog.guestId)?.email || 'N/A'}</p>
              </div>
              {guestMap.get(checkInDialog.guestId)?.phone && (
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Phone</p>
                  <p className="text-base">{guestMap.get(checkInDialog.guestId)?.phone}</p>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCheckInDialog(null)} disabled={processing}>
              Cancel
            </Button>
            <Button onClick={() => handleCheckIn(checkInDialog!)} disabled={processing}>
              {processing ? 'Processing...' : 'Confirm Check-In'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Check-Out Dialog */}
      <Dialog open={!!checkOutDialog} onOpenChange={(open) => !open && setCheckOutDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Guest Check-Out</DialogTitle>
            <DialogDescription>
              Complete the checkout process and create cleaning task
            </DialogDescription>
          </DialogHeader>
          {checkOutDialog && (
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Guest Name</p>
                  <p className="text-base font-semibold">{guestMap.get(checkOutDialog.guestId)?.name || 'Guest'}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Room Number</p>
                  <p className="text-base font-semibold">
                    {roomMap.get(checkOutDialog.roomId)?.roomNumber || 'N/A'}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Stay Duration</p>
                  <p className="text-base">
                    {calculateNights(checkOutDialog.checkIn, checkOutDialog.checkOut)} nights
                  </p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Total Charges</p>
                  <p className="text-base font-semibold text-primary">
                    {formatCurrencySync(checkOutDialog.totalPrice, currency)}
                  </p>
                </div>
              </div>
              <div className="rounded-lg bg-blue-50 p-4 border border-blue-200">
                <p className="text-sm font-medium text-blue-900">What happens next?</p>
                <ul className="mt-2 text-sm text-blue-700 space-y-1">
                  <li>✓ Booking status updated to "Checked-Out"</li>
                  <li>✓ Room status set to "Cleaning"</li>
                  <li>✓ Housekeeping task automatically created</li>
                  <li>✓ Room available after cleaning completion</li>
                </ul>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCheckOutDialog(null)} disabled={processing}>
              Cancel
            </Button>
            <Button onClick={() => handleCheckOut(checkOutDialog!)} disabled={processing}>
              {processing ? 'Processing...' : 'Confirm Check-Out'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="min-h-screen bg-secondary/30">
        <header className="bg-background border-b sticky top-0 z-10">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-serif font-bold">Reservations</h1>
              <p className="text-sm text-muted-foreground">Search, filter and manage bookings</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => navigate('/staff/onsite-booking')}>+ New Booking</Button>
              <Button variant="outline" onClick={() => navigate('/staff/calendar')}>Calendar View</Button>
              <Button variant="outline" onClick={() => navigate('/staff/invoices')}>🧾 Manage Invoices</Button>
            </div>
          </div>
        </header>

        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Card className="mb-6">
            <CardContent className="pt-6 grid grid-cols-1 md:grid-cols-5 gap-3">
              <div className="md:col-span-2">
                <Input placeholder="Search by guest, email, room or reference…" value={query} onChange={(e) => setQuery(e.target.value)} />
              </div>
              <div>
                <Select value={status} onValueChange={(v: any) => setStatus(v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    <SelectItem value="confirmed">Confirmed</SelectItem>
                    <SelectItem value="reserved">Reserved</SelectItem>
                    <SelectItem value="checked-in">Checked-in</SelectItem>
                    <SelectItem value="checked-out">Checked-out</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </div>
              <div>
                <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Reservations ({filtered.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {filtered.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">No bookings found.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Reference</TableHead>
                        <TableHead>Guest</TableHead>
                        <TableHead>Room</TableHead>
                        <TableHead>Dates</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filtered.map((b) => {
                        const guest = guestMap.get(b.guestId)
                        const room = roomMap.get(b.roomId)
                        return (
                          <TableRow key={b.id}>
                            <TableCell className="font-medium">#{b.id.slice(-8)}</TableCell>
                            <TableCell>
                              <div className="font-medium">{guest?.name || 'Guest'}</div>
                              <div className="text-xs text-muted-foreground">{guest?.email}</div>
                            </TableCell>
                            <TableCell>
                              <div>Room {room?.roomNumber}</div>
                              <div className="text-xs text-muted-foreground">{resolveRoomStatus(b, room)}</div>
                            </TableCell>
                            <TableCell>
                              {format(parseISO(b.checkIn), 'MMM dd, yyyy')} → {format(parseISO(b.checkOut), 'MMM dd, yyyy')}
                            </TableCell>
                            <TableCell className="text-right">{formatCurrencySync(b.totalPrice, currency)}</TableCell>
                            <TableCell>
                              <StatusBadge status={b.status} />
                            </TableCell>
                            <TableCell className="text-right space-x-2">
                              {canCheckIn(b) && (
                                <Button
                                  size="sm"
                                  variant="default"
                                  onClick={() => setCheckInDialog(b)}
                                >
                                  <LogIn className="w-4 h-4 mr-1" />
                                  Check In
                                </Button>
                              )}
                              {canCheckOut(b) && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => setCheckOutDialog(b)}
                                >
                                  <LogOut className="w-4 h-4 mr-1" />
                                  Check Out
                                </Button>
                              )}
                              {b.status === 'checked-out' && (
                                <div className="flex gap-2">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => handleDownloadInvoice(b)}
                                    disabled={downloadingInvoice === b.id}
                                  >
                                    {downloadingInvoice === b.id ? (
                                      <>
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        Generating...
                                      </>
                                    ) : (
                                      <>
                                        <Download className="mr-2 h-4 w-4" />
                                        Invoice
                                      </>
                                    )}
                                  </Button>
                                  <span className="inline-flex items-center gap-1 text-sm text-green-600">
                                    <CheckCircle2 className="w-4 h-4" />
                                    Completed
                                  </span>
                                </div>
                              )}
                              {b.status !== 'checked-out' && b.status !== 'checked-in' && b.status !== 'confirmed' && (
                                <Button
                                  variant="destructive"
                                  size="sm"
                                  disabled={b.status === 'cancelled' || updatingId === b.id}
                                  onClick={() => cancelBooking(b.id)}
                                >
                                  {updatingId === b.id ? 'Cancelling…' : 'Cancel'}
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </main>
      </div>
    </>
  )
}

export default ReservationsPage
