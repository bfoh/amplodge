import { useEffect, useMemo, useState, useTransition } from 'react'
import { useNavigate } from 'react-router-dom'
import { db, auth, onTableUpdated } from '@/lib/db'
import { useSubscription } from '@/hooks/use-subscription'
import type { Booking, Room, Guest, RoomType, Property } from '@/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Download, Loader2, Calendar } from 'lucide-react'
import { format, parseISO, isBefore, isAfter } from 'date-fns'
import { safeFormatDate, safeParseISO } from '@/lib/safe-date'
import { formatCurrencySync } from '@/lib/utils'
import { useCurrency } from '@/hooks/use-currency'
import { toast } from 'sonner'
import { createInvoiceData, downloadInvoicePDF, generateInvoicePDF, sendInvoiceEmail, createGroupInvoiceData, downloadGroupInvoicePDF, createPreInvoiceData, downloadPreInvoicePDF, generatePreInvoicePDF } from '@/services/invoice-service'
import { activityLogService } from '@/services/activity-log-service'
import { housekeepingService } from '@/services/housekeeping-service'
import { bookingChargesService, CHARGE_CATEGORIES } from '@/services/booking-charges-service'
import { BookingCharge } from '@/types'
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
import { CheckInDialog } from '@/components/dialogs/CheckInDialog'
import { GuestChargesDialog } from '@/components/dialogs/GuestChargesDialog'
import { ExtendStayDialog } from '@/components/dialogs/ExtendStayDialog'
import { GroupManageDialog } from '@/components/dialogs/GroupManageDialog'
import { Settings } from 'lucide-react'
import { Receipt, CalendarPlus, MoreHorizontal, CreditCard, User, Users, Mail, Ban, MessageCircle, FileText } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

/**
 * Resolve a guest's display name with a tiered fallback chain. Older bookings
 * were created with empty fullName values, which caused both the GUEST_SNAPSHOT
 * and the linked guests row to land on the literal string "Guest". This helper
 * recovers something readable from whatever is actually present.
 */
function resolveGuestDisplayName(b: Booking, guest: Guest | undefined): string {
  const isUseful = (s: string | undefined | null) =>
    !!s && s.trim().length > 0 && s.trim().toLowerCase() !== 'guest'

  // 1. Captured-at-booking-time snapshot
  const snapshotName = (b as any).guestNameSnapshot as string | undefined
  if (isUseful(snapshotName)) return snapshotName!.trim()

  // 2. Live guests-table record
  if (isUseful(guest?.name)) return guest!.name.trim()

  // 3. Derive from email local-part — skip placeholder/fallback emails
  const email = (b as any).guestEmailSnapshot || guest?.email || ''
  if (
    email &&
    !email.endsWith('@guest.local') &&
    !email.startsWith('fallback-') &&
    email.includes('@')
  ) {
    const local = email.split('@')[0]
    const pretty = local
      .replace(/[._-]+/g, ' ')
      .replace(/\b\w/g, (c: string) => c.toUpperCase())
      .trim()
    if (pretty) return pretty
  }

  // 4. Last-resort tag so staff can still distinguish rows
  const tail = (b.id || '').slice(-4).toUpperCase()
  return tail ? `Guest #${tail}` : 'Guest'
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    confirmed: 'bg-emerald-50 text-emerald-700 border-emerald-200 ring-emerald-600/20',
    'checked-in': 'bg-blue-50 text-blue-700 border-blue-200 ring-blue-600/20',
    'checked-out': 'bg-slate-50 text-slate-700 border-slate-200 ring-slate-600/20',
    cancelled: 'bg-rose-50 text-rose-700 border-rose-200 ring-rose-600/20',
    reserved: 'bg-amber-50 text-amber-700 border-amber-200 ring-amber-600/20'
  }

  const defaultStyle = 'bg-gray-50 text-gray-700 border-gray-200 ring-gray-600/20'
  const style = styles[status] || defaultStyle

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ring-1 ring-inset ${style} capitalize shadow-sm`}>
      {(status || '').replace('-', ' ')}
    </span>
  )
}

export function ReservationsPage() {
  const navigate = useNavigate()
  const { currency } = useCurrency()
  const [user, setUser] = useState<{ id: string; email: string | undefined } | null>(null)
  const [bookings, setBookings] = useState<Booking[]>([])
  const [rooms, setRooms] = useState<Room[]>([])
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([])
  const [guests, setGuests] = useState<Guest[]>([])
  // Pending/in-progress housekeeping tasks, keyed by propertyId / roomNumber
  // so resolveRoomStatus can tell whether a 'cleaning' badge is justified.
  const [openTaskRoomKeys, setOpenTaskRoomKeys] = useState<Set<string>>(new Set())

  // Subscriptions
  const updatedAtBks = useSubscription('bookings')
  const updatedAtProp = useSubscription('properties')
  const updatedAtGuests = useSubscription('guests')
  const updatedAtChg = useSubscription('booking_charges')
  const updatedAtTasks = useSubscription('housekeeping_tasks')

  const [isPending, startTransition] = useTransition()

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
  const [chargesDialog, setChargesDialog] = useState<Booking | null>(null)
  const [extendStayDialog, setExtendStayDialog] = useState<Booking | null>(null)
  const [downloadingInvoice, setDownloadingInvoice] = useState<string | null>(null)
  const [downloadingPreInvoice, setDownloadingPreInvoice] = useState<string | null>(null)
  const [sharingWhatsApp, setSharingWhatsApp] = useState<string | null>(null)
  const [manageGroupDialog, setManageGroupDialog] = useState<{ groupId: string; groupReference: string } | null>(null)

  // Cancellation dialog
  const [cancelDialog, setCancelDialog] = useState<Booking | null>(null)
  const [cancelReason, setCancelReason] = useState('')

  // Checkout charges summary
  const [checkoutCharges, setCheckoutCharges] = useState<BookingCharge[]>([])
  const [checkoutLoading, setCheckoutLoading] = useState(false)

  // All booking charges for displaying totals
  const [allCharges, setAllCharges] = useState<BookingCharge[]>([])

  useEffect(() => {
    const unsub = auth.onAuthStateChanged((state) => {
      setUser(state.user)
      if (!state.user && !state.isLoading) navigate('/staff')
    })
    return unsub
  }, [navigate])

  // Fetch charges when checkout dialog opens
  useEffect(() => {
    if (checkOutDialog) {
      setCheckoutLoading(true)
      bookingChargesService.getChargesForBooking(checkOutDialog.id)
        .then(charges => setCheckoutCharges(charges))
        .catch(err => {
          console.error('Failed to fetch checkout charges:', err)
          setCheckoutCharges([])
        })
        .finally(() => setCheckoutLoading(false))
    } else {
      setCheckoutCharges([])
    }
  }, [checkOutDialog])

  useEffect(() => {
    if (!user) return
    let inFlight = false
    let pending: ReturnType<typeof setTimeout> | null = null
    // Hydrate a raw booking row: parse GUEST_SNAPSHOT and GROUP_DATA from
    // special_requests so the rest of the page can rely on derived fields.
    // Extracted so the fast first-paint and the full load both use the same logic.
    const hydrateBooking = (booking: Booking) => {
      const rawSpecialRequests = (booking as any).special_requests || booking.specialRequests || ''
      let guestNameSnapshot: string | undefined
      let guestEmailSnapshot: string | undefined
      const snapshotMatch = rawSpecialRequests.match(/<!-- GUEST_SNAPSHOT:(.*?) -->/)
      if (snapshotMatch) {
        try {
          const snap = JSON.parse(snapshotMatch[1])
          if (snap.name) guestNameSnapshot = snap.name
          if (snap.email) guestEmailSnapshot = snap.email
        } catch { /* ignore */ }
      }
      if (!rawSpecialRequests) return { ...booking, _rawSpecialRequests: '', guestNameSnapshot, guestEmailSnapshot }
      const groupMatch = rawSpecialRequests.match(/<!-- GROUP_DATA:(.*?) -->/)
      if (groupMatch && groupMatch[1]) {
        try {
          const groupData = JSON.parse(groupMatch[1])
          return {
            ...booking,
            ...groupData,
            guestNameSnapshot,
            guestEmailSnapshot,
            _rawSpecialRequests: rawSpecialRequests,
            special_requests: rawSpecialRequests,
            specialRequests: rawSpecialRequests.replace(/<!-- GROUP_DATA:.*? -->/g, '').trim(),
          }
        } catch (e) {
          console.warn('Failed to parse group data for booking', booking.id, e)
        }
      }
      return { ...booking, guestNameSnapshot, guestEmailSnapshot, _rawSpecialRequests: rawSpecialRequests, special_requests: rawSpecialRequests }
    }

    const load = async () => {
      if (inFlight) return
      inFlight = true
      try {
        const [b, r, g, rt, charges, roomsTable, tasks] = await Promise.all([
          db.bookings.listAll({ orderBy: { createdAt: 'desc' } }),
          db.properties.listAll(),
          db.guests.listAll(),
          db.roomTypes.list({ limit: 100 }),
          db.bookingCharges.listAll() || Promise.resolve([]),
          (db as any).rooms.listAll().catch(() => []),
          db.housekeepingTasks.list({ limit: 1000 }).catch(() => [])
        ])

        // Build the set of room keys that have at least one OPEN (pending /
        // in_progress) housekeeping task. Used by resolveRoomStatus to be
        // strict: 'cleaning' is shown only when an actual task is pending,
        // not just because property.status was never flipped back to
        // available in the DB.
        const openKeys = new Set<string>()
        for (const t of (tasks as any[])) {
          if (!t || t.status === 'completed') continue
          if (t.propertyId) openKeys.add(`id:${t.propertyId}`)
          if (t.roomNumber) openKeys.add(`num:${String(t.roomNumber)}`)
        }
        setOpenTaskRoomKeys(openKeys)

        // Store charges for calculating totals
        setAllCharges(charges || [])

        const hydratedBookings = (b as Booking[]).map(hydrateBooking)

        // Only deduplicate by ID (React keys) in case of rare DB sync overlaps.
        // We no longer aggressively deduplicate by guest/room/date client-side,
        // so all actual DB records will be visible.
        const seenIds = new Set<string>()
        const uniqueBookings = hydratedBookings.filter(b => {
          if (seenIds.has(b.id)) return false
          seenIds.add(b.id)
          return true
        })

        setBookings(uniqueBookings)
        // Combine properties and rooms tables for maximum ID coverage
        const combinedRooms = [...r]
        const seenRoomIds = new Set(r.map(item => item.id))
        
        ;(roomsTable || []).forEach((rt: any) => {
          if (!seenRoomIds.has(rt.id)) {
            combinedRooms.push(rt)
            seenRoomIds.add(rt.id)
          }
        })

        setRooms(combinedRooms)
        setGuests(g)
        setRoomTypes(rt)
      } catch (e) {
        console.error('Failed to load reservations', e)
      } finally {
        setLoading(false)
        inFlight = false
      }
    }
    load()
  }, [user, updatedAtBks, updatedAtProp, updatedAtGuests, updatedAtChg, updatedAtTasks])

  const roomMap = useMemo(() => new Map(rooms.map(r => [r.id, r])), [rooms])
  const guestMap = useMemo(() => new Map(guests.map(g => [g.id, g])), [guests])
  const roomTypeMap = useMemo(() => new Map(roomTypes.map(rt => [rt.id, rt])), [roomTypes])

  // Calculate total charges per booking
  const chargesMap = useMemo(() => {
    const map = new Map<string, number>()
    allCharges.forEach((charge: BookingCharge) => {
      const current = map.get(charge.bookingId) || 0
      map.set(charge.bookingId, current + charge.amount)
    })
    return map
  }, [allCharges])

  // Helper to get room price from roomType
  const getRoomPrice = (room: Room | undefined): number => {
    if (!room) return 0
    // Try to get basePrice from roomType
    const roomType = roomTypeMap.get(room.roomTypeId)
    if (roomType?.basePrice && roomType.basePrice > 0) {
      return roomType.basePrice
    }
    // Fallback to room's price field
    return room.price || 0
  }

  // Helper to get total amount (room cost + additional charges)
  // Uses finalAmount if a discount was applied, otherwise totalPrice
  const getBookingTotal = (booking: Booking): number => {
    // Robust price resolution:
    // 1. finalAmount (discounted price) takes absolute priority if present
    // 2. totalPrice (standard DB field)
    // 3. amount (UI/LocalBooking field)
    // 4. amountPaid (last resort for historical/partially corrupted records)
    const roomCost = (booking.finalAmount != null && booking.finalAmount > 0) ? booking.finalAmount :
                     (booking.totalPrice || (booking as any).amount || booking.amountPaid || 0)
    const additionalCharges = chargesMap.get(booking.id) || 0
    return roomCost + additionalCharges
  }

  // Pre-compute: for each roomId, the id of the MOST RECENT checked-out
  // booking. Used so the "Cleaning" label only paints the booking that
  // actually caused the room's current cleaning state — not every historical
  // checkout that ever used the room.
  const mostRecentCheckoutByRoom = useMemo(() => {
    const map = new Map<string, string>() // roomId -> booking.id
    const byRoom = new Map<string, Booking[]>()
    for (const b of bookings) {
      if (b.status !== 'checked-out') continue
      const rid = b.roomId
      if (!rid) continue
      if (!byRoom.has(rid)) byRoom.set(rid, [])
      byRoom.get(rid)!.push(b)
    }
    byRoom.forEach((list, rid) => {
      // Pick the booking with the latest checkOut (fall back to checkIn).
      const latest = list.reduce((a, b) => {
        const ka = (a.checkOut || a.checkIn || '')
        const kb = (b.checkOut || b.checkIn || '')
        return kb > ka ? b : a
      })
      map.set(rid, latest.id)
    })
    return map
  }, [bookings])

  // Compute the room-status secondary label rendered under the room number
  // in each reservation row.
  //
  // Rules:
  //   - reserved / confirmed -> 'available'. A future booking shows what the
  //     room WILL be at check-in time. Current cleaning/occupancy is for the
  //     guest in the room right now, not the next arrival. Only 'maintenance'
  //     stays surfaced because that's an open-ended block.
  //   - checked-in           -> 'occupied'.
  //   - checked-out          -> 'cleaning' ONLY if this is the most recent
  //     checkout for the room AND the room is still in 'cleaning' state.
  //     Otherwise the cleaning has been completed (or the task deleted) and
  //     this booking's stay is fully closed -> 'available'.
  //   - cancelled            -> 'available'. The booking never used the room.
  //   - anything else        -> empty.
  const resolveRoomStatus = (booking: Booking, room?: Room): string => {
    if (booking.status === 'checked-in') return 'occupied'

    if (booking.status === 'confirmed' || booking.status === 'reserved') {
      if (room?.status === 'maintenance') return 'maintenance'
      return 'available'
    }

    if (booking.status === 'checked-out') {
      const recentId = booking.roomId ? mostRecentCheckoutByRoom.get(booking.roomId) : undefined
      const isMostRecent = recentId === booking.id
      // Only show 'cleaning' when an actual open housekeeping task still
      // targets this room. property.status alone is unreliable — older
      // rooms may have been left at 'cleaning' before the lifecycle
      // transition was wired, even though their task is long done.
      const hasOpenTask =
        (room && openTaskRoomKeys.has(`id:${room.id}`)) ||
        (room?.roomNumber && openTaskRoomKeys.has(`num:${String(room.roomNumber)}`))
      if (isMostRecent && hasOpenTask) return 'cleaning'
      return 'available'
    }

    if (booking.status === 'cancelled') return 'available'

    return ''
  }

  const filtered = useMemo(() => {
    return bookings.filter(b => {
      if (status !== 'all' && b.status !== status) return false
      if (from && b.checkOut && isBefore(parseISO(b.checkOut), parseISO(from))) return false
      if (to && b.checkIn && isAfter(parseISO(b.checkIn), parseISO(to))) return false
      if (query) {
        const guest = guestMap.get(b.guestId)
        const room = roomMap.get(b.roomId)
        // Prefer snapshot name/email for search so results match what is displayed
        const searchName = (b as any).guestNameSnapshot || guest?.name || ''
        const searchEmail = (b as any).guestEmailSnapshot || guest?.email || ''
        const hay = `${searchName} ${searchEmail} ${room?.roomNumber || ''} ${b.id}`.toLowerCase()
        if (!hay.includes(query.toLowerCase().trim())) return false
      }
      return true
    })
  }, [bookings, status, from, to, query, guestMap, roomMap])

  const cancelBooking = async (id: string, reason: string) => {
    const original = bookings
    const booking = bookings.find(b => b.id === id)
    setUpdatingId(id)
    // Optimistic update
    setBookings(prev => prev.map(b => (b.id === id ? { ...b, status: 'cancelled' } : b)))
    try {
      await db.bookings.update(id, { status: 'cancelled' })

      // Log cancellation with reason to activity logs
      try {
        const guest = booking ? guestMap.get(booking.guestId) : null
        const room = booking ? roomMap.get(booking.roomId) : null
        await activityLogService.log({
          action: 'cancelled',
          entityType: 'booking',
          entityId: id,
          details: {
            reason: reason,
            guestName: guest?.name || 'Unknown Guest',
            roomNumber: room?.roomNumber || 'Unknown Room',
            checkIn: booking?.checkIn,
            checkOut: booking?.checkOut,
            amount: booking?.totalPrice,
            cancelledAt: new Date().toISOString(),
            bookingId: id
          },
          userId: user?.id || 'system'
        })
        console.log('✅ Cancellation logged with reason:', reason)
      } catch (logError) {
        console.error('Failed to log cancellation activity:', logError)
      }

      toast.success('Booking cancelled')
    } catch (e) {
      console.error('Cancel failed', e)
      setBookings(original)
      toast.error('Failed to cancel booking')
    } finally {
      setUpdatingId(null)
    }
  }

  // Check-out handler

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
        existingInvoiceNumber: booking.invoiceNumber,
        guestEmail: guest.email,
        roomNumber: room.roomNumber
      })

      // Create booking with details for invoice
      const bookingWithDetails = {
        ...booking,
        // CRITICAL: specific invoice data (discounts/charges) is in the raw specialRequests
        // The 'specialRequests' field on the booking object is cleaned for UI display
        // We must use _rawSpecialRequests or special_requests to get the metadata
        specialRequests: (booking as any)._rawSpecialRequests || (booking as any).special_requests || booking.specialRequests,
        guest: guest,
        room: {
          roomNumber: room.roomNumber,
          roomType: roomTypeMap.get(room.roomTypeId)?.name || 'Standard Room'
        }
      }

      // Generate invoice data
      const invoiceData = await createInvoiceData(bookingWithDetails, room)

      // IMPORTANT: Use existing invoice number if available for consistency
      if (booking.invoiceNumber) {
        invoiceData.invoiceNumber = booking.invoiceNumber
        console.log('✅ [ReservationsPage] Using existing invoice number:', booking.invoiceNumber)
      } else {
        // Save the new invoice number to booking for future consistency
        await db.bookings.update(booking.id, { invoiceNumber: invoiceData.invoiceNumber }).catch(() => { })
        console.log('✅ [ReservationsPage] Saved new invoice number:', invoiceData.invoiceNumber)
      }

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

  const handleDownloadPreInvoice = async (booking: Booking) => {
    const guest = guestMap.get(booking.guestId)
    const room = roomMap.get(booking.roomId)
    if (!guest || !room) { toast.error('Guest or room information not available'); return }

    setDownloadingPreInvoice(booking.id)
    try {
      const bookingWithDetails = {
        ...booking,
        specialRequests: (booking as any)._rawSpecialRequests || (booking as any).special_requests || booking.specialRequests,
        guest,
        room: { roomNumber: room.roomNumber, roomType: roomTypeMap.get(room.roomTypeId)?.name || 'Standard Room' }
      }
      const preInvoiceData = await createPreInvoiceData(bookingWithDetails, room)
      await downloadPreInvoicePDF(preInvoiceData)
      toast.success(`Pre-invoice downloaded for ${guest.name}`)
    } catch {
      toast.error('Failed to download pre-invoice')
    } finally {
      setDownloadingPreInvoice(null)
    }
  }

  const handleWhatsAppShare = (booking: Booking, type: 'invoice' | 'pre-invoice') => {
    const guest = guestMap.get(booking.guestId)
    const room = roomMap.get(booking.roomId)
    if (!guest || !room) { toast.error('Guest or room information not available'); return }

    const label = type === 'invoice' ? 'Invoice' : 'Pre-Invoice'
    const nights = Math.ceil((new Date(booking.checkOut).getTime() - new Date(booking.checkIn).getTime()) / 86400000)
    const displayRef = type === 'invoice' && (booking as any).invoiceNumber
      ? (booking as any).invoiceNumber
      : `BK-${booking.id.slice(-8).toUpperCase()}`

    // Public invoice view page — no login required, works for both invoice and pre-invoice
    const typeParam = type === 'pre-invoice' ? '&type=pre-invoice' : ''
    const viewUrl = `${window.location.origin}/invoice/${(booking as any).invoiceNumber || booking.id}?bookingId=${booking.id}${typeParam}`

    const message = `Dear ${guest.name},\n\nPlease find your ${label} from AMP Lodge.\n\n📋 ${label}: ${displayRef}\n🏠 Room ${room.roomNumber}\n📅 ${booking.checkIn} → ${booking.checkOut} (${nights} night${nights !== 1 ? 's' : ''})\n💰 Total: GH₵${Number((booking as any).totalPrice ?? (booking as any).amount ?? 0).toFixed(2)}\n\n🔗 View ${label}: ${viewUrl}\n\nThank you for choosing AMP Lodge!`

    const rawPhone = (guest as any).phone || ''
    const phone = rawPhone.replace(/[^0-9]/g, '').replace(/^0/, '233')
    const waUrl = phone
      ? `https://wa.me/${phone}?text=${encodeURIComponent(message)}`
      : `https://wa.me/?text=${encodeURIComponent(message)}`

    window.open(waUrl, '_blank')
    toast.success(`WhatsApp opened — ${label.toLowerCase()} link included`)
  }

  // Group Invoice Download handler
  const handleGroupInvoiceDownload = async (booking: Booking) => {
    if (!booking.groupId) return

    setDownloadingInvoice(booking.id)
    try {
      console.log('📄 [ReservationsPage] Generating GROUP invoice...', { groupId: booking.groupId })

      // Find all bookings for this group
      // Ideally we should refetch to be sure, but using local state is faster
      // and sufficient for now since we just loaded.
      const groupBookings = bookings.filter(b => b.groupId === booking.groupId)

      if (groupBookings.length === 0) {
        throw new Error('No bookings found for this group')
      }

      // Collect all necessary details for each booking
      const fullBookingDetails = groupBookings.map(b => {
        const guest = guestMap.get(b.guestId)
        const room = roomMap.get(b.roomId)
        return {
          ...b,
          guest,
          room: {
            roomNumber: room?.roomNumber || 'N/A',
            roomType: room?.roomType || 'Standard'
            // We could resolve roomType name from ID if needed, but room object usually has type ID.
            // However, let's stick to what createInvoiceData expects or what we have.
            // If room.roomType is just an ID, we might want to map it.
            // Let's improve:
            // roomType: roomTypeMap.get(room?.roomTypeId)?.name || 'Standard Room'
          }
        }
      }).map(b => ({
        ...b,
        // Enhance room type to be human readable
        room: {
          ...b.room,
          roomType: roomTypeMap.get(roomMap.get(b.roomId)?.roomTypeId || '')?.name || b.room.roomType
        }
      }))

      // Use billing contact from the clicked booking (or the first one)
      const billingContact = booking.billingContact || (booking.guestId ? guestMap.get(booking.guestId) : null)

      const groupInvoiceData = await createGroupInvoiceData(fullBookingDetails as any, billingContact)

      await downloadGroupInvoicePDF(groupInvoiceData)
      toast.success('Group invoice downloaded')

    } catch (error: any) {
      console.error('Group invoice failed', error)
      toast.error('Failed to generate group invoice')
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
      const staffName = (user as any)?.user_metadata?.full_name || (user as any)?.user_metadata?.name || user?.email || 'Staff'
      await db.bookings.update(booking.id, {
        status: 'checked-out',
        actualCheckOut: new Date().toISOString(),
        checkOutBy: user?.id || '',
        checkOutByName: staffName,
      })

      // Update property status to cleaning (canonical)
      const room = roomMap.get(booking.roomId)
      if (room) {
        await db.properties.update(room.id, { status: 'cleaning' })
        // Optimistically reflect in UI immediately
        setRooms(prev => prev.map(r => (r.id === room.id ? { ...r, status: 'cleaning' } : r)))

        // Log property status change
        try {
          await activityLogService.log({
            action: 'updated',
            entityType: 'property',
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

      // Generate invoice and send notifications (invoice data contains correct total including additional charges)
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
            actualCheckOut: new Date().toISOString(),
            guest: guest,
            room: {
              roomNumber: room.roomNumber,
              roomType: roomTypeMap.get(room.roomTypeId)?.name || 'Standard Room'
            }
          }

          console.log('📊 [ReservationsPage] Creating invoice data...')
          // Generate invoice data (this includes additional charges in the total!)
          const invoiceData = await createInvoiceData(bookingWithDetails, room)
          console.log('✅ [ReservationsPage] Invoice data created:', {
            invoiceNumber: invoiceData.invoiceNumber,
            roomTotal: (booking as any).totalPrice || (booking as any).amount || 0,
            additionalChargesTotal: invoiceData.charges.additionalChargesTotal,
            grandTotal: invoiceData.charges.total
          })

          // IMPORTANT: Save the invoice number to the booking record for consistency
          try {
            await db.bookings.update(booking.id, { invoiceNumber: invoiceData.invoiceNumber })
            console.log('✅ [ReservationsPage] Invoice number saved to booking:', invoiceData.invoiceNumber)
          } catch (saveError) {
            console.error('⚠️ [ReservationsPage] Failed to save invoice number to booking:', saveError)
          }

          console.log('📄 [ReservationsPage] Generating invoice PDF...')
          // Generate invoice PDF
          const invoicePdf = await generateInvoicePDF(invoiceData)
          console.log('✅ [ReservationsPage] Invoice PDF generated')

          // Send check-out notification with CORRECT total (room + additional charges)
          try {
            const { sendCheckOutNotification } = await import('@/services/notifications')

            // Create booking object with the structure expected by notifications
            const bookingForNotification = {
              id: booking.id,
              checkIn: booking.checkIn,
              checkOut: booking.checkOut,
              actualCheckIn: booking.actualCheckIn,
              actualCheckOut: new Date().toISOString()
            }

            // Use invoiceData.charges.total which includes room + additional charges
            const notificationInvoiceData = {
              invoiceNumber: invoiceData.invoiceNumber,
              totalAmount: invoiceData.charges.total, // CORRECT: includes additional charges
              downloadUrl: `${window.location.origin}/invoice/${invoiceData.invoiceNumber}?bookingId=${booking.id}`
            }

            console.log('📧 [ReservationsPage] Sending check-out notification with total (room + charges):', {
              roomCost: (booking as any).totalPrice || (booking as any).amount || 0,
              additionalCharges: invoiceData.charges.additionalChargesTotal,
              grandTotal: invoiceData.charges.total
            })

            await sendCheckOutNotification(guest, room, bookingForNotification, notificationInvoiceData)
            console.log('✅ [ReservationsPage] Check-out notification sent successfully!')
          } catch (notificationError) {
            console.error('❌ [ReservationsPage] Check-out notification error:', notificationError)
          }

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
            guestName: guest?.name || 'Unknown Guest',
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
      const [b] = await Promise.all([db.bookings.listAll({ orderBy: { createdAt: 'desc' } })])
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
      <CheckInDialog
        open={!!checkInDialog}
        onOpenChange={(open) => !open && setCheckInDialog(null)}
        booking={checkInDialog}
        room={checkInDialog ? roomMap.get(checkInDialog.roomId) : null}
        guest={checkInDialog ? guestMap.get(checkInDialog.guestId) : null}
        user={user}
        onSuccess={async () => {
          // Subscriptions will handle the data refresh automatically
          setCheckInDialog(null)
        }}
      />

      {/* Guest Charges Dialog */}
      <GuestChargesDialog
        open={!!chargesDialog}
        onOpenChange={(open) => !open && setChargesDialog(null)}
        booking={chargesDialog}
        guest={chargesDialog ? guestMap.get(chargesDialog.guestId) : null}
        onChargesUpdated={async () => {
          // Refresh charges data when charges are updated
          const charges = await db.bookingCharges.listAll() || []
          setAllCharges(charges)
        }}
      />

      {/* Extend Stay Dialog */}
      {extendStayDialog && (() => {
        const extendRoom = roomMap.get(extendStayDialog.roomId)
        return (
          <ExtendStayDialog
            open={!!extendStayDialog}
            onOpenChange={(open) => !open && setExtendStayDialog(null)}
            booking={extendStayDialog}
            guest={guestMap.get(extendStayDialog.guestId) || { id: '', name: 'Guest', email: '' }}
            room={{
              id: extendRoom?.id || '',
              roomNumber: extendRoom?.roomNumber || 'N/A',
              roomType: roomTypeMap.get(extendRoom?.roomTypeId)?.name,
              price: getRoomPrice(extendRoom)
            }}
            onExtensionComplete={async () => {
              // Refresh bookings and charges data after extension
              const [b, charges] = await Promise.all([
                db.bookings.listAll({ orderBy: { createdAt: 'desc' } }),
                db.bookingCharges.listAll() || Promise.resolve([])
              ])
              setBookings(b)
              setAllCharges(charges || [])
            }}
          />
        )
      })()}

      {/* Group Manage Dialog */}
      {manageGroupDialog && (
        <GroupManageDialog
          open={!!manageGroupDialog}
          onOpenChange={(open) => !open && setManageGroupDialog(null)}
          groupId={manageGroupDialog.groupId}
          groupReference={manageGroupDialog.groupReference}
          onUpdate={async () => {
            // Refresh bookings data
            const [b, charges] = await Promise.all([
              db.bookings.listAll({ orderBy: { createdAt: 'desc' } }),
              db.bookingCharges.listAll() || Promise.resolve([])
            ])
            setBookings(b)
            setAllCharges(charges || [])
          }}
        />
      )}

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
                  <p className="text-sm font-medium text-muted-foreground">Room Cost (Paid)</p>
                  <p className="text-base font-semibold">
                    {formatCurrencySync((checkOutDialog as any).finalAmount || (checkOutDialog as any).totalPrice || (checkOutDialog as any).amount || 0, currency)}
                  </p>
                  {checkOutDialog.discountAmount && checkOutDialog.discountAmount > 0 && (
                    <p className="text-xs text-green-600">
                      Discount applied: -{formatCurrencySync(checkOutDialog.discountAmount, currency)}
                    </p>
                  )}
                </div>
              </div>

              {/* Charges Summary */}
              {checkoutLoading ? (
                <div className="flex items-center gap-2 py-2 text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Loading charges...
                </div>
              ) : checkoutCharges.length > 0 && (
                <div className="rounded-lg border p-4 space-y-3">
                  <p className="text-sm font-medium text-muted-foreground">Additional Charges</p>
                  <div className="space-y-2">
                    {checkoutCharges.map(charge => (
                      <div key={charge.id} className="flex justify-between text-sm">
                        <span>{charge.description} ({charge.quantity}×)</span>
                        <span className="font-medium">{formatCurrencySync(charge.amount, currency)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="border-t pt-2 flex justify-between font-medium">
                    <span>Additional Charges Total</span>
                    <span className="text-primary">
                      {formatCurrencySync(checkoutCharges.reduce((sum, c) => sum + c.amount, 0), currency)}
                    </span>
                  </div>
                </div>
              )}

              {/* Grand Total */}
              {!checkoutLoading && (
                <div className="rounded-lg bg-muted/50 p-4">
                  <div className="flex justify-between items-center">
                    <span className="font-medium">Grand Total</span>
                    <span className="text-xl font-bold text-primary">
                      {formatCurrencySync(
                        ((checkOutDialog as any).finalAmount || (checkOutDialog as any).totalPrice || (checkOutDialog as any).amount || 0) + checkoutCharges.reduce((sum, c) => sum + c.amount, 0),
                        currency
                      )}
                    </span>
                  </div>
                  {checkoutCharges.length > 0 && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Room: {formatCurrencySync((checkOutDialog as any).finalAmount || (checkOutDialog as any).totalPrice || (checkOutDialog as any).amount || 0, currency)} +
                      Charges: {formatCurrencySync(checkoutCharges.reduce((sum, c) => sum + c.amount, 0), currency)}
                    </p>
                  )}
                </div>
              )}

              <div className="rounded-lg bg-blue-50 p-4 border border-blue-200">
                <p className="text-sm font-medium text-blue-900">What happens next?</p>
                <ul className="mt-2 text-sm text-blue-700 space-y-1">
                  <li>✓ Booking status updated to "Checked-Out"</li>
                  <li>✓ Room status set to "Cleaning"</li>
                  <li>✓ Housekeeping task automatically created</li>
                  <li>✓ Invoice generated with all charges</li>
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

      {/* Cancel Booking Dialog */}
      <Dialog open={!!cancelDialog} onOpenChange={(open) => { if (!open) { setCancelDialog(null); setCancelReason(''); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive">Cancel Reservation</DialogTitle>
            <DialogDescription>
              Please provide a reason for cancelling this reservation. This will be recorded in the activity logs.
            </DialogDescription>
          </DialogHeader>
          {cancelDialog && (
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Guest Name</p>
                  <p className="text-base font-semibold">{(cancelDialog as any).guestNameSnapshot || guestMap.get(cancelDialog.guestId)?.name || 'Guest'}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Room Number</p>
                  <p className="text-base font-semibold">
                    {roomMap.get(cancelDialog.roomId)?.roomNumber || 'N/A'}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Check-in</p>
                  <p className="text-sm">{cancelDialog.checkIn ? format(parseISO(cancelDialog.checkIn), 'MMM dd, yyyy') : '—'}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Check-out</p>
                  <p className="text-sm">{cancelDialog.checkOut ? format(parseISO(cancelDialog.checkOut), 'MMM dd, yyyy') : '—'}</p>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="cancel-reason" className="text-sm font-medium">
                  Reason for Cancellation <span className="text-destructive">*</span>
                </Label>
                <Textarea
                  id="cancel-reason"
                  placeholder="e.g. Guest requested cancellation, No-show, Change of plans..."
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  rows={3}
                  className="resize-none"
                />
                {cancelReason.length > 0 && cancelReason.trim().length < 3 && (
                  <p className="text-xs text-destructive">Please provide a more detailed reason (at least 3 characters)</p>
                )}
              </div>

              <div className="rounded-lg bg-rose-50 p-4 border border-rose-200">
                <p className="text-sm font-medium text-rose-900">⚠️ This action cannot be undone</p>
                <p className="text-sm text-rose-700 mt-1">The booking will be marked as cancelled and the reason will be recorded in the activity logs.</p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setCancelDialog(null); setCancelReason(''); }}>
              Go Back
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (cancelDialog && cancelReason.trim().length >= 3) {
                  cancelBooking(cancelDialog.id, cancelReason.trim())
                  setCancelDialog(null)
                  setCancelReason('')
                }
              }}
              disabled={cancelReason.trim().length < 3}
            >
              Confirm Cancellation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="min-h-screen bg-gradient-to-br from-stone-50 via-amber-50/30 to-stone-100">
        <header className="bg-white/80 backdrop-blur-md border-b border-stone-200/60 sticky top-0 z-10 shadow-sm">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-serif font-bold text-stone-800">Reservations</h1>
                <span className="inline-flex items-center justify-center px-3 py-1 text-sm font-medium rounded-full bg-amber-100 text-amber-800 border border-amber-200/60">
                  {filtered.length}
                </span>
              </div>
              <span className="hidden lg:block text-stone-400">|</span>
              <p className="hidden lg:block text-sm text-stone-500">Search, filter and manage bookings</p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                className="border-stone-200 hover:bg-stone-50 hover:border-stone-300 transition-all"
                onClick={() => navigate('/staff/onsite-booking')}
              >
                <span className="mr-1">+</span>
                <span className="hidden sm:inline">New Booking</span>
                <span className="sm:hidden">New</span>
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="border-stone-200 hover:bg-stone-50 hover:border-stone-300 transition-all sm:hidden"
                onClick={() => navigate('/staff/calendar')}
                title="Calendar View"
              >
                <Calendar className="w-4 h-4" />
              </Button>
              <Button
                variant="outline"
                className="border-stone-200 hover:bg-stone-50 hover:border-stone-300 transition-all hidden sm:flex"
                onClick={() => navigate('/staff/calendar')}
              >
                Calendar View
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="border-stone-200 hover:bg-stone-50 hover:border-stone-300 transition-all sm:hidden"
                onClick={() => navigate('/staff/invoices')}
                title="Manage Invoices"
              >
                <Receipt className="w-4 h-4" />
              </Button>
              <Button
                variant="outline"
                className="border-stone-200 hover:bg-stone-50 hover:border-stone-300 transition-all hidden sm:flex"
                onClick={() => navigate('/staff/invoices')}
              >
                <Receipt className="w-4 h-4 mr-1.5" />
                Manage Invoices
              </Button>
            </div>
          </div>
        </header>

        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          {/* Filters Section */}
          <Card className="mb-6 border-stone-200/60 shadow-sm bg-white/90 backdrop-blur-sm">
            <CardContent className="pt-5 pb-5">
              <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
                <div className="md:col-span-4">
                  <Input
                    placeholder="Search by guest, email, room or reference…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className="bg-white border-stone-200 focus:border-amber-400 focus:ring-amber-400/20"
                  />
                </div>
                <div className="md:col-span-2">
                  <Select value={status} onValueChange={(v: any) => setStatus(v)}>
                    <SelectTrigger className="bg-white border-stone-200">
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
                <div className="md:col-span-3">
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-stone-500 font-medium">From</span>
                    <Input
                      type="date"
                      value={from}
                      onChange={(e) => setFrom(e.target.value)}
                      className="bg-white border-stone-200"
                    />
                  </div>
                </div>
                <div className="md:col-span-3">
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-stone-500 font-medium">To</span>
                    <Input
                      type="date"
                      value={to}
                      onChange={(e) => setTo(e.target.value)}
                      className="bg-white border-stone-200"
                    />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Desktop Table View */}
          <Card className="hidden md:block border-stone-200/60 shadow-sm bg-white/90 backdrop-blur-sm overflow-hidden">
            <CardContent className="p-0">
              {filtered.length === 0 ? (
                <p className="text-center text-muted-foreground py-12">No bookings found matching your filters.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent border-b border-border/60">
                        <TableHead className="w-[140px] text-xs font-semibold text-muted-foreground uppercase tracking-wider">Reference</TableHead>
                        <TableHead className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Guest</TableHead>
                        <TableHead className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Room</TableHead>
                        <TableHead className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Dates</TableHead>
                        <TableHead className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">Amount</TableHead>
                        <TableHead className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Status</TableHead>
                        <TableHead className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Payment</TableHead>
                        <TableHead className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filtered.map((b) => {
                        const guest = guestMap.get(b.guestId)
                        const liveRoom = roomMap.get(b.roomId)
                        let roomNumber = liveRoom?.roomNumber || 'N/A'
                        
                        if (roomNumber === 'N/A' && b.special_requests) {
                          const snapMatch = b.special_requests.match(/<!-- ROOM_SNAPSHOT:(.*?) -->/)
                          if (snapMatch) {
                            try {
                              const snap = JSON.parse(snapMatch[1])
                              if (snap.roomNumber) roomNumber = snap.roomNumber
                            } catch {}
                          }
                        }
                        
                        if (roomNumber === 'N/A' && (b as any).roomNumber) {
                          roomNumber = (b as any).roomNumber
                        }

                        const isMainActionLoading = downloadingInvoice === b.id || updatingId === b.id
                        const displayName = resolveGuestDisplayName(b, guest)
                        const displayEmail = (b as any).guestEmailSnapshot || guest?.email

                        const canShowCheckIn = canCheckIn(b)
                        const canShowCheckOut = canCheckOut(b)
                        const isCheckedOut = b.status === 'checked-out'
                        const isCancelled = b.status === 'cancelled'
                        const isGroup = !!b.groupId

                        return (
                          <TableRow key={b.id} className="hover:bg-muted/30 transition-colors cursor-default group">
                            <TableCell>
                              <div className="font-mono text-xs text-muted-foreground bg-muted/50 px-2 py-1 rounded w-fit">
                                #{b.id.slice(-8)}
                              </div>
                              {isGroup && (
                                <div className="mt-1 text-[10px] text-amber-600 font-medium flex items-center gap-1">
                                  <Users className="w-3 h-3" /> {(b as any).groupReference || 'Group'}
                                </div>
                              )}
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-col">
                                <span className="font-medium text-sm text-foreground">{displayName}</span>
                                {displayEmail && <span className="text-xs text-muted-foreground truncate max-w-[180px]">{displayEmail}</span>}
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-col">
                                <span className="font-medium text-sm">Room {roomNumber}</span>
                                <span className="text-[10px] text-muted-foreground capitalize">{(resolveRoomStatus(b, liveRoom) || '').replace('-', ' ')}</span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-col text-sm">
                                <span className="font-medium">{b.checkIn ? format(parseISO(b.checkIn), 'MMM dd') : '—'} <span className="text-muted-foreground">-</span> {b.checkOut ? format(parseISO(b.checkOut), 'MMM dd') : '—'}</span>
                                <span className="text-xs text-muted-foreground">{b.checkOut ? format(parseISO(b.checkOut), 'yyyy') : ''}</span>
                              </div>
                            </TableCell>
                            <TableCell className="text-right font-medium text-sm">
                              {formatCurrencySync(getBookingTotal(b), currency)}
                            </TableCell>
                            <TableCell>
                              <StatusBadge status={b.status} />
                            </TableCell>
                            <TableCell>
                              {(() => {
                                const method = b.paymentMethod || 'Not Paid'
                                const isUnpaid = method === 'Not Paid' || method === 'Not paid' || method === 'not_paid'

                                if (isUnpaid) {
                                  return (
                                    <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-gray-100 text-gray-600 text-[10px] font-medium border border-gray-200">
                                      <Ban className="w-3 h-3" />
                                      Unpaid
                                    </span>
                                  )
                                }

                                return (
                                  <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-emerald-50 text-emerald-700 text-[10px] font-medium border border-emerald-100 ring-1 ring-emerald-600/10">
                                    <CheckCircle2 className="w-3 h-3" />
                                    {method === 'Credit/Debit Card' ? 'Card' : (method === 'mobile_money' ? 'Momo' : method)}
                                  </span>
                                )
                              })()}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-2 opacity-100 group-hover:opacity-100 transition-opacity">
                                {canShowCheckIn && (
                                  <Button size="sm" onClick={() => setCheckInDialog(b)} className="h-8 shadow-sm">
                                    <LogIn className="w-3.5 h-3.5 mr-1.5" /> Check In
                                  </Button>
                                )}

                                {canShowCheckOut && (
                                  <Button size="sm" variant="outline" onClick={() => setCheckOutDialog(b)} className="h-8 border-primary/20 text-primary hover:bg-primary/5 hover:text-primary shadow-sm text-xs">
                                    <LogOut className="w-3.5 h-3.5 mr-1.5" /> Check Out
                                  </Button>
                                )}

                                {isCheckedOut && (
                                  <Button size="sm" variant="ghost" onClick={() => handleDownloadInvoice(b)} disabled={downloadingInvoice === b.id} className="h-8 text-muted-foreground hover:text-foreground">
                                    {downloadingInvoice === b.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                                  </Button>
                                )}

                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
                                      <MoreHorizontal className="w-4 h-4" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end" className="w-[180px]">
                                    <DropdownMenuLabel>Actions</DropdownMenuLabel>
                                    {isGroup && (
                                      <>
                                        <DropdownMenuItem onClick={() => setManageGroupDialog({ groupId: b.groupId!, groupReference: (b as any).groupReference || 'Group' })}>
                                          <Settings className="w-4 h-4 mr-2 text-blue-600" />
                                          <span>Manage Group</span>
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => handleGroupInvoiceDownload(b)}>
                                          <Users className="w-4 h-4 mr-2 text-amber-600" />
                                          <span>Group Invoice</span>
                                        </DropdownMenuItem>
                                      </>
                                    )}
                                    {canShowCheckOut && (
                                      <>
                                        <DropdownMenuItem onClick={() => setChargesDialog(b)}>
                                          <Receipt className="w-4 h-4 mr-2" />
                                          <span>Add Charges</span>
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => setExtendStayDialog(b)}>
                                          <CalendarPlus className="w-4 h-4 mr-2" />
                                          <span>Extend Stay</span>
                                        </DropdownMenuItem>
                                      </>
                                    )}
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem onClick={() => handleDownloadInvoice(b)}>
                                      <Download className="w-4 h-4 mr-2" />
                                      <span>Download Invoice</span>
                                    </DropdownMenuItem>
                                    {!isCancelled && (
                                      <DropdownMenuItem onClick={() => handleDownloadPreInvoice(b)} disabled={downloadingPreInvoice === b.id}>
                                        {downloadingPreInvoice === b.id
                                          ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                          : <FileText className="w-4 h-4 mr-2" />}
                                        <span>Download Pre-Invoice</span>
                                      </DropdownMenuItem>
                                    )}
                                    <DropdownMenuSeparator />
                                    {isCheckedOut && (
                                      <DropdownMenuItem onClick={() => handleWhatsAppShare(b, 'invoice')} disabled={sharingWhatsApp === `${b.id}-invoice`}>
                                        {sharingWhatsApp === `${b.id}-invoice`
                                          ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                          : <MessageCircle className="w-4 h-4 mr-2 text-green-600" />}
                                        <span>Share Invoice via WhatsApp</span>
                                      </DropdownMenuItem>
                                    )}
                                    {!isCancelled && (
                                      <DropdownMenuItem onClick={() => handleWhatsAppShare(b, 'pre-invoice')} disabled={sharingWhatsApp === `${b.id}-pre-invoice`}>
                                        {sharingWhatsApp === `${b.id}-pre-invoice`
                                          ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                          : <MessageCircle className="w-4 h-4 mr-2 text-green-500" />}
                                        <span>Share Pre-Invoice via WhatsApp</span>
                                      </DropdownMenuItem>
                                    )}
                                    {!isCheckedOut && !isCancelled && (
                                      <>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem
                                          onClick={() => setCancelDialog(b)}
                                          className="text-destructive focus:text-destructive focus:bg-destructive/10"
                                        >
                                          <LogOut className="w-4 h-4 mr-2 rotate-180" />
                                          <span>Cancel Booking</span>
                                        </DropdownMenuItem>
                                      </>
                                    )}
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </div>
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

          <div className="md:hidden space-y-3 pb-24">
            {filtered.length === 0 ? (
              <p className="text-center text-muted-foreground py-12">No bookings found matching your filters.</p>
            ) : (
              filtered.map((b) => {
                const guest = guestMap.get(b.guestId)
                const liveRoom = roomMap.get(b.roomId)
                let roomNumber = liveRoom?.roomNumber || 'N/A'
                
                if (roomNumber === 'N/A' && b.special_requests) {
                  const snapMatch = b.special_requests.match(/<!-- ROOM_SNAPSHOT:(.*?) -->/)
                  if (snapMatch) {
                    try {
                      const snap = JSON.parse(snapMatch[1])
                      if (snap.roomNumber) roomNumber = snap.roomNumber
                    } catch {}
                  }
                }
                
                const displayName = resolveGuestDisplayName(b, guest)
                const displayEmail = (b as any).guestEmailSnapshot || guest?.email
                const canShowCheckIn = canCheckIn(b)
                const canShowCheckOut = canCheckOut(b)
                const isGroup = !!b.groupId

                return (
                  <div key={b.id} className="bg-white border rounded-xl p-4 shadow-sm active:scale-[0.99] transition-transform">
                    <div className="flex justify-between items-start mb-3">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-mono text-[9px] text-muted-foreground bg-stone-100 px-1.5 py-0.5 rounded">#{b.id.slice(-8)}</span>
                          <StatusBadge status={b.status} />
                        </div>
                        <h3 className="font-bold text-base text-stone-800 leading-tight">{displayName}</h3>
                        {displayEmail && <p className="text-[11px] text-muted-foreground truncate max-w-[220px]">{displayEmail}</p>}
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8 -mt-1 -mr-2 rounded-full">
                            <MoreHorizontal className="w-5 h-5 text-muted-foreground" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-[200px]">
                          <DropdownMenuLabel>Actions</DropdownMenuLabel>
                          {isGroup && (
                            <DropdownMenuItem onClick={() => setManageGroupDialog({ groupId: b.groupId!, groupReference: (b as any).groupReference || 'Group' })}>
                              <Settings className="w-4 h-4 mr-2 text-blue-600" /> Manage Group
                            </DropdownMenuItem>
                          )}
                          {canShowCheckOut && (
                            <>
                              <DropdownMenuItem onClick={() => setChargesDialog(b)}>
                                <Receipt className="w-4 h-4 mr-2" /> Add Charges
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => setExtendStayDialog(b)}>
                                <CalendarPlus className="w-4 h-4 mr-2" /> Extend Stay
                              </DropdownMenuItem>
                            </>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => handleDownloadInvoice(b)}>
                            <Download className="w-4 h-4 mr-2" /> Download Invoice
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleWhatsAppShare(b, 'invoice')}>
                            <MessageCircle className="w-4 h-4 mr-2 text-green-600" /> Share via WhatsApp
                          </DropdownMenuItem>
                          {b.status !== 'cancelled' && b.status !== 'checked-out' && (
                            <DropdownMenuItem onClick={() => setCancelDialog(b)} className="text-destructive">
                              <LogOut className="w-4 h-4 mr-2 rotate-180" /> Cancel Booking
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>

                    <div className="grid grid-cols-2 gap-3 pt-3 border-t border-stone-50">
                       <div className="space-y-0.5">
                         <p className="text-[9px] uppercase tracking-wider font-bold text-muted-foreground">Room</p>
                         <p className="font-bold text-stone-700 text-sm">Room {roomNumber}</p>
                       </div>
                       <div className="space-y-0.5">
                         <p className="text-[9px] uppercase tracking-wider font-bold text-muted-foreground">Total</p>
                         <p className="font-bold text-primary text-sm tabular-nums">{formatCurrencySync(getBookingTotal(b), currency)}</p>
                       </div>
                       <div className="space-y-0.5">
                         <p className="text-[9px] uppercase tracking-wider font-bold text-muted-foreground">Dates</p>
                         <p className="text-[11px] font-medium text-stone-600">
                           {safeFormatDate(b.checkIn, 'MMM dd')} - {safeFormatDate(b.checkOut, 'MMM dd')}
                         </p>
                       </div>
                       <div className="space-y-0.5">
                         <p className="text-[9px] uppercase tracking-wider font-bold text-muted-foreground">Payment</p>
                         <p className="text-[11px] font-medium text-stone-600">{b.paymentMethod || 'Unpaid'}</p>
                       </div>
                    </div>
                    
                    <div className="flex items-center gap-2 mt-4 pt-3 border-t border-stone-50">
                      {canShowCheckIn && (
                        <Button className="flex-1 h-9 font-bold text-xs bg-primary hover:bg-primary/90" onClick={() => setCheckInDialog(b)}>
                          <LogIn className="w-3.5 h-3.5 mr-1.5" /> Check In
                        </Button>
                      )}
                      {canShowCheckOut && (
                        <Button variant="outline" className="flex-1 h-9 font-bold text-xs border-primary/30 text-primary hover:bg-primary/5" onClick={() => setCheckOutDialog(b)}>
                          <LogOut className="w-3.5 h-3.5 mr-1.5" /> Check Out
                        </Button>
                      )}
                      {!canShowCheckIn && !canShowCheckOut && b.status === 'checked-out' && (
                        <Button variant="secondary" className="flex-1 h-9 font-bold text-xs bg-stone-100 text-stone-700 hover:bg-stone-200" onClick={() => handleDownloadInvoice(b)}>
                          <Download className="w-3.5 h-3.5 mr-1.5" /> Invoice
                        </Button>
                      )}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </main>
      </div >
    </>
  )
}

export default ReservationsPage
