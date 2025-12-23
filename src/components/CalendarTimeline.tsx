import { useRef, useEffect, useState } from 'react'
import { cn } from '../lib/utils'
import { getRoomDisplayName, calculateNights } from '../lib/display'
import { Users, CalendarIcon, Mail, Phone, DollarSign, MessageSquare, LogIn, LogOut, CheckCircle2, CalendarPlus } from 'lucide-react'
import { createInvoiceData, generateInvoicePDF, blobToBase64 } from '@/services/invoice-service'
import { bookingEngine } from '../services/booking-engine'
import { sendCheckInNotification, sendCheckOutNotification } from '@/services/notifications'
import { activityLogService } from '@/services/activity-log-service'
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from './ui/hover-card'
import { Button } from './ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'
import { toast } from 'sonner'
import { blink } from '../blink/client'
import { CheckInDialog } from '@/components/dialogs/CheckInDialog'
import { CheckOutDialog } from '@/components/dialogs/CheckOutDialog'
import { ExtendStayDialog } from '@/components/dialogs/ExtendStayDialog'
import { formatCurrencySync } from '../lib/utils'
import { useCurrency } from '../hooks/use-currency'

interface CalendarTimelineProps {
  currentDate: Date
  properties: any[]
  bookings: any[]
  monthNames: string[]
  weekDays: string[]
  onBookingUpdate?: () => void
}

export function CalendarTimeline({
  currentDate,
  properties,
  bookings,
  monthNames,
  weekDays,
  onBookingUpdate,
}: CalendarTimelineProps) {
  const { currency } = useCurrency()
  const [checkInDialog, setCheckInDialog] = useState<any>(null)
  const [checkOutDialog, setCheckOutDialog] = useState<any>(null)
  const [extendStayDialog, setExtendStayDialog] = useState<any>(null)
  const [processing, setProcessing] = useState(false)
  const timelineRef = useRef<HTMLDivElement>(null)
  const headerRef = useRef<HTMLDivElement>(null)
  const headerContentRef = useRef<HTMLDivElement>(null)
  const scrollTimeoutRef = useRef<number | null>(null)
  const datesRef = useRef<Date[]>([])
  const initialScrollDoneRef = useRef(false)
  const [visibleMonth, setVisibleMonth] = useState('')
  const [isScrolling, setIsScrolling] = useState(false)

  // Generate dates: 30 days before current month start through the end of the month 12 months ahead
  const getExtendedTimelineDates = () => {
    const dates: Date[] = []
    const y = currentDate.getFullYear()
    const m = currentDate.getMonth()
    const startOfCurrentMonth = new Date(y, m, 1)

    // Start 30 days before the first day of current month
    const extendedStart = new Date(startOfCurrentMonth)
    extendedStart.setDate(extendedStart.getDate() - 30)
    extendedStart.setHours(0, 0, 0, 0)

    // End at the last day of the month 12 months after the current month (exclusive +1 day)
    const endOfTargetMonth = new Date(y, m + 12, 0) // last day of target month
    const endExclusive = new Date(endOfTargetMonth)
    endExclusive.setDate(endOfTargetMonth.getDate() + 1)
    endExclusive.setHours(0, 0, 0, 0)

    for (let d = new Date(extendedStart); d < endExclusive; d.setDate(d.getDate() + 1)) {
      dates.push(new Date(d.getFullYear(), d.getMonth(), d.getDate()))
    }

    return dates
  }

  const timelineDates = getExtendedTimelineDates()

  // Keep a ref of current timeline dates for event handlers
  useEffect(() => {
    datesRef.current = timelineDates
  }, [timelineDates])

  // Calculate visible month based on scroll position (leftmost visible date)
  const calculateVisibleMonth = (scrollLeft: number, containerWidth: number) => {
    const dayWidth = 80
    const dates = (datesRef.current && datesRef.current.length > 0) ? datesRef.current : timelineDates
    // Calculate the index of the leftmost visible date (adding small offset for border)
    const leftmostVisibleIdx = Math.floor((scrollLeft + 5) / dayWidth)
    const clampedIdx = Math.max(0, Math.min(leftmostVisibleIdx, dates.length - 1))
    const visibleDate = dates[clampedIdx]
    if (visibleDate) {
      return `${monthNames[visibleDate.getMonth()]} ${visibleDate.getFullYear()}`
    }
    return ''
  }

  // Sync horizontal scroll between header and timeline (attach once)
  useEffect(() => {
    const timeline = timelineRef.current
    const header = headerRef.current
    if (!timeline || !header) return

    // Local helper for month label based on current dates
    const calcVisibleMonth = (scrollLeft: number) => {
      const dayWidth = 80
      const dates = (datesRef.current && datesRef.current.length > 0) ? datesRef.current : timelineDates
      const leftmostVisibleIdx = Math.floor((scrollLeft + 5) / dayWidth)
      const clampedIdx = Math.max(0, Math.min(leftmostVisibleIdx, dates.length - 1))
      const visibleDate = dates[clampedIdx]
      return visibleDate ? `${monthNames[visibleDate.getMonth()]} ${visibleDate.getFullYear()}` : ''
    }

    const handleTimelineScroll = () => {
      const sl = timeline.scrollLeft

      // Sync header using transform for smooth performance
      if (headerContentRef.current) {
        headerContentRef.current.style.transform = `translateX(-${sl}px)`
      }

      // Update visible month label based on current dates reference
      const month = calcVisibleMonth(sl)
      setVisibleMonth(month)

      // Track scrolling state for visual feedback
      setIsScrolling(true)
      if (scrollTimeoutRef.current) {
        window.clearTimeout(scrollTimeoutRef.current)
      }
      scrollTimeoutRef.current = window.setTimeout(() => {
        setIsScrolling(false)
      }, 150)
    }

    // Use passive scroll listener for better performance
    timeline.addEventListener('scroll', handleTimelineScroll, { passive: true })

    // Enhanced wheel handling: allow vertical scroll by default; hold Shift to scroll horizontally
    const handleWheel = (e: WheelEvent) => {
      // Convert vertical wheel to horizontal ONLY when Shift is pressed
      if (e.shiftKey && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault()
        timeline.scrollBy({ left: e.deltaY, behavior: 'auto' })
      }
    }
    timeline.addEventListener('wheel', handleWheel, { passive: false })

    // Initial label sync - force current month by default
    const initialMonth = `${monthNames[currentDate.getMonth()]} ${currentDate.getFullYear()}`
    setVisibleMonth(initialMonth)

    if (!initialScrollDoneRef.current) {
      const dayWidth = 80
      // Scroll so the first day of the current month is at the left edge
      const rawTarget = 30 * dayWidth
      const maxScrollLeft = Math.max(0, timeline.scrollWidth - timeline.clientWidth)
      const scrollTarget = Math.max(0, Math.min(rawTarget, maxScrollLeft))
      requestAnimationFrame(() => {
        timeline.scrollLeft = scrollTarget
        if (headerContentRef.current) {
          headerContentRef.current.style.transform = `translateX(-${scrollTarget}px)`
        }
        setVisibleMonth(initialMonth)
        initialScrollDoneRef.current = true
      })
    }

    return () => {
      timeline.removeEventListener('scroll', handleTimelineScroll)
      timeline.removeEventListener('wheel', handleWheel as any)
      if (scrollTimeoutRef.current) {
        window.clearTimeout(scrollTimeoutRef.current)
      }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const dateKey = (d: Date) => {
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }

  // Find a booking whose first VISIBLE day on the timeline starts at this column index.
  // This ensures bookings that began before the current viewport are still rendered
  // exactly from the first visible day. Check-out is treated as exclusive.
  const findBookingStartingAtIndex = (propertyId: string, columnIndex: number) => {
    for (const booking of bookings) {
      // Hide bookings after checkout; keep visible for confirmed/reserved/checked-in
      if (booking.status === 'checked-out') continue
      const bRoomId = booking.propertyId ?? booking.roomId
      if (bRoomId !== propertyId) continue
      const { startIdx, span } = getBookingSpan(booking, timelineDates[0])
      if (span > 0 && startIdx === columnIndex) return booking
    }
    return null
  }

  const getBookingSpan = (booking: any, _startDate: Date) => {
    const toLocalStart = (val: string | Date) => {
      if (typeof val === 'string') {
        // Safe local parsing for YYYY-MM-DD strings (avoid timezone shifts)
        const m = val.match(/^(\d{4})-(\d{2})-(\d{2})$/)
        if (m) {
          const y = Number(m[1])
          const mo = Number(m[2]) - 1
          const d = Number(m[3])
          return new Date(y, mo, d)
        }
        const dt = new Date(val)
        return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate())
      }
      const dt = new Date(val)
      return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate())
    }
    const addDays = (d: Date, days: number) => {
      const nd = new Date(d)
      nd.setDate(nd.getDate() + days)
      nd.setHours(0, 0, 0, 0)
      return nd
    }

    const checkIn = toLocalStart(booking.checkIn)
    const checkOut = toLocalStart(booking.checkOut)

    const firstVisible = toLocalStart(timelineDates[0])
    const lastVisible = toLocalStart(timelineDates[timelineDates.length - 1])
    const lastVisibleExclusive = addDays(lastVisible, 1)

    const visibleStart = new Date(Math.max(checkIn.getTime(), firstVisible.getTime()))
    const visibleEndExclusive = new Date(Math.min(checkOut.getTime(), lastVisibleExclusive.getTime()))

    if (visibleEndExclusive.getTime() <= visibleStart.getTime()) {
      return { startIdx: -1, endIdx: -1, span: 0 }
    }

    const startIdx = timelineDates.findIndex(d => dateKey(toLocalStart(d)) === dateKey(visibleStart))
    const span = Math.round((visibleEndExclusive.getTime() - visibleStart.getTime()) / (1000 * 60 * 60 * 24))
    const endIdx = startIdx + span - 1

    return { startIdx, endIdx, span }
  }

  const getLastName = (fullName: string) => {
    const parts = fullName.trim().split(' ')
    return parts.length > 1 ? parts[parts.length - 1] : fullName
  }

  // Group dates by month for header display
  const getMonthGroups = () => {
    const groups: { month: string; startIdx: number; count: number }[] = []
    let currentMonth = ''
    let startIdx = 0
    let count = 0

    timelineDates.forEach((date, idx) => {
      const monthYear = `${monthNames[date.getMonth()]} ${date.getFullYear()}`

      if (monthYear !== currentMonth) {
        if (count > 0) {
          groups.push({ month: currentMonth, startIdx, count })
        }
        currentMonth = monthYear
        startIdx = idx
        count = 1
      } else {
        count++
      }
    })

    if (count > 0) {
      groups.push({ month: currentMonth, startIdx, count })
    }

    return groups
  }

  const monthGroups = getMonthGroups()

  // Check-in handler
  // Check-in handler removed (logic moved to CheckInDialog)

  // Check-out handler
  const handleCheckOut = async (booking: any) => {
    setProcessing(true)
    try {
      const remoteId = booking.remoteId || booking.id
      const db = blink.db as any

      // Use booking engine to handle status update, timestamps, room status, logs, and cleanup tasks
      await bookingEngine.updateBookingStatus(remoteId, 'checked-out')

      // Get room info for invoice
      const roomId = booking.propertyId || booking.roomId
      let roomNumber = 'N/A'
      let room: any = null

      if (roomId) {
        const rooms = await db.rooms.list({ limit: 500 })
        room = rooms.find((r: any) => r.id === roomId)
        if (room) roomNumber = room.roomNumber || 'N/A'
      }

      // Generate and send invoice
      try {
        console.log('🚀 [CalendarTimeline] Starting invoice generation...', {
          bookingId: remoteId,
          guestName: booking.guestName,
          roomNumber: roomNumber,
          guestEmail: booking.guestEmail
        })

        // Create booking with details for invoice
        const bookingWithDetails = {
          id: remoteId,
          guestId: booking.guestId || '',
          roomId: roomId,
          checkIn: booking.checkIn,
          checkOut: booking.checkOut,
          status: 'checked-out',
          totalPrice: booking.totalPrice || 0,
          numGuests: booking.numGuests || 1,
          actualCheckOut: new Date().toISOString(),
          createdAt: booking.createdAt || new Date().toISOString(),
          guest: {
            name: booking.guestName,
            email: booking.guestEmail || '',
            phone: booking.guestPhone,
            address: booking.guestAddress
          },
          room: {
            roomNumber: roomNumber,
            roomType: room?.roomType || 'Standard Room'
          }
        }

        console.log('📊 [CalendarTimeline] Creating invoice data...')
        // Generate invoice data
        const invoiceData = await createInvoiceData(bookingWithDetails, room)
        console.log('✅ [CalendarTimeline] Invoice data created:', invoiceData.invoiceNumber)

        // IMPORTANT: Save the invoice number to the booking record for consistency
        try {
          const db = blink.db as any
          await db.bookings.update(bookingWithDetails.id, { invoiceNumber: invoiceData.invoiceNumber })
          console.log('✅ [CalendarTimeline] Invoice number saved to booking:', invoiceData.invoiceNumber)
        } catch (saveError) {
          console.error('⚠️ [CalendarTimeline] Failed to save invoice number:', saveError)
        }

        console.log('📄 [CalendarTimeline] Generating invoice PDF...')
        // Generate invoice PDF
        const invoicePdf = await generateInvoicePDF(invoiceData)
        console.log('✅ [CalendarTimeline] Invoice PDF generated')

        console.log('📧 [CalendarTimeline] Sending standard check-out notification with invoice...')

        // Prepare attachments (invoice PDF)
        const pdfBase64 = await blobToBase64(invoicePdf)
        const attachments = [
          {
            filename: `invoice-${invoiceData.invoiceNumber}.pdf`,
            content: pdfBase64,
            contentType: 'application/pdf'
          }
        ]

        // Prepare data for notification
        const guest = {
          id: bookingWithDetails.guestId,
          name: bookingWithDetails.guest.name,
          email: bookingWithDetails.guest.email,
          phone: bookingWithDetails.guest.phone || null
        }

        const roomInfo = {
          id: bookingWithDetails.roomId,
          roomNumber: roomNumber
        }

        const bookingInfo = {
          id: bookingWithDetails.id,
          checkIn: bookingWithDetails.checkIn,
          checkOut: bookingWithDetails.checkOut,
          actualCheckOut: bookingWithDetails.actualCheckOut
        }

        const invoiceInfo = {
          invoiceNumber: invoiceData.invoiceNumber,
          totalAmount: invoiceData.charges.total,
          downloadUrl: `${window.location.origin}/invoice/${invoiceData.invoiceNumber}?bookingId=${bookingWithDetails.id}`
        }

        // Send standardized check-out email
        if (guest.email) {
          await sendCheckOutNotification(guest, roomInfo, bookingInfo, invoiceInfo, attachments)
          console.log('✅ [CalendarTimeline] Check-out email sent successfully')
          toast.success(`Guest ${booking.guestName} checked out successfully! Invoice sent to ${booking.guestEmail}.`)
        } else {
          console.warn('⚠️ [CalendarTimeline] No guest email, skipping check-out email')
          toast.success(`Guest ${booking.guestName} checked out successfully! Cleaning task created. No email sent (missing address).`)
        }
      } catch (invoiceError: any) {
        console.error('❌ [CalendarTimeline] Invoice generation/sending failed:', invoiceError)
        console.error('❌ [CalendarTimeline] Error details:', {
          message: invoiceError.message,
          stack: invoiceError.stack,
          name: invoiceError.name
        })
        toast.success(`Guest ${booking.guestName} checked out successfully! Cleaning task created. Invoice generation failed.`)
      }



      setCheckOutDialog(null)
      onBookingUpdate?.()
    } catch (error) {
      console.error('Check-out failed:', error)
      toast.error('Failed to check out guest')
    } finally {
      setProcessing(false)
    }
  }

  // Determine if check-in is allowed
  const canCheckIn = (booking: any) => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const checkInDate = new Date(booking.checkIn)
    checkInDate.setHours(0, 0, 0, 0)
    return booking.status === 'confirmed' && checkInDate <= today
  }

  // Determine if check-out is allowed
  const canCheckOut = (booking: any) => {
    return booking.status === 'checked-in'
  }

  // Sync timeline and month header when currentDate changes (arrow buttons / Today)
  useEffect(() => {
    const timeline = timelineRef.current
    const headerContent = headerContentRef.current
    if (!timeline) return

    const dayWidth = 80
    const y = currentDate.getFullYear()
    const m = currentDate.getMonth()

    // Find the index of the first day of the target month within current timeline dates
    const index = timelineDates.findIndex(
      (d) => d.getFullYear() === y && d.getMonth() === m && d.getDate() === 1
    )

    const rawTarget = (index >= 0 ? index : 0) * dayWidth
    const maxScrollLeft = Math.max(0, timeline.scrollWidth - timeline.clientWidth)
    const scrollTarget = Math.max(0, Math.min(rawTarget, maxScrollLeft))

    // Jump to the computed position; the scroll listener will keep header in sync
    timeline.scrollLeft = scrollTarget
    if (headerContent) {
      headerContent.style.transform = `translateX(-${scrollTarget}px)`
    }

    // Immediately update label for responsiveness
    setVisibleMonth(`${monthNames[m]} ${y}`)
  }, [currentDate])

  return (
    <>
      {/* Check-In Dialog */}
      <CheckInDialog
        open={!!checkInDialog}
        onOpenChange={(open) => !open && setCheckInDialog(null)}
        booking={checkInDialog}
        room={checkInDialog ? {
          id: checkInDialog.propertyId || checkInDialog.roomId,
          roomNumber: properties.find((p) => p.id === (checkInDialog.propertyId || checkInDialog.roomId))?.roomNumber || 'N/A',
          status: 'available' // Assume available as timeline check-in logic usually implies it, but shared hook validates.
          // Ideally we pass the real room object if available.
        } : null}
        guest={checkInDialog ? {
          id: checkInDialog.guestId,
          name: checkInDialog.guestName,
          email: checkInDialog.guestEmail,
          phone: checkInDialog.guestPhone
        } : null}
        onSuccess={() => {
          setCheckInDialog(null)
          onBookingUpdate?.()
        }}
      />

      {/* Check-Out Dialog */}
      <CheckOutDialog
        open={!!checkOutDialog}
        onOpenChange={(open) => !open && setCheckOutDialog(null)}
        booking={checkOutDialog}
        room={properties.find((p) => p.id === (checkOutDialog?.propertyId || checkOutDialog?.roomId))}
        guest={{ name: checkOutDialog?.guestName }}
        onConfirm={() => handleCheckOut(checkOutDialog)}
        processing={processing}
      />

      {/* Extend Stay Dialog */}
      {extendStayDialog && (
        <ExtendStayDialog
          open={!!extendStayDialog}
          onOpenChange={(open) => !open && setExtendStayDialog(null)}
          booking={extendStayDialog}
          guest={{
            id: extendStayDialog.guestId || '',
            name: extendStayDialog.guestName || 'Guest',
            email: extendStayDialog.guestEmail || ''
          }}
          room={{
            id: extendStayDialog.propertyId || extendStayDialog.roomId || '',
            roomNumber: properties.find((p) => p.id === (extendStayDialog?.propertyId || extendStayDialog?.roomId))?.roomNumber || 'N/A'
          }}
          onExtensionComplete={() => onBookingUpdate?.()}
        />
      )}

      <div className="flex flex-col h-full bg-white">
        {/* Fixed Header - Room Label Column */}
        <div className="flex-shrink-0 sticky top-0 z-20 bg-white border-b border-gray-200">
          <div className="flex">
            {/* Fixed room label header */}
            <div className="w-52 flex-shrink-0 border-r border-gray-200" style={{ backgroundColor: '#F8F9FA' }}>
              <div className="h-20 flex flex-col items-start justify-center px-4">
                <span className="font-semibold text-base text-gray-900">
                  {visibleMonth || `${monthNames[currentDate.getMonth()]} ${currentDate.getFullYear()}`}
                </span>
                <span className="text-xs text-gray-500 mt-0.5">Rooms</span>
              </div>
            </div>

            {/* Scrollable date headers (synced via transform) */}
            <div ref={headerRef} className="flex-1 overflow-hidden">
              <div
                ref={headerContentRef}
                className="inline-flex"
                style={{ width: `${timelineDates.length * 80}px`, willChange: 'transform' }}
              >
                {/* Date row */}
                <div className="flex w-full">
                  {timelineDates.map((date, dateIndex) => {
                    const dayOfWeek = weekDays[date.getDay()].substring(0, 3)
                    const dayOfMonth = date.getDate()
                    const isToday = new Date().toDateString() === date.toDateString()
                    const isWeekend = date.getDay() === 0 || date.getDay() === 6

                    return (
                      <div
                        key={dateIndex}
                        className="min-w-[80px] border-r border-gray-200 last:border-r-0"
                        style={{ width: '80px' }}
                      >
                        <div
                          className={cn(
                            'h-20 flex flex-col items-center justify-center gap-1.5 bg-white'
                          )}
                        >
                          <span className="text-[11px] uppercase tracking-wide text-gray-400">
                            {dayOfWeek}
                          </span>
                          <span className="text-[13px] font-medium text-gray-400">
                            {dayOfMonth}
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-hidden">
          <div className="flex overflow-y-auto items-start h-full">
            {/* Fixed room name column (stays put while horizontal scroll happens on the right) */}
            <div className="w-52 flex-shrink-0 border-r border-gray-200" style={{ backgroundColor: '#F8F9FA' }}>
              {properties.map((property) => (
                <div
                  key={property.id}
                  className="h-16 border-b border-gray-200 flex items-center px-4 hover:bg-gray-100 transition-colors"
                  style={{ backgroundColor: '#34495E' }}
                >
                  <div className="w-full">
                    <div className="font-medium text-sm text-white">
                      {getRoomDisplayName(property)}
                    </div>
                    <div className="text-xs text-gray-300 flex items-center gap-1 mt-1">
                      <Users className="w-3 h-3" />
                      <span>x{property.maxGuests || 0}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Horizontal scroller for date columns with booking data */}
            <div
              ref={timelineRef}
              className="flex-1 overflow-x-auto overflow-y-hidden"
              style={{
                scrollBehavior: 'smooth',
                WebkitOverflowScrolling: 'touch',
              }}
            >
              <div className="flex" style={{ width: `${timelineDates.length * 80}px` }}>
                {timelineDates.map((date, dateIndex) => {
                  const isWeekend = date.getDay() === 0 || date.getDay() === 6

                  return (
                    <div
                      key={dateIndex}
                      className="min-w-[80px] border-r last:border-r-0"
                      style={{ width: '80px' }}
                    >
                      {properties.map((property) => {
                        const bookingStart = findBookingStartingAtIndex(property.id, dateIndex)
                        return (
                          <div
                            key={property.id}
                            className="h-16 border-b border-gray-200 relative bg-white"
                          >
                            {bookingStart &&
                              (() => {
                                const { startIdx, span } = getBookingSpan(
                                  bookingStart,
                                  date
                                )
                                const targetRoomId =
                                  bookingStart.propertyId ?? bookingStart.roomId
                                const prop = properties.find(
                                  (p) => p.id === targetRoomId
                                )
                                const roomNumber =
                                  prop?.roomNumber || prop?.name || 'N/A'
                                const lastName = getLastName(
                                  bookingStart.guestName || ''
                                )

                                if (dateIndex !== startIdx) return null

                                return (
                                  <HoverCard key={bookingStart.id} openDelay={100}>
                                    <HoverCardTrigger asChild>
                                      <div
                                        className="absolute top-2 left-1 h-10 flex items-center justify-center px-3 rounded-full text-white font-semibold text-xs shadow-md hover:shadow-lg cursor-pointer transition-all z-10 ring-1 ring-white/60"
                                        style={{
                                          backgroundColor: (bookingStart.status === 'checked-in' ? '#22C55E' : ((bookingStart.status === 'pending' || bookingStart.status === 'reserved') ? '#EAB308' : '#EF4444')),
                                          // Width spans full nights (check-out exclusive). Left offset is 4px (left-1), so subtract 4px to end flush at next day boundary.
                                          width: `calc(${span} * 80px - 4px)`,
                                        }}
                                        title={`${bookingStart.guestName} • Room #${roomNumber}`}
                                      >
                                        <span className="truncate">
                                          #{roomNumber} {lastName}
                                        </span>
                                      </div>
                                    </HoverCardTrigger>
                                    <HoverCardContent
                                      className="w-[400px] rounded-xl border bg-white p-4 shadow-xl"
                                      side="right"
                                      align="start"
                                    >
                                      <div className="space-y-3">
                                        <div className="flex items-start justify-between">
                                          <div>
                                            <div className="text-xs text-muted-foreground">Room #{roomNumber}</div>
                                            <div className="text-base font-semibold text-foreground">{bookingStart.guestName}</div>
                                          </div>
                                          <span
                                            className={cn(
                                              'px-2 py-1 rounded-full text-xs font-medium',
                                              (bookingStart.status === 'checked-in')
                                                ? 'bg-green-100 text-green-700'
                                                : ((bookingStart.status === 'pending' || bookingStart.status === 'reserved')
                                                  ? 'bg-yellow-100 text-yellow-800'
                                                  : 'bg-red-100 text-red-700')
                                            )}
                                          >
                                            {bookingStart.status ? String(bookingStart.status).replace('-', ' ') : 'confirmed'}
                                          </span>
                                        </div>

                                        <div className="space-y-2.5">
                                          <div className="flex items-center gap-2 text-sm">
                                            <CalendarIcon className="w-4 h-4 text-muted-foreground" />
                                            <span className="text-foreground">
                                              {new Date(bookingStart.checkIn).toLocaleDateString('en-US', {
                                                year: 'numeric',
                                                month: '2-digit',
                                                day: '2-digit',
                                                hour: '2-digit',
                                                minute: '2-digit'
                                              })}{' '}
                                              -{' '}
                                              {new Date(bookingStart.checkOut).toLocaleDateString('en-US', {
                                                year: 'numeric',
                                                month: '2-digit',
                                                day: '2-digit',
                                                hour: '2-digit',
                                                minute: '2-digit'
                                              })}
                                            </span>
                                          </div>
                                          <div className="pl-6 text-xs text-muted-foreground">
                                            {calculateNights(bookingStart.checkIn, bookingStart.checkOut)} {calculateNights(bookingStart.checkIn, bookingStart.checkOut) === 1 ? 'night' : 'nights'}
                                          </div>

                                          <div className="flex items-center gap-2 text-sm">
                                            <Users className="w-4 h-4 text-muted-foreground" />
                                            <span className="text-foreground">
                                              Guests: {bookingStart.numGuests || 2}
                                            </span>
                                          </div>

                                          {bookingStart.guestPhone && (
                                            <div className="flex items-center gap-2 text-sm">
                                              <Phone className="w-4 h-4 text-muted-foreground" />
                                              <span className="text-foreground">{bookingStart.guestPhone}</span>
                                            </div>
                                          )}
                                          {bookingStart.guestEmail && (
                                            <div className="flex items-center gap-2 text-sm">
                                              <Mail className="w-4 h-4 text-muted-foreground" />
                                              <span className="truncate text-foreground">{bookingStart.guestEmail}</span>
                                            </div>
                                          )}

                                          {bookingStart.totalPrice > 0 && (
                                            <div className="flex items-center gap-2 text-sm">
                                              <DollarSign className="w-4 h-4 text-muted-foreground" />
                                              <span className="text-foreground">
                                                Total: {formatCurrencySync(Number(bookingStart.totalPrice), currency)}
                                              </span>
                                            </div>
                                          )}

                                          <div className="pt-2 border-t text-xs text-muted-foreground">
                                            Created {new Date(bookingStart.createdAt || bookingStart.checkIn).toLocaleString('en-US', {
                                              year: 'numeric',
                                              month: '2-digit',
                                              day: '2-digit',
                                              hour: '2-digit',
                                              minute: '2-digit'
                                            })}
                                          </div>
                                        </div>

                                        {/* Check-in/Check-out Actions */}
                                        <div className="pt-3 border-t flex gap-2">
                                          {/* Show Check In button ONLY for confirmed bookings (red) */}
                                          {canCheckIn(bookingStart) && (
                                            <Button
                                              size="sm"
                                              className="flex-1"
                                              onClick={(e) => {
                                                e.stopPropagation()
                                                setCheckInDialog(bookingStart)
                                              }}
                                            >
                                              <LogIn className="w-4 h-4 mr-2" />
                                              Check In
                                            </Button>
                                          )}

                                          {/* Show Check Out button ONLY for checked-in bookings (green) */}
                                          {canCheckOut(bookingStart) && (
                                            <>
                                              <Button
                                                size="sm"
                                                variant="ghost"
                                                className="flex-1 text-amber-600 hover:text-amber-700"
                                                onClick={(e) => {
                                                  e.stopPropagation()
                                                  setExtendStayDialog(bookingStart)
                                                }}
                                              >
                                                <CalendarPlus className="w-4 h-4 mr-2" />
                                                Extend
                                              </Button>
                                              <Button
                                                size="sm"
                                                variant="outline"
                                                className="flex-1"
                                                onClick={(e) => {
                                                  e.stopPropagation()
                                                  setCheckOutDialog(bookingStart)
                                                }}
                                              >
                                                <LogOut className="w-4 h-4 mr-2" />
                                                Check Out
                                              </Button>
                                            </>
                                          )}

                                          {/* Show completed message for checked-out bookings */}
                                          {bookingStart.status === 'checked-out' && (
                                            <div className="flex-1 flex items-center justify-center gap-2 text-sm text-green-600">
                                              <CheckCircle2 className="w-4 h-4" />
                                              Completed
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    </HoverCardContent>
                                  </HoverCard>
                                )
                              })()}
                          </div>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}