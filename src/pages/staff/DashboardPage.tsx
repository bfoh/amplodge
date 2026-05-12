import { useEffect, useState } from 'react'
import { Building2, Calendar, Users, DollarSign, TrendingUp, Clock, BarChart2, Home } from 'lucide-react'
import { db, auth } from '@/lib/db'
import { bookingEngine } from '../../services/booking-engine'
import { format, parseISO } from 'date-fns'
import { formatCurrencySync, cn } from '../../lib/utils'
import { useCurrency } from '../../hooks/use-currency'
import { useSubscription } from '../../hooks/use-subscription'

interface Stats {
  totalRooms: number
  totalProperties: number
  activeBookings: number
  totalGuests: number
  revenue: number
  occupancyRate: number
  avgNightlyRate: number
  todayCheckIns: number
  todayCheckOuts: number
  availableRooms: number
  availableDetails: { name: string; count: number }[]
}
export function DashboardPage() {
  const { currency } = useCurrency()
  const bookingsUpdate = useSubscription('bookings')
  const propertiesUpdate = useSubscription('properties')
  
  const [stats, setStats] = useState<Stats>({
    totalRooms: 0,
    totalProperties: 0,
    activeBookings: 0,
    totalGuests: 0,
    revenue: 0,
    occupancyRate: 0,
    avgNightlyRate: 0,
    todayCheckIns: 0,
    todayCheckOuts: 0,
    availableRooms: 0,
    availableDetails: []
  })
  const [recentBookings, setRecentBookings] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  const loadDashboardData = async () => {
    try {
      // Fetch data - load ALL properties (project-scoped, no user filtering needed)
      const [allBookings, properties, guests, roomTypes] = await Promise.all([
        bookingEngine.getAllBookings(),
        db.properties.list(),
        db.guests.list(),
        (db as any).roomTypes.list()
      ])

      const todayIso = new Date().toISOString().split('T')[0]

      const normalize = (s: string) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim()
      const roomTypesData = roomTypes as any[]

      // 1. Group Total Rooms by Type
      const totalByType: Record<string, number> = {}
      // Map propertyId -> TypeName
      const propertyTypeMap: Record<string, string> = {}

      properties.forEach((p: any) => {
        // Resolve type name
        const matchingType = roomTypesData.find(rt => rt.id === p.propertyTypeId) ||
          roomTypesData.find(rt => normalize(rt.name) === normalize(p.propertyType))
        const typeName = matchingType ? matchingType.name : (p.propertyType || 'Other')

        // Count totals (excluding maintenance)
        if (p.status !== 'maintenance') {
          totalByType[typeName] = (totalByType[typeName] || 0) + 1
        }

        propertyTypeMap[p.roomNumber] = typeName
      })

      // 2. Count Occupied Rooms by Type (Today)
      const occupiedByType: Record<string, number> = {}

      const bookingsActiveToday = allBookings.filter((b: any) => {
        const checkIn = (b.dates.checkIn || b.checkIn || '').split('T')[0]
        const checkOut = (b.dates?.checkOut || b.checkOut || '').split('T')[0]
        const isActiveStatus = b.status === 'confirmed' || b.status === 'checked-in' || b.status === 'reserved'

        if (isActiveStatus && checkIn <= todayIso && checkOut > todayIso) {
          // Find room type for this booking
          let typeName = 'Other'
          // Try to find via property map using roomNumber
          if (b.roomNumber && propertyTypeMap[b.roomNumber]) {
            typeName = propertyTypeMap[b.roomNumber]
          }
          // Fallback: use booking's roomType if valid
          else if (b.roomType) {
            const match = roomTypesData.find(rt => rt.id === b.roomType || normalize(rt.name) === normalize(b.roomType))
            typeName = match ? match.name : b.roomType
          }

          occupiedByType[typeName] = (occupiedByType[typeName] || 0) + 1
          return true
        }
        return false
      })

      // 3. Compute Availability Breakdown
      const availableDetails = Object.keys(totalByType).map(typeName => {
        const total = totalByType[typeName]
        const occupied = occupiedByType[typeName] || 0
        return {
          name: typeName,
          count: Math.max(0, total - occupied)
        }
      }).sort((a, b) => b.count - a.count)

      const activeBookings = allBookings.filter((b: any) =>
        b.dates.checkOut >= todayIso &&
        (b.status === 'confirmed' || b.status === 'checked-in' || b.status === 'reserved')
      )

      // Calculate today's check-ins and check-outs
      const todayCheckIns = allBookings.filter((b: any) =>
        b.dates.checkIn === todayIso &&
        (b.status === 'confirmed' || b.status === 'reserved')
      )

      const todayCheckOuts = allBookings.filter((b: any) =>
        b.dates.checkOut === todayIso &&
        (b.status === 'confirmed' || b.status === 'checked-in')
      )

      // Calculate total revenue from all confirmed bookings
      const confirmedBookings = allBookings.filter((b: any) =>
        b.status === 'confirmed' || b.status === 'checked-in' || b.status === 'checked-out'
      )
      const totalRevenue = confirmedBookings.reduce((sum: number, b: any) =>
        sum + (Number(b.totalPrice) || 0), 0
      )

      // Compute avg nightly rate by total revenue / total nights across all bookings
      const totalNights = confirmedBookings.reduce((sum: number, b: any) => {
        const inD = new Date(b.dates.checkIn)
        const outD = new Date(b.dates.checkOut)
        const ms = Math.max(0, outD.getTime() - inD.getTime())
        const nights = Math.max(1, Math.round(ms / (1000 * 60 * 60 * 24)))
        return sum + nights
      }, 0)
      const avgRate = totalNights > 0 ? totalRevenue / totalNights : 0

      // Calculate total rooms using only Staff Rooms (properties)
      const propertyRoomNumbers = new Set(
        properties.map((p: any) => String(p.roomNumber || '').trim()).filter(Boolean)
      )
      const totalAvailableRooms = propertyRoomNumbers.size

      // Use bookingsActiveToday for current occupancy (rooms occupied specifically today)
      const occupiedRooms = bookingsActiveToday.length
      const occupancyRate = totalAvailableRooms > 0
        ? Math.round((occupiedRooms / totalAvailableRooms) * 100)
        : 0

      const availableRooms = availableDetails.reduce((sum, detail) => sum + detail.count, 0)

      // Map recent bookings with guest names and room details
      // Build maps for resolving actual room type names
      const roomTypeMap = new Map<string, string>(
        (roomTypes as any[]).map((rt: any) => [rt.id, rt.name])
      )
      // Prefer Rooms page (properties) as source of truth for room -> roomType
      const propertyTypeByRoomNumber = new Map<string, string>(
        (properties as any[])
          .filter((p: any) => !!p.roomNumber)
          .map((p: any) => [p.roomNumber, p.propertyTypeId])
      )

      const recent = (allBookings as any[])
        .sort((a: any, b: any) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        )
        .slice(0, 5)
        .map((b: any) => {
          // Resolve room type name with robust order:
          // 1) properties.roomNumber -> propertyTypeId -> roomTypes
          // 2) rooms.roomNumber -> roomTypeId -> roomTypes
          // 3) if booking.roomType stores an ID, map via roomTypes
          // 4) fallback to booking.roomType string
          const typeIdFromProperty = propertyTypeByRoomNumber.get(b.roomNumber)
          let roomTypeName = ''
          if (typeIdFromProperty) {
            roomTypeName = roomTypeMap.get(typeIdFromProperty) || ''
          } else if (roomTypeMap.has(b.roomType)) {
            roomTypeName = roomTypeMap.get(b.roomType) || ''
          } else {
            roomTypeName = b.roomType || ''
          }

          return {
            ...b,
            id: b._id,
            guestName: b.guest.fullName,
            roomTypeName,
            checkIn: b.dates.checkIn,
            checkOut: b.dates.checkOut,
            totalPrice: b.amount
          }
        })

      setStats({
        totalRooms: totalAvailableRooms,
        totalProperties: properties.length,
        activeBookings: activeBookings.length,
        totalGuests: guests.length,
        revenue: totalRevenue,
        occupancyRate,
        avgNightlyRate: avgRate || 0,
        todayCheckIns: todayCheckIns.length,
        todayCheckOuts: todayCheckOuts.length,
        availableRooms,
        availableDetails
      })

      setRecentBookings(recent)
    } catch (error) {
      console.error('Failed to load dashboard:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadDashboardData()
  }, [bookingsUpdate, propertiesUpdate])

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-3">
        <div className="w-10 h-10 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
        <p className="text-sm text-muted-foreground animate-pulse">Loading dashboard...</p>
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Stats Grid - Premium Mobile Optimized */}
      <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-6">

        {/* Available Rooms — blue */}
        <div className="relative overflow-hidden rounded-xl border bg-white p-4 sm:p-5 shadow-sm active:scale-[0.98] transition-all">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 via-transparent to-transparent pointer-events-none" />
          <div className="absolute top-0 left-0 w-full h-1 bg-blue-500" />
          <div className="flex items-center justify-between mb-3">
            <div className="p-2 rounded-lg bg-blue-50">
              <Building2 className="w-4 h-4 text-blue-600" />
            </div>
            <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded uppercase tracking-tighter">Live</span>
          </div>
          <div className="space-y-0.5">
            <p className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground">Available Rooms</p>
            <div className="text-2xl font-bold text-stone-800 tabular-nums">{stats.availableRooms}</div>
          </div>
          <div className="mt-3 pt-3 border-t border-stone-50 space-y-1">
            {stats.availableDetails.slice(0, 2).map((detail, i) => (
              <div key={i} className="flex justify-between text-[10px] text-muted-foreground">
                <span className="truncate max-w-[80px]">{detail.name}</span>
                <span className="font-bold text-stone-600">{detail.count}</span>
              </div>
            ))}
            {stats.availableDetails.length > 2 && (
              <p className="text-[9px] text-primary font-medium">+ {stats.availableDetails.length - 2} more types</p>
            )}
            {stats.availableDetails.length === 0 && (
              <p className="text-[10px] text-rose-500 font-bold uppercase tracking-tighter">Fully Occupied</p>
            )}
          </div>
        </div>

        {/* Today's Activity — orange */}
        <div className="relative overflow-hidden rounded-xl border bg-white p-4 sm:p-5 shadow-sm active:scale-[0.98] transition-all">
          <div className="absolute inset-0 bg-gradient-to-br from-orange-500/5 via-transparent to-transparent pointer-events-none" />
          <div className="absolute top-0 left-0 w-full h-1 bg-orange-500" />
          <div className="flex items-center justify-between mb-3">
            <div className="p-2 rounded-lg bg-orange-50">
              <Clock className="w-4 h-4 text-orange-600" />
            </div>
            <span className="text-[10px] font-bold text-orange-600 bg-orange-50 px-1.5 py-0.5 rounded uppercase tracking-tighter">Today</span>
          </div>
          <p className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground mb-2">Activity Summary</p>
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-emerald-50/50 rounded-lg p-2 border border-emerald-100/50">
              <p className="text-[10px] font-bold text-emerald-700 uppercase tracking-tighter">In</p>
              <p className="text-lg font-bold text-emerald-600 tabular-nums">{stats.todayCheckIns}</p>
            </div>
            <div className="bg-orange-50/50 rounded-lg p-2 border border-orange-100/50">
              <p className="text-[10px] font-bold text-orange-700 uppercase tracking-tighter">Out</p>
              <p className="text-lg font-bold text-orange-600 tabular-nums">{stats.todayCheckOuts}</p>
            </div>
          </div>
        </div>

        {/* Occupancy Rate — indigo */}
        <div className="relative overflow-hidden rounded-xl border bg-white p-4 sm:p-5 shadow-sm active:scale-[0.98] transition-all">
          <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/5 via-transparent to-transparent pointer-events-none" />
          <div className="absolute top-0 left-0 w-full h-1 bg-indigo-500" />
          <div className="flex items-center justify-between mb-3">
            <div className="p-2 rounded-lg bg-indigo-50">
              <BarChart2 className="w-4 h-4 text-indigo-600" />
            </div>
          </div>
          <div className="space-y-0.5">
            <p className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground">Occupancy Rate</p>
            <div className="text-2xl font-bold text-stone-800 tabular-nums">{stats.occupancyRate}%</div>
          </div>
          <div className="mt-4 h-1.5 w-full bg-stone-100 rounded-full overflow-hidden">
             <div 
               className="h-full bg-indigo-500 transition-all duration-1000" 
               style={{ width: `${stats.occupancyRate}%` }} 
             />
          </div>
          <p className="text-[9px] text-muted-foreground mt-2 font-medium uppercase tracking-tight">
            {stats.totalRooms - stats.availableRooms} / {stats.totalRooms} Rooms Booked
          </p>
        </div>

        {/* Total Revenue — green */}
        <div className="relative overflow-hidden rounded-xl border bg-white p-4 sm:p-5 shadow-sm active:scale-[0.98] transition-all">
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 via-transparent to-transparent pointer-events-none" />
          <div className="absolute top-0 left-0 w-full h-1 bg-emerald-500" />
          <div className="flex items-center justify-between mb-3">
            <div className="p-2 rounded-lg bg-emerald-50">
              <DollarSign className="w-4 h-4 text-emerald-600" />
            </div>
          </div>
          <div className="space-y-0.5">
            <p className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground">Total Revenue</p>
            <div className="text-xl sm:text-2xl font-bold text-stone-800 tabular-nums truncate">
              {formatCurrencySync(stats.revenue, currency)}
            </div>
          </div>
          <p className="text-[10px] text-emerald-600 mt-2 font-bold flex items-center gap-1">
            <TrendingUp className="w-3 h-3" />
            All-time metrics
          </p>
        </div>

      </div>

      {/* Recent Bookings */}
      <div className="relative overflow-hidden rounded-xl border bg-card shadow-sm">
        <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-primary/60 to-primary/20" />
        <div className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-base">Recent Bookings</h3>
            <span className="text-xs text-muted-foreground">{recentBookings.length} recent</span>
          </div>
          {recentBookings.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <div className="w-14 h-14 rounded-2xl bg-stone-50 flex items-center justify-center mx-auto mb-3">
                <Calendar className="w-7 h-7 opacity-30 text-stone-400" />
              </div>
              <p className="font-bold text-stone-400 uppercase tracking-widest text-[10px]">No bookings yet</p>
            </div>
          ) : (
            <div className="space-y-3">
              {recentBookings.map((booking: any) => {
                const statusStyles = {
                  confirmed: 'bg-emerald-50 text-emerald-700 ring-emerald-100 border-l-emerald-500',
                  'checked-in': 'bg-blue-50 text-blue-700 ring-blue-100 border-l-blue-500',
                  'checked-out': 'bg-stone-50 text-stone-700 ring-stone-100 border-l-stone-400',
                  cancelled: 'bg-red-50 text-red-700 ring-red-100 border-l-red-500',
                  reserved: 'bg-amber-50 text-amber-700 ring-amber-100 border-l-amber-500'
                }
                const style = statusStyles[booking.status as keyof typeof statusStyles] || statusStyles['checked-out']

                return (
                  <div
                    key={booking.id}
                    className={`flex items-center justify-between p-4 rounded-xl border border-l-4 ${style} active:scale-[0.99] transition-all bg-white shadow-sm`}
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-bold text-sm text-stone-800">{booking.guestName}</p>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-tighter ring-1 ${style}`}>
                          {booking.status}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-[11px] text-muted-foreground font-medium">
                        <div className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          <span>{format(parseISO(booking.checkIn), 'MMM dd')} - {format(parseISO(booking.checkOut), 'MMM dd')}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Home className="w-3 h-3" />
                          <span>Room {booking.roomNumber}</span>
                        </div>
                      </div>
                      {booking.roomTypeName && (
                        <p className="text-[10px] text-primary font-bold uppercase tracking-widest">{booking.roomTypeName}</p>
                      )}
                    </div>
                    <div className="text-right shrink-0 ml-4">
                      <p className="font-bold text-stone-900 text-sm tabular-nums">
                        {formatCurrencySync(Number(booking.totalPrice), currency)}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
