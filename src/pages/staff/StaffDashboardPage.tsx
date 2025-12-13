import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { blink } from '@/blink/client'
import { Booking, Room } from '@/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Calendar, DollarSign, Users, Bed, LogOut, AlertTriangle } from 'lucide-react'
import { format, isToday, parseISO } from 'date-fns'
import { formatCurrencySync } from '@/lib/utils'
import { useCurrency } from '@/hooks/use-currency'
import { StaffSidebar } from '@/components/layout/StaffSidebar'
import { bookingEngine } from '@/services/booking-engine'

export function StaffDashboardPage() {
  const db = (blink.db as any)
  const { currency } = useCurrency()
  const navigate = useNavigate()
  const [user, setUser] = useState<any>(null)
  const [bookings, setBookings] = useState<Booking[]>([])
  const [rooms, setRooms] = useState<Room[]>([])
  const [loading, setLoading] = useState(true)
  const [conflicts, setConflicts] = useState(0)

  useEffect(() => {
    const unsubscribe = blink.auth.onAuthStateChanged((state) => {
      setUser(state.user)
      if (!state.user && !state.isLoading) {
        navigate('/staff')
      }
    })
    return unsubscribe
  }, [navigate])

  useEffect(() => {
    if (user) {
      loadData()
    }
  }, [user])

  const loadData = async () => {
    try {
      const [bookingsData, roomsData] = await Promise.all([
        db.bookings.list({ orderBy: { createdAt: 'desc' }, limit: 100 }),
        db.rooms.list({ orderBy: { createdAt: 'desc' }, limit: 200 })
      ])
      setBookings(bookingsData)
      setRooms(roomsData)
      const conflictsList = await bookingEngine.getConflictedBookings()
      setConflicts(conflictsList.length)
    } catch (error) {
      console.error('Failed to load data:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleLogout = async () => {
    await blink.auth.logout()
    navigate('/staff')
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Loading dashboard...</p>
        </div>
      </div>
    )
  }

  const todayCheckIns = bookings.filter((b) => isToday(parseISO(b.checkIn)))
  const todayCheckOuts = bookings.filter((b) => isToday(parseISO(b.checkOut)))
  const occupiedRooms = rooms.filter((r) => r.status === 'occupied').length
  const occupancyRate = rooms.length > 0 ? ((occupiedRooms / rooms.length) * 100).toFixed(1) : '0.0'
  const todayRevenue = bookings
    .filter((b) => isToday(parseISO(b.checkIn)))
    .reduce((sum, b) => sum + b.totalPrice, 0)

  return (
    <div className="flex h-screen bg-secondary/30">
      <StaffSidebar email={user?.email} />
      <div className="flex-1 h-screen flex flex-col overflow-hidden">
        {/* Header */}
        <header className="bg-background border-b">
          <div className="px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <div className="w-10 h-10 bg-primary rounded-lg flex items-center justify-center">
                  <span className="text-xl font-serif font-bold text-primary-foreground">AL</span>
                </div>
                <div>
                  <h1 className="text-2xl font-serif font-bold">Staff Dashboard</h1>
                  <p className="text-sm text-muted-foreground">Welcome back, {user?.email}</p>
                </div>
              </div>
              <Button variant="outline" onClick={handleLogout}>
                <LogOut className="w-4 h-4 mr-2" />
                Logout
              </Button>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto px-6 py-8">
          {/* Stats Grid */}
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">Today's Check-ins</CardTitle>
                <Calendar className="w-4 h-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{todayCheckIns.length}</div>
                <p className="text-xs text-muted-foreground mt-1">Arriving today</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">Today's Check-outs</CardTitle>
                <Calendar className="w-4 h-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{todayCheckOuts.length}</div>
                <p className="text-xs text-muted-foreground mt-1">Departing today</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">Occupancy Rate</CardTitle>
                <Bed className="w-4 h-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{occupancyRate}%</div>
                <p className="text-xs text-muted-foreground mt-1">
                  {occupiedRooms}/{rooms.length} rooms occupied
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">Today's Revenue</CardTitle>
                <DollarSign className="w-4 h-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{formatCurrencySync(todayRevenue, currency)}</div>
                <p className="text-xs text-muted-foreground mt-1">From {todayCheckIns.length} bookings</p>
              </CardContent>
            </Card>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">Conflicts Detected</CardTitle>
                <AlertTriangle className="w-4 h-4 text-amber-500" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{conflicts}</div>
                <div className="flex items-center justify-between mt-1">
                  <p className="text-xs text-muted-foreground">Overlapping bookings</p>
                  <Button variant="outline" size="sm" onClick={() => navigate('/staff/reservations')}>Review</Button>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Quick Actions */}
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            <Button
              size="lg"
              className="h-24 text-lg bg-gradient-to-br from-primary to-accent hover:from-primary/90 hover:to-accent/90"
              onClick={() => navigate('/staff/onsite-booking')}
            >
              <Calendar className="w-6 h-6 mr-2" />
              Walk-in Booking
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="h-24 text-lg"
              onClick={() => navigate('/staff/reservations')}
            >
              <Users className="w-6 h-6 mr-2" />
              View Reservations
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="h-24 text-lg"
              onClick={() => navigate('/staff/admin')}
            >
              <Bed className="w-6 h-6 mr-2" />
              Manage Rooms
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="h-24 text-lg"
              onClick={() => navigate('/staff/admin')}
            >
              <Users className="w-6 h-6 mr-2" />
              Guest Management
            </Button>
          </div>

          {/* Recent Bookings */}
          <Card>
            <CardHeader>
              <CardTitle>Recent Bookings</CardTitle>
            </CardHeader>
            <CardContent>
              {bookings.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">No bookings yet</p>
              ) : (
                <div className="space-y-4">
                  {bookings.slice(0, 5).map((booking) => (
                    <div
                      key={booking.id}
                      className="flex items-center justify-between p-4 border rounded-lg"
                    >
                      <div>
                        <p className="font-medium">Booking #{booking.id.slice(-8)}</p>
                        <p className="text-sm text-muted-foreground">
                          {format(parseISO(booking.checkIn), 'MMM dd')} -{' '}
                          {format(parseISO(booking.checkOut), 'MMM dd, yyyy')}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold">{formatCurrencySync(booking.totalPrice, currency)}</p>
                        <span
                          className={`text-xs px-2 py-1 rounded-full ${
                            booking.status === 'confirmed'
                              ? 'bg-green-100 text-green-800'
                              : 'bg-yellow-100 text-yellow-800'
                          }`}
                        >
                          {booking.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </main>
      </div>
    </div>
  )
}

export default StaffDashboardPage