import { useState, useEffect } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { blink } from '@/blink/client'
import { CalendarPlus, UserPlus, Loader2, FileText, Users, Mail, CreditCard, CheckCircle, XCircle } from 'lucide-react'
import { format, parseISO, isToday } from 'date-fns'
import { toast } from 'sonner'
import { useStaffRole } from '@/hooks/use-staff-role'
import ActivityDetailsSheet, { ActivityType, ActivitySummary } from '@/features/history/ActivityDetailsSheet'

// Optimized staff info lookup function
function getStaffInfoFromMap(staffId: string, staffMap: Map<string, any>) {
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
function getStaffInfoFromEmail(email: string, staffMap: Map<string, any>) {
  if (!email) return undefined
  
  // Look for staff by email in the map
  for (const [key, staff] of staffMap.entries()) {
    if (staff.email === email) {
      return {
        id: staff.id,
        name: staff.name || 'Unknown Staff',
        role: staff.role || 'staff'
      }
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
  const { role, staffRecord: staffData, loading: staffLoading } = useStaffRole()
  
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
  useEffect(() => {
    const fetchActivities = async () => {
      try {
        setLoading(true)
        
        // Fetch all relevant data from database with reduced limits for better performance
        const db = blink.db as any
        // Fetch full guests + rooms once (cache-instant via SWR wrapper) so the
        // activity loop below can resolve names by Map lookup instead of doing
        // 2 sequential round trips per booking (50 bookings = 100 round trips
        // ~ 30 s in Ghana).
        const [bookingsData, guestsData, invoicesData, staffData, contactData, allGuestsForMap, allRoomsForMap] = await Promise.all([
          db.bookings.list({ orderBy: { createdAt: 'desc' }, limit: 50 }).catch(() => []),
          db.guests.list({ orderBy: { createdAt: 'desc' }, limit: 50 }).catch(() => []),
          db.invoices.list({ orderBy: { createdAt: 'desc' }, limit: 50 }).catch(() => []),
          db.staff.list({ orderBy: { createdAt: 'desc' }, limit: 50 }).catch(() => []),
          db.contact_messages.list({ orderBy: { createdAt: 'desc' }, limit: 50 }).catch(() => []),
          db.guests.list().catch(() => []),
          db.rooms.list().catch(() => []),
        ])
        const guestLookupMap = new Map<string, any>(allGuestsForMap.map((g: any) => [g.id, g]))
        const roomLookupMap = new Map<string, any>(allRoomsForMap.map((r: any) => [r.id, r]))

        // Fetch activity logs to show booking deletions and other activities
        const activityLogsData = await db.contact_messages.list({
          where: { status: 'activity_log' },
          orderBy: { createdAt: 'desc' },
          limit: 50
        }).catch(() => [])

        const allActivities: Activity[] = []

        // Create staff lookup map for better performance
        const staffMap = new Map()
        staffData.forEach(staff => {
          staffMap.set(staff.id, staff)
          if (staff.userId) {
            staffMap.set(staff.userId, staff)
          }
        })

        // Booking activities
        for (const booking of bookingsData) {
          const performedBy = getStaffInfoFromMap(booking.createdBy, staffMap)
          
          // Get guest and room information
          let guestName = 'Unknown Guest'
          let roomNumber = 'Unknown Room'
          
          if (booking.guestId) {
            const guest = guestLookupMap.get(booking.guestId)
            if (guest?.name) guestName = guest.name
          } else if (booking.guest?.fullName) {
            guestName = booking.guest.fullName
          }

          if (booking.roomId) {
            const room = roomLookupMap.get(booking.roomId)
            if (room) roomNumber = room.roomNumber || room.name || roomNumber
          } else if (booking.roomNumber) {
            roomNumber = booking.roomNumber
          }
          
          // Booking creation
          allActivities.push({
          id: `booking-${booking.id}`,
          type: 'booking' as const,
          timestamp: booking.createdAt || new Date().toISOString(),
            title: `Reservation created - ${guestName || 'Guest'} (Room ${roomNumber})`,
            details: `Room ${roomNumber} - Check-in: ${booking.checkIn}, Check-out: ${booking.checkOut}`,
            performedBy: performedBy || undefined,
            entityData: {
              bookingId: booking.id,
              roomNumber: roomNumber,
              roomType: booking.roomType,
              guestName: guestName,
              guestEmail: booking.guest?.email || booking.guestId,
              checkIn: booking.checkIn,
              checkOut: booking.checkOut,
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
                scheduledCheckIn: booking.checkIn
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
                scheduledCheckOut: booking.checkOut
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
                status: booking.payment.status,
                reference: booking.payment.reference,
                paidAt: booking.payment.paidAt
              }
            })
          }

          // Booking status changes (if updatedAt is different from createdAt)
          if (booking.updatedAt && booking.updatedAt !== booking.createdAt) {
            allActivities.push({
              id: `booking-update-${booking.id}`,
              type: 'booking' as const,
              timestamp: booking.updatedAt,
              title: `Booking updated - ${guestName} (Room ${roomNumber})`,
              details: `Status: ${booking.status} - Updated on ${new Date(booking.updatedAt).toLocaleString()}`,
              performedBy: performedBy || undefined,
              entityData: {
                bookingId: booking.id,
                roomNumber: roomNumber,
                guestName: guestName,
                status: booking.status,
                updatedAt: booking.updatedAt,
                previousStatus: booking.previousStatus || 'unknown'
              }
            })
          }
        }

        // Guest activities
        for (const guest of guestsData) {
          const performedBy = getStaffInfoFromMap(guest.createdBy, staffMap)
          
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

        // Contact message activities (exclude activity logs to avoid duplication)
        for (const contact of contactData) {
          // Skip if this is an activity log entry to avoid duplication
          if (contact.status === 'activity_log') {
            continue
          }
          
          // Generate unique, descriptive heading based on contact details
          let uniqueTitle = `Contact message received`
          if (contact.name) {
            uniqueTitle = `Contact message from ${contact.name}`
          } else if (contact.email) {
            uniqueTitle = `Contact message from ${contact.email}`
          } else {
            uniqueTitle = `Contact message received #${contact.id.slice(0, 7)}`
          }

          allActivities.push({
            id: `contact-${contact.id}`,
            type: 'contact' as const,
            timestamp: contact.createdAt || new Date().toISOString(),
            title: uniqueTitle,
            details: `From: ${contact.name} - ${contact.email}`,
            performedBy: undefined, // Contact messages are from external users
            entityData: {
              contactId: contact.id,
              name: contact.name,
              email: contact.email,
              phone: contact.phone,
              message: contact.message,
              createdAt: contact.createdAt,
              updatedAt: contact.updatedAt
            }
          })
        }

        // Process activity logs (including booking deletions)
        for (const activityLog of activityLogsData) {
          try {
            const messageData = JSON.parse(activityLog.message)
            
            // Process booking deletion activities
            if (messageData.action === 'deleted' && messageData.entityType === 'booking') {
              const performedBy = getStaffInfoFromEmail(activityLog.email, staffMap)
              
              allActivities.push({
                id: `activity-${activityLog.id}`,
                type: 'booking_deletion' as const,
                timestamp: activityLog.createdAt,
                title: `Booking deleted - ${messageData.details.guestName} (Room ${messageData.details.roomNumber})`,
                details: `Guest: ${messageData.details.guestName} - Room: ${messageData.details.roomNumber} - Amount: $${messageData.details.amount || 'N/A'}`,
                performedBy: performedBy || undefined,
                entityData: {
                  bookingId: messageData.entityId,
                  guestName: messageData.details.guestName,
                  roomNumber: messageData.details.roomNumber,
                  checkIn: messageData.details.checkIn,
                  checkOut: messageData.details.checkOut,
                  amount: messageData.details.amount,
                  deletedAt: messageData.details.deletedAt
                }
              })
            }
            
            // Process booking creation activities from activity logs
            if (messageData.action === 'created' && messageData.entityType === 'booking') {
              const performedBy = getStaffInfoFromEmail(activityLog.email, staffMap)
              
              allActivities.push({
                id: `activity-${activityLog.id}`,
                type: 'booking' as const,
                timestamp: activityLog.createdAt,
                title: `Booking created - ${messageData.details.guestName || 'Guest'} (Room ${messageData.details.roomNumber})`,
                details: `Guest: ${messageData.details.guestName || 'Guest'} - Room: ${messageData.details.roomNumber} - Amount: $${messageData.details.amount || 'N/A'}`,
                performedBy: performedBy || undefined,
                entityData: {
                  bookingId: messageData.entityId,
                  guestName: messageData.details.guestName,
                  roomNumber: messageData.details.roomNumber,
                  checkIn: messageData.details.checkIn,
                  checkOut: messageData.details.checkOut,
                  amount: messageData.details.amount,
                  status: messageData.details.status,
                  createdAt: messageData.details.createdAt
                }
              })
            }
            
            // Process booking update activities from activity logs
            if (messageData.action === 'updated' && messageData.entityType === 'booking') {
              const performedBy = getStaffInfoFromEmail(activityLog.email, staffMap)
              
              allActivities.push({
                id: `activity-${activityLog.id}`,
                type: 'booking' as const,
                timestamp: activityLog.createdAt,
                title: `Booking updated - ${messageData.details.guestName || 'Guest'} (Room ${messageData.details.roomNumber})`,
                details: `Guest: ${messageData.details.guestName || 'Guest'} - Room: ${messageData.details.roomNumber} - Status: ${messageData.details.status || 'Updated'}`,
                performedBy: performedBy || undefined,
                entityData: {
                  bookingId: messageData.entityId,
                  guestName: messageData.details.guestName,
                  roomNumber: messageData.details.roomNumber,
                  status: messageData.details.status,
                  changes: messageData.details.changes,
                  updatedAt: messageData.details.updatedAt
                }
              })
            }
            
            // Process login activities
            if (messageData.action === 'login' && messageData.entityType === 'user') {
              const performedBy = getStaffInfoFromEmail(activityLog.email, staffMap)
              
              allActivities.push({
                id: `activity-${activityLog.id}`,
                type: 'user_login' as const,
                timestamp: activityLog.createdAt,
                title: `User logged in - ${messageData.details.email}`,
                details: `User: ${messageData.details.email} - Role: ${messageData.details.role} - Login time: ${new Date(messageData.details.loginAt).toLocaleString()}`,
                performedBy: performedBy || undefined,
                entityData: {
                  userId: messageData.entityId,
                  email: messageData.details.email,
                  role: messageData.details.role,
                  loginAt: messageData.details.loginAt,
                  userAgent: messageData.metadata?.userAgent
                }
              })
            }
            
            // Process logout activities
            if (messageData.action === 'logout' && messageData.entityType === 'user') {
              const performedBy = getStaffInfoFromEmail(activityLog.email, staffMap)
              
              allActivities.push({
                id: `activity-${activityLog.id}`,
                type: 'user_logout' as const,
                timestamp: activityLog.createdAt,
                title: `User logged out - ${messageData.details.email || 'Unknown User'}`,
                details: `User: ${messageData.details.email || 'Unknown User'} - Logout time: ${new Date(messageData.details.logoutAt).toLocaleString()}`,
                performedBy: performedBy || undefined,
                entityData: {
                  userId: messageData.entityId,
                  email: messageData.details.email,
                  logoutAt: messageData.details.logoutAt,
                  userAgent: messageData.metadata?.userAgent
                }
              })
            }
            
            // Process payment activities from activity logs
            if (messageData.action === 'payment_received' && messageData.entityType === 'payment') {
              const performedBy = getStaffInfoFromEmail(activityLog.email, staffMap)
              
              allActivities.push({
                id: `activity-${activityLog.id}`,
                type: 'payment' as const,
                timestamp: activityLog.createdAt,
                title: `Payment received - $${messageData.details.amount} via ${messageData.details.method}`,
                details: `Amount: $${messageData.details.amount} - Method: ${messageData.details.method} - Reference: ${messageData.details.reference || 'N/A'}`,
                performedBy: performedBy || undefined,
                entityData: {
                  paymentId: messageData.entityId,
                  amount: messageData.details.amount,
                  method: messageData.details.method,
                  reference: messageData.details.reference,
                  paidAt: messageData.details.paidAt
                }
              })
            }
            
            // Process guest creation activities from activity logs
            if (messageData.action === 'created' && messageData.entityType === 'guest') {
              const performedBy = getStaffInfoFromEmail(activityLog.email, staffMap)
              
              allActivities.push({
                id: `activity-${activityLog.id}`,
                type: 'guest' as const,
                timestamp: activityLog.createdAt,
                title: `Guest profile created - ${messageData.details.name}`,
                details: `Name: ${messageData.details.name} - Email: ${messageData.details.email}`,
                performedBy: performedBy || undefined,
                entityData: {
                  guestId: messageData.entityId,
                  name: messageData.details.name,
                  email: messageData.details.email,
                  phone: messageData.details.phone,
                  createdAt: messageData.details.createdAt
                }
              })
            }
            
            // Process staff creation activities from activity logs
            if (messageData.action === 'created' && messageData.entityType === 'staff') {
              const performedBy = getStaffInfoFromEmail(activityLog.email, staffMap)
              
              allActivities.push({
                id: `activity-${activityLog.id}`,
                type: 'staff' as const,
                timestamp: activityLog.createdAt,
                title: `Staff member added - ${messageData.details.name} (${messageData.details.role})`,
                details: `Name: ${messageData.details.name} - Role: ${messageData.details.role} - Email: ${messageData.details.email}`,
                performedBy: performedBy || undefined,
                entityData: {
                  staffId: messageData.entityId,
                  name: messageData.details.name,
                  email: messageData.details.email,
                  role: messageData.details.role,
                  createdAt: messageData.details.createdAt
                }
              })
            }
          } catch (error) {
            console.error('Failed to parse activity log:', activityLog.id, error)
          }
        }

        // Sort all activities by timestamp (newest first)
        const sortedActivities = allActivities.sort(
          (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        )

        setActivities(sortedActivities)
        console.log(`📊 Loaded ${sortedActivities.length} activities from database`)
      } catch (error) {
        console.error('Failed to fetch activities:', error)
        setActivities([]) // Set empty array on error to show no mock data
      } finally {
        setLoading(false)
      }
    }

    fetchActivities()
    
    // Refresh every 30 seconds to show new activities
    const interval = setInterval(fetchActivities, 30000)
    return () => clearInterval(interval)
  }, [])

  // Filter activities
  const filteredActivities = activities.filter(activity => {
    const activityDate = parseISO(activity.timestamp)
    
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
    const date = format(parseISO(activity.timestamp), 'yyyy-MM-dd')
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
                {isToday(parseISO(date)) ? 'Today' : format(parseISO(date), 'yyyy-MM-dd')}
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
                        <span>{format(parseISO(activity.timestamp), 'HH:mm')}</span>
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
