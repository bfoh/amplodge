import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card'
import { Building2, Calendar, Users, DollarSign, TrendingUp, Clock } from 'lucide-react'
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
      <div className="flex items-center justify-center h-96">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <Card className="hover:shadow-lg transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Available Rooms</CardTitle>
            <Building2 className="h-5 w-5 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.availableRooms}</div>
            <div className="text-xs text-muted-foreground mt-2 space-y-1">
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
          </CardContent>
        </Card>

        <Card className="hover:shadow-lg transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Bookings</CardTitle>
            <Calendar className="h-5 w-5 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-accent">{stats.activeBookings}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Currently active
            </p>
          </CardContent>
        </Card>

        <Card className="hover:shadow-lg transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Guests</CardTitle>
            <Users className="h-5 w-5 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{stats.totalGuests}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Guest database
            </p>
          </CardContent>
        </Card>


        <Card className="hover:shadow-lg transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
            <DollarSign className="h-5 w-5 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-600">
              {formatCurrencySync(stats.revenue, currency)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              All-time revenue
            </p>
          </CardContent>
        </Card>

        <Card className="hover:shadow-lg transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Nightly Rate</CardTitle>
            <TrendingUp className="h-5 w-5 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              {formatCurrencySync(stats.avgNightlyRate, currency)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Average per night
            </p>
          </CardContent>
        </Card>

        <Card className="hover:shadow-lg transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Occupancy Rate</CardTitle>
            <Clock className="h-5 w-5 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{stats.occupancyRate}%</div>
            <p className="text-xs text-muted-foreground mt-1">
              Current occupancy
            </p>
          </CardContent>
        </Card>

        <Card className="hover:shadow-lg transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Today's Activity</CardTitle>
            <Calendar className="h-5 w-5 text-muted-foreground" />
          </CardHeader>
          <CardContent>
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
          </CardContent>
        </Card>
      </div>

      {/* Recent Bookings */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Bookings</CardTitle>
        </CardHeader>
        <CardContent>
          {recentBookings.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Calendar className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>No bookings yet</p>
              <p className="text-sm mt-1">Create your first booking to get started</p>
            </div>
          ) : (
            <div className="space-y-3">
              {recentBookings.map((booking: any) => (
                <div
                  key={booking.id}
                  className="flex items-center justify-between p-4 rounded-lg border hover:bg-accent/50 transition-colors"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <p className="font-medium">{booking.guestName}</p>
                      {booking.roomTypeName && (
                        <span className="text-xs px-2 py-0.5 bg-primary/10 text-primary rounded">
                          {booking.roomTypeName}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {new Date(booking.checkIn).toLocaleDateString()} - {new Date(booking.checkOut).toLocaleDateString()}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Room {booking.roomNumber}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-primary">{formatCurrencySync(Number(booking.totalPrice), currency)}</p>
                    <p className="text-xs text-muted-foreground capitalize">{booking.status}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
