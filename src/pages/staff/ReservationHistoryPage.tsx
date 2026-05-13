import { useState, useEffect } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { db, auth } from '@/lib/db'
import { CalendarPlus, UserPlus, Loader2, FileText, Users, Mail, CreditCard, CheckCircle, XCircle } from 'lucide-react'
import { format, parseISO, isToday } from 'date-fns'
import { safeFormatDate, safeParseISO } from '@/lib/safe-date'
import { toast } from 'sonner'
import { useStaffRole } from '@/hooks/use-staff-role'
import { useSubscription } from '@/hooks/use-subscription'
import ActivityDetailsSheet, { ActivityType, ActivitySummary } from '@/features/history/ActivityDetailsSheet'

// Optimized staff info lookup function
function getStaffInfoFromMap(staffId: string | undefined, staffMap: Map<string, any>) {
  if (!staffId) return undefined
  
  const staff = staffMap.get(staffId)
  if (staff) {
    return {
      id: staff.id,
      name: staff.name || 'Unknown Staff',
      role: staff.role || 'staff'
    }
  }
  
  return undefined
}

// Optimized staff info lookup by email
function getStaffInfoFromEmail(email: string | undefined, staffMap: Map<string, any>) {
  if (!email) return undefined
  
  const staff = staffMap.get(email)
  if (staff) {
    return {
      id: staff.id,
      name: staff.name || 'Unknown Staff',
      role: staff.role || 'staff'
    }
  }
  
  return undefined
}

interface Activity {
  id: string
  type: ActivityType
  timestamp: string
  title: string
  details: string
  performedBy?: {
    id: string
    name: string
    role: string
  }
  entityData?: any // Additional data about the entity (booking, guest, etc.)
}

export function ReservationHistoryPage() {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [query, setQuery] = useState('')
  const [activities, setActivities] = useState<Activity[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'today'>('all')
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [selectedActivity, setSelectedActivity] = useState<ActivitySummary | null>(null)
  const { role, staffRecord: staffData, isLoading: staffLoading } = useStaffRole()
  
  // Real-time subscriptions
  const bookingsUpdate = useSubscription('bookings')
  const guestsUpdate = useSubscription('guests')
  const invoicesUpdate = useSubscription('invoices')
  const staffUpdate = useSubscription('staff')
  const contactUpdate = useSubscription('contact_messages')
  
  console.log('[ReservationHistoryPage] useStaffRole result:', { staffData, role, staffLoading })

  const handleOpenDetails = (activity: Activity) => {
    const rawId = activity.id.replace(/^booking-|^guest-|^invoice-|^staff-|^contact-|^checkin-|^checkout-|^payment-/, '')
    setSelectedActivity({ 
      id: rawId, 
      type: activity.type, 
      title: activity.title,
      details: activity.details,
      timestamp: activity.timestamp,
      performedBy: activity.performedBy,
      entityData: activity.entityData
    })
    setDetailsOpen(true)
  }

  // Fetch activities from database
  const fetchActivities = useCallback(async () => {
    try {
      setLoading(true)
      
      // Fetch all relevant data from database with reduced limits for better performance
      const [bookingsData, guestsData, invoicesData, staffData, allGuestsForMap, allPropertiesForMap, roomsTable] = await Promise.all([
        db.bookings.list({ orderBy: { createdAt: 'desc' }, limit: 50 }).catch(() => []),
        db.guests.list({ orderBy: { createdAt: 'desc' }, limit: 50 }).catch(() => []),
        db.invoices.list({ orderBy: { createdAt: 'desc' }, limit: 50 }).catch(() => []),
        db.staff.list({ orderBy: { createdAt: 'desc' }, limit: 50 }).catch(() => []),
        db.guests.list().catch(() => []),
        db.properties.list().catch(() => []),
        (db as any).rooms.list().catch(() => []),
      ])

      const guestLookupMap = new Map<string, any>(allGuestsForMap.map((g: any) => [g.id, g] as [string, any]))
      
      // Combine rooms and properties for maximum ID coverage
      const combinedRooms = [...allPropertiesForMap]
      const seenRoomIds = new Set(allPropertiesForMap.map((item: any) => item.id))
      
      ;(roomsTable || []).forEach((rt: any) => {
        if (!seenRoomIds.has(rt.id)) {
          combinedRooms.push(rt)
          seenRoomIds.add(rt.id)
        }
      })

      const propertyLookupMap = new Map<string, any>(combinedRooms.map((p: any) => [p.id, p] as [string, any]))

      // Fetch activity logs to show booking deletions and other activities
      const activityLogsData = await db.activityLogs.list({
        orderBy: { createdAt: 'desc' },
        limit: 50
      }).catch(() => [])

      const allActivities: Activity[] = []

      // Create staff lookup map for better performance (index by both ID and email)
      const staffMap = new Map()
      staffData.forEach(staff => {
        staffMap.set(staff.id, staff)
        if (staff.userId) staffMap.set(staff.userId, staff)
        if (staff.email) staffMap.set(staff.email, staff)
      })

      // Booking activities
      for (const booking of bookingsData) {
        const performedBy = getStaffInfoFromMap(booking.userId || booking.createdBy, staffMap)
        
        // Get guest and room information
        let guestName = 'Unknown Guest'
        let roomNumber = 'Unknown Room'
        
        if (booking.guestId) {
          const guest = guestLookupMap.get(booking.guestId)
          if (guest?.name) guestName = guest.name
        } else if (booking.guest?.name) {
          guestName = booking.guest.name
        }

        if (booking.roomId) {
          const property = propertyLookupMap.get(booking.roomId)
          if (property) roomNumber = property.roomNumber || property.name || roomNumber
        } 
        
        // Fallback to snapshot in special_requests
        if (roomNumber === 'Unknown Room' || roomNumber === 'N/A') {
          const specialReq = booking.special_requests || booking.specialRequests || ''
          const snapMatch = specialReq.match(/<!-- ROOM_SNAPSHOT:(.*?) -->/)
          if (snapMatch) {
            try {
              const snap = JSON.parse(snapMatch[1])
              if (snap.roomNumber) roomNumber = snap.roomNumber
            } catch {}
          }
        }

        // Final fallback to legacy columns
        if (roomNumber === 'Unknown Room' || roomNumber === 'N/A') {
          if (booking.roomNumber) roomNumber = booking.roomNumber
          else if (booking.room_number) roomNumber = booking.room_number
        }
        
        // Booking creation
        allActivities.push({
          id: `booking-${booking.id}`,
          type: 'booking' as const,
          timestamp: booking.createdAt || new Date().toISOString(),
          title: `Reservation created - ${guestName} (Room ${roomNumber})`,
          details: `Room ${roomNumber} - Check-in: ${booking.dates?.checkIn || booking.checkIn}, Check-out: ${booking.dates?.checkOut || booking.checkOut}`,
          performedBy: performedBy || undefined,
          entityData: {
            bookingId: booking.id,
            roomNumber: roomNumber,
            roomType: booking.roomType,
            guestName: guestName,
            guestEmail: booking.guest?.email || booking.guestId,
            checkIn: booking.dates?.checkIn || booking.checkIn,
            checkOut: booking.dates?.checkOut || booking.checkOut,
            amount: booking.amount || booking.totalPrice,
            status: booking.status,
            source: booking.source,
            createdAt: booking.createdAt,
            updatedAt: booking.updatedAt
          }
        })

        // Check-in activity
        if (booking.actualCheckIn) {
          allActivities.push({
            id: `checkin-${booking.id}`,
            type: 'checkin' as const,
            timestamp: booking.actualCheckIn,
            title: `Guest checked in - ${guestName} (Room ${roomNumber})`,
            details: `Room ${roomNumber} - Guest: ${guestName}`,
            performedBy: performedBy || undefined,
            entityData: {
              bookingId: booking.id,
              roomNumber: roomNumber,
              guestName: guestName,
              actualCheckIn: booking.actualCheckIn,
              scheduledCheckIn: booking.dates?.checkIn || booking.checkIn
            }
          })
        }

        // Check-out activity
        if (booking.actualCheckOut) {
          allActivities.push({
            id: `checkout-${booking.id}`,
            type: 'checkout' as const,
            timestamp: booking.actualCheckOut,
            title: `Guest checked out - ${guestName} (Room ${roomNumber})`,
            details: `Room ${roomNumber} - Guest: ${guestName}`,
            performedBy: performedBy || undefined,
            entityData: {
              bookingId: booking.id,
              roomNumber: roomNumber,
              guestName: guestName,
              actualCheckOut: booking.actualCheckOut,
              scheduledCheckOut: booking.dates?.checkOut || booking.checkOut
            }
          })
        }

        // Payment activity
        if (booking.payment?.status === 'completed' && booking.payment?.paidAt) {
          allActivities.push({
            id: `payment-${booking.id}`,
            type: 'payment' as const,
            timestamp: booking.payment.paidAt,
            title: `Payment received - ${guestName} ($${booking.payment.amount})`,
            details: `${booking.payment.method.toUpperCase()} - $${booking.payment.amount}`,
            performedBy: performedBy || undefined,
            entityData: {
              bookingId: booking.id,
              paymentMethod: booking.payment.method,
              amount: booking.payment.amount,
              status: booking.payment.status as 'pending' | 'failed' | 'completed',
              reference: booking.payment.reference,
              paidAt: booking.payment.paidAt
            }
          })
        }
      }

      // Guest activities
      for (const guest of guestsData) {
        const performedBy = getStaffInfoFromMap(guest.userId || guest.createdBy, staffMap)
        
        allActivities.push({
          id: `guest-${guest.id}`,
          type: 'guest' as const,
          timestamp: guest.createdAt || new Date().toISOString(),
          title: `Guest profile created - ${guest.name}`,
          details: `${guest.name} - ${guest.email}`,
          performedBy: performedBy || undefined,
          entityData: {
            guestId: guest.id,
            name: guest.name,
            email: guest.email,
            phone: guest.phone,
            address: guest.address,
            createdAt: guest.createdAt,
            updatedAt: guest.updatedAt
          }
        })
      }

      // Invoice activities
      for (const invoice of invoicesData) {
        const performedBy = getStaffInfoFromMap(invoice.createdBy, staffMap)
        
        allActivities.push({
          id: `invoice-${invoice.id}`,
          type: 'invoice' as const,
          timestamp: invoice.createdAt || new Date().toISOString(),
          title: `Invoice generated - ${invoice.guestName} ($${invoice.totalAmount})`,
          details: `Amount: $${invoice.totalAmount} - Status: ${invoice.status}`,
          performedBy: performedBy || undefined,
          entityData: {
            invoiceId: invoice.id,
            totalAmount: invoice.totalAmount,
            status: invoice.status,
            guestName: invoice.guestName,
            guestEmail: invoice.guestEmail,
            items: invoice.items,
            createdAt: invoice.createdAt,
            updatedAt: invoice.updatedAt
          }
        })
      }

      // Staff activities
      for (const staff of staffData) {
        const performedBy = getStaffInfoFromMap(staff.createdBy, staffMap)
        
        allActivities.push({
          id: `staff-${staff.id}`,
          type: 'staff' as const,
          timestamp: staff.createdAt || new Date().toISOString(),
          title: `Staff member added - ${staff.name} (${staff.role})`,
          details: `${staff.name} - Role: ${staff.role}`,
          performedBy: performedBy || undefined,
          entityData: {
            staffId: staff.id,
            name: staff.name,
            email: staff.email,
            role: staff.role,
            phone: staff.phone,
            createdAt: staff.createdAt,
            updatedAt: staff.updatedAt
          }
        })
      }

      // Process activity logs
      for (const log of activityLogsData) {
        const performedBy = getStaffInfoFromMap(log.userId, staffMap)
        
        // Map log.action to ActivityType
        let type: ActivityType = 'contact'
        if (log.action === 'deleted') type = 'booking_deletion'
        else if (log.action === 'cancelled') type = 'cancellation'
        else if (log.action === 'login') type = 'user_login'
        else if (log.action === 'logout') type = 'user_logout'
        else if (log.action === 'checked_in') type = 'checkin'
        else if (log.action === 'checked_out') type = 'checkout'
        else if (log.action === 'payment_received') type = 'payment'

        // Create a readable title and details
        let title = `${log.action.replace('_', ' ')}: ${log.entityType}`
        let details = `Entity ID: ${log.entityId}`

        if (log.action === 'deleted' && log.entityType === 'booking') {
          title = `Booking Deleted: ${log.details?.guestName || 'Unknown'}`
          details = `Room ${log.details?.roomNumber || 'N/A'} - Amount: $${log.details?.amount || 'N/A'}`
        } else if (log.action === 'login') {
          title = `User Login: ${log.details?.email || performedBy?.name || 'System'}`
          details = `Role: ${log.details?.role || 'User'}`
        }

        allActivities.push({
          id: `activity-${log.id}`,
          type,
          timestamp: log.createdAt,
          title,
          details,
          performedBy: performedBy || undefined,
          entityData: log.details
        })
      }

      const sortedActivities = allActivities.sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      )

      setActivities(sortedActivities)
    } catch (error) {
      console.error('Failed to fetch activities:', error)
      setActivities([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchActivities()
  }, [fetchActivities, bookingsUpdate, guestsUpdate, invoicesUpdate, staffUpdate, contactUpdate])

  // Filter activities
  const filteredActivities = activities.filter(activity => {
    const activityDate = safeParseISO(activity.timestamp)
    if (!activityDate) return false

    // Date range filter
    if (from && new Date(from) > activityDate) return false
    if (to && new Date(to) < activityDate) return false
    
    // Search filter
    if (query && !activity.title.toLowerCase().includes(query.toLowerCase()) && 
        !activity.details.toLowerCase().includes(query.toLowerCase())) {
      return false
    }
    
    // Today filter
    if (filter === 'today' && !isToday(activityDate)) return false
    
    return true
  })

  // Group activities by date
  const groupedActivities: Record<string, Activity[]> = {}
  filteredActivities.forEach(activity => {
    const date = safeFormatDate(activity.timestamp, 'yyyy-MM-dd', 'unknown')
    if (!groupedActivities[date]) {
      groupedActivities[date] = []
    }
    groupedActivities[date].push(activity)
  })

  const handleReset = () => {
    // Reset all filter states
    setFrom('')
    setTo('')
    setQuery('')
    setFilter('all')
    
    // Clear any input field values
    const fromInput = document.querySelector('input[type="date"]:first-of-type') as HTMLInputElement
    const toInput = document.querySelector('input[type="date"]:last-of-type') as HTMLInputElement
    const searchInput = document.querySelector('input[placeholder="Search"]') as HTMLInputElement
    
    if (fromInput) fromInput.value = ''
    if (toInput) toInput.value = ''
    if (searchInput) searchInput.value = ''
    
    // Show success notification
    toast.success('Filters reset successfully', {
      description: 'All date ranges, search terms, and filters have been cleared.'
    })
    
    console.log('🔄 Reset button clicked - all filters cleared')
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-serif font-bold">History</h2>
        <p className="text-muted-foreground mt-1">Monitor the change history in the application. Use filters to find what you need.</p>
      </div>

      <div className="flex items-center gap-2 mb-4">
        <Button 
          variant="link" 
          onClick={handleReset}
          className="text-blue-600 hover:text-blue-700 p-0 h-auto font-medium transition-colors duration-200"
        >
          Reset
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="flex gap-2">
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <Input placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select className="w-full px-3 py-2 border rounded-md">
          <option>Everyone</option>
        </select>
      </div>

      <div>
        <Button 
          variant={filter === 'today' ? 'default' : 'outline'}
          onClick={() => setFilter(filter === 'today' ? 'all' : 'today')}
          className={filter === 'today' ? 'bg-blue-600 hover:bg-blue-700' : ''}
        >
          Today
        </Button>
      </div>

      {loading ? (
        <Card>
          <CardContent className="py-12 flex justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </CardContent>
        </Card>
      ) : filteredActivities.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No activities found. Try adjusting your filters.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-8">
          {Object.entries(groupedActivities).map(([date, dateActivities]) => (
            <div key={date} className="space-y-4">
              <div className="inline-block bg-blue-600 text-white px-4 py-2 rounded-full text-sm font-medium">
                {(() => {
                  const d = safeParseISO(date)
                  return d && isToday(d) ? 'Today' : (d ? format(d, 'yyyy-MM-dd') : date)
                })()}
              </div>
              
              <div className="space-y-4 pl-4 border-l-2 border-gray-200">
                {dateActivities.map((activity) => (
                  <div key={activity.id} className="flex gap-4">
                    <div className="flex-shrink-0 w-10 h-10 rounded-full bg-gray-300 flex items-center justify-center -ml-6">
                      {activity.type === 'booking' && <CalendarPlus className="h-5 w-5 text-gray-600" />}
                      {activity.type === 'guest' && <UserPlus className="h-5 w-5 text-gray-600" />}
                      {activity.type === 'invoice' && <FileText className="h-5 w-5 text-gray-600" />}
                      {activity.type === 'staff' && <Users className="h-5 w-5 text-gray-600" />}
                      {activity.type === 'contact' && <Mail className="h-5 w-5 text-gray-600" />}
                      {activity.type === 'checkin' && <CheckCircle className="h-5 w-5 text-green-600" />}
                      {activity.type === 'checkout' && <XCircle className="h-5 w-5 text-red-600" />}
                      {activity.type === 'payment' && <CreditCard className="h-5 w-5 text-blue-600" />}
                    </div>
                    <div className="flex-1 pb-4">
                      <div className="font-medium">{activity.title}</div>
                      <div className="text-sm text-muted-foreground flex items-center gap-2 mt-1">
                        <span>{safeFormatDate(activity.timestamp, 'HH:mm', '')}</span>
                        <span>•</span>
                        <button className="text-blue-600 hover:underline" onClick={() => handleOpenDetails(activity)}>Details</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      <ActivityDetailsSheet open={detailsOpen} onOpenChange={setDetailsOpen} activity={selectedActivity} />
    </div>
  )
}

export default ReservationHistoryPage
