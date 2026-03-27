import { useEffect, useState } from 'react'
import { Building2, Calendar, Users, DollarSign, TrendingUp, Clock, BarChart2 } from 'lucide-react'
import { blink } from '../../blink/client'
import { bookingEngine } from '../../services/booking-engine'
import { formatCurrencySync } from '../../lib/utils'
import { useCurrency } from '../../hooks/use-currency'

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

  useEffect(() => {
    loadDashboardData()

    // Set up polling for real-time updates every 30 seconds
    const interval = setInterval(() => {
      loadDashboardData()
    }, 30000)

    return () => clearInterval(interval)
  }, [])

  const loadDashboardData = async () => {
    try {
      // Fetch data - load ALL properties (project-scoped, no user filtering needed)
      const [allBookings, properties, guests, roomTypes] = await Promise.all([
        bookingEngine.getAllBookings(),
        blink.db.properties.list(),
        blink.db.guests.list(),
        (blink.db as any).roomTypes.list()
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

      // 3. Calculate Available by Type
      const availableDetails = Object.keys(totalByType).map(name => ({
        name,
        count: Math.max(0, totalByType[name] - (occupiedByType[name] || 0))
      })).filter(d => d.count > 0).sort((a, b) => a.name.localeCompare(b.name))


      // Calculate active bookings (current and future confirmed bookings)
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
      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">

        {/* Available Rooms — blue */}
        <div className="relative overflow-hidden rounded-xl border bg-card p-5 shadow-sm hover:shadow-md transition-shadow">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 via-transparent to-transparent pointer-events-none" />
          <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-blue-400 to-blue-600" />
          <div className="flex items-start justify-between mb-3">
            <p className="text-sm font-medium text-muted-foreground">Available Rooms</p>
            <div className="p-2 rounded-lg bg-blue-500/10">
              <Building2 className="w-4 h-4 text-blue-600" />
            </div>
          </div>
          <div className="text-2xl font-bold">{stats.availableRooms}</div>
          <div className="text-xs text-muted-foreground mt-1 space-y-1">
            {stats.availableDetails.length > 0 ? (
              stats.availableDetails.map((detail, i) => (
                <div key={i} className="flex justify-between">
                  <span>{detail.name}</span>
                  <span className="font-medium">{detail.count} available</span>
                </div>
              ))
            ) : (
              <span>ALL ROOMS OCCUPIED</span>
            )}
          </div>
        </div>

        {/* Active Bookings — violet */}
        <div className="relative overflow-hidden rounded-xl border bg-card p-5 shadow-sm hover:shadow-md transition-shadow">
          <div className="absolute inset-0 bg-gradient-to-br from-violet-500/5 via-transparent to-transparent pointer-events-none" />
          <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-violet-400 to-violet-600" />
          <div className="flex items-start justify-between mb-3">
            <p className="text-sm font-medium text-muted-foreground">Active Bookings</p>
            <div className="p-2 rounded-lg bg-violet-500/10">
              <Calendar className="w-4 h-4 text-violet-600" />
            </div>
          </div>
          <div className="text-2xl font-bold">{stats.activeBookings}</div>
          <p className="text-xs text-muted-foreground mt-1">Currently active</p>
        </div>

        {/* Total Guests — emerald */}
        <div className="relative overflow-hidden rounded-xl border bg-card p-5 shadow-sm hover:shadow-md transition-shadow">
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 via-transparent to-transparent pointer-events-none" />
          <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-emerald-400 to-emerald-600" />
          <div className="flex items-start justify-between mb-3">
            <p className="text-sm font-medium text-muted-foreground">Total Guests</p>
            <div className="p-2 rounded-lg bg-emerald-500/10">
              <Users className="w-4 h-4 text-emerald-600" />
            </div>
          </div>
          <div className="text-2xl font-bold">{stats.totalGuests}</div>
          <p className="text-xs text-muted-foreground mt-1">Guest database</p>
        </div>

        {/* Total Revenue — green */}
        <div className="relative overflow-hidden rounded-xl border bg-card p-5 shadow-sm hover:shadow-md transition-shadow">
          <div className="absolute inset-0 bg-gradient-to-br from-green-500/5 via-transparent to-transparent pointer-events-none" />
          <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-green-400 to-green-600" />
          <div className="flex items-start justify-between mb-3">
            <p className="text-sm font-medium text-muted-foreground">Total Revenue</p>
            <div className="p-2 rounded-lg bg-green-500/10">
              <DollarSign className="w-4 h-4 text-green-600" />
            </div>
          </div>
          <div className="text-2xl font-bold">{formatCurrencySync(stats.revenue, currency)}</div>
          <p className="text-xs text-muted-foreground mt-1">All-time revenue</p>
        </div>

        {/* Avg Nightly Rate — amber */}
        <div className="relative overflow-hidden rounded-xl border bg-card p-5 shadow-sm hover:shadow-md transition-shadow">
          <div className="absolute inset-0 bg-gradient-to-br from-amber-500/5 via-transparent to-transparent pointer-events-none" />
          <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-amber-400 to-amber-600" />
          <div className="flex items-start justify-between mb-3">
            <p className="text-sm font-medium text-muted-foreground">Avg Nightly Rate</p>
            <div className="p-2 rounded-lg bg-amber-500/10">
              <TrendingUp className="w-4 h-4 text-amber-600" />
            </div>
          </div>
          <div className="text-2xl font-bold">{formatCurrencySync(stats.avgNightlyRate, currency)}</div>
          <p className="text-xs text-muted-foreground mt-1">Average per night</p>
        </div>

        {/* Occupancy Rate — indigo */}
        <div className="relative overflow-hidden rounded-xl border bg-card p-5 shadow-sm hover:shadow-md transition-shadow">
          <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/5 via-transparent to-transparent pointer-events-none" />
          <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-indigo-400 to-indigo-600" />
          <div className="flex items-start justify-between mb-3">
            <p className="text-sm font-medium text-muted-foreground">Occupancy Rate</p>
            <div className="p-2 rounded-lg bg-indigo-500/10">
              <BarChart2 className="w-4 h-4 text-indigo-600" />
            </div>
          </div>
          <div className="text-2xl font-bold">{stats.occupancyRate}%</div>
          <p className="text-xs text-muted-foreground mt-1">Current occupancy</p>
        </div>

        {/* Today's Activity — orange */}
        <div className="relative overflow-hidden rounded-xl border bg-card p-5 shadow-sm hover:shadow-md transition-shadow">
          <div className="absolute inset-0 bg-gradient-to-br from-orange-500/5 via-transparent to-transparent pointer-events-none" />
          <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-orange-400 to-orange-600" />
          <div className="flex items-start justify-between mb-3">
            <p className="text-sm font-medium text-muted-foreground">Today's Activity</p>
            <div className="p-2 rounded-lg bg-orange-500/10">
              <Clock className="w-4 h-4 text-orange-600" />
            </div>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-2xl font-bold text-green-600">{stats.todayCheckIns}</div>
              <p className="text-xs text-muted-foreground">Check-ins</p>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold text-orange-600">{stats.todayCheckOuts}</div>
              <p className="text-xs text-muted-foreground">Check-outs</p>
            </div>
          </div>
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
              <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center mx-auto mb-3">
                <Calendar className="w-7 h-7 opacity-50" />
              </div>
              <p className="font-medium">No bookings yet</p>
              <p className="text-sm mt-1">Create your first booking to get started</p>
            </div>
          ) : (
            <div className="space-y-2">
              {recentBookings.map((booking: any) => {
                const statusClass =
                  booking.status === 'confirmed' ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' :
                  booking.status === 'checked-in' ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-200' :
                  booking.status === 'checked-out' ? 'bg-slate-50 text-slate-700 ring-1 ring-slate-200' :
                  booking.status === 'cancelled' ? 'bg-red-50 text-red-700 ring-1 ring-red-200' :
                  'bg-slate-50 text-slate-700 ring-1 ring-slate-200'

                const accentBorder =
                  booking.status === 'confirmed' ? 'border-l-emerald-400' :
                  booking.status === 'checked-in' ? 'border-l-blue-400' :
                  booking.status === 'checked-out' ? 'border-l-slate-400' :
                  booking.status === 'cancelled' ? 'border-l-red-400' :
                  'border-l-slate-300'

                return (
                  <div
                    key={booking.id}
                    className={`flex items-center justify-between p-4 rounded-lg border border-l-4 ${accentBorder} hover:bg-accent/40 transition-colors`}
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-sm">{booking.guestName}</p>
                        {booking.roomTypeName && (
                          <span className="text-xs px-2 py-0.5 bg-primary/10 text-primary rounded-full font-medium">
                            {booking.roomTypeName}
                          </span>
                        )}
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusClass}`}>
                          {booking.status}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {new Date(booking.checkIn).toLocaleDateString()} &ndash; {new Date(booking.checkOut).toLocaleDateString()}
                      </p>
                      <p className="text-xs text-muted-foreground">Room {booking.roomNumber}</p>
                    </div>
                    <div className="text-right shrink-0 ml-4">
                      <p className="font-bold text-primary text-sm">{formatCurrencySync(Number(booking.totalPrice), currency)}</p>
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
