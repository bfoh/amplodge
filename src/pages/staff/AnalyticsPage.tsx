import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  DollarSign,
  TrendingUp,
  Users,
  Calendar,
  Percent,
  Download,
  BarChart3,
  Clock,
  ShieldAlert,
  FileText,
  Table,
  Camera,
  ChevronDown
} from 'lucide-react'
import { usePermissions } from '@/hooks/use-permissions'
import { analyticsService } from '@/services/analytics-service'
import { AnalyticsExportService } from '@/services/analytics-export-service'
import { bookingEngine } from '@/services/booking-engine'
import { startOfWeek, endOfWeek, format } from 'date-fns'
import { KPICard } from '@/components/analytics/KPICard'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { formatCurrencySync } from '@/lib/utils'
import { useCurrency } from '@/hooks/use-currency'
import { 
  LineChart, 
  Line, 
  BarChart, 
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend,
  ResponsiveContainer 
} from 'recharts'
import type { 
  RevenueAnalytics, 
  OccupancyAnalytics, 
  GuestAnalytics,
  PerformanceMetrics 
} from '@/types/analytics'

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8', '#82ca9d']

export function AnalyticsPage() {
  const { currency } = useCurrency()
  const permissions = usePermissions()
  const [loading, setLoading] = useState(true)
  const [revenue, setRevenue] = useState<RevenueAnalytics | null>(null)
  const [occupancy, setOccupancy] = useState<OccupancyAnalytics | null>(null)
  const [guests, setGuests] = useState<GuestAnalytics | null>(null)
  const [performance, setPerformance] = useState<PerformanceMetrics | null>(null)
  const [weekBookings, setWeekBookings] = useState<any[]>([])

  useEffect(() => {
    loadAnalytics()
    
    // Refresh every 5 minutes
    const interval = setInterval(() => {
      loadAnalytics()
    }, 5 * 60 * 1000)
    
    return () => clearInterval(interval)
  }, [])

  const loadAnalytics = async () => {
    setLoading(true)
    try {
      const [revenueData, occupancyData, guestData, performanceData, allBookings] =
        await Promise.all([
          analyticsService.getRevenueAnalytics(),
          analyticsService.getOccupancyAnalytics(),
          analyticsService.getGuestAnalytics(),
          analyticsService.getPerformanceMetrics(),
          bookingEngine.getAllBookings(),
        ])

      setRevenue(revenueData)
      setOccupancy(occupancyData)
      setGuests(guestData)
      setPerformance(performanceData)

      // This week's bookings — same filter as analytics-service & revenue-service
      const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 })
      const thisWeekBks = allBookings.filter(b =>
        ['checked-in', 'checked-out'].includes(b.status) &&
        new Date(b.dates.checkIn) >= weekStart
      )
      setWeekBookings(thisWeekBks)
    } catch (error) {
      console.error('Failed to load analytics:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleExport = async (format: 'pdf' | 'csv' | 'screenshot') => {
    try {
      switch (format) {
        case 'pdf':
          await AnalyticsExportService.exportToPDF(revenue, occupancy, guests, performance)
          break
        case 'csv':
          AnalyticsExportService.exportToCSV(revenue, occupancy, guests, performance)
          break
        case 'screenshot':
          await AnalyticsExportService.exportScreenshot('analytics-dashboard')
          break
        default:
          console.error('Unknown export format:', format)
      }
    } catch (error) {
      console.error('Export failed:', error)
      // You could add a toast notification here
    }
  }

  const calculateGrowth = (current: number, previous: number): number => {
    if (!current || !previous || previous === 0) return current > 0 ? 100 : 0
    return ((current - previous) / previous) * 100
  }

  // This week bounds (pre-computed for the breakdown card)
  const thisWeekStart = startOfWeek(new Date(), { weekStartsOn: 1 })
  const thisWeekEnd = endOfWeek(new Date(), { weekStartsOn: 1 })
  const weekTotal = weekBookings.reduce((s, b) => s + Number(b.amount || 0), 0)

  // Calculate growth metrics with null safety
  const revenueGrowth = revenue
    ? calculateGrowth(revenue.revenueByPeriod.thisMonth, revenue.revenueByPeriod.lastMonth)
    : 0

  // Check if user has permission to view analytics
  if (!permissions.can('analytics', 'read')) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
        <ShieldAlert className="w-16 h-16 text-destructive" />
        <h2 className="text-2xl font-bold">Access Denied</h2>
        <p className="text-muted-foreground text-center max-w-md">
          You do not have permission to view analytics. Please contact your administrator.
        </p>
        <Badge variant="outline" className="mt-4">
          Required: Manager, Admin, or Owner role
        </Badge>
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
    <div id="analytics-dashboard" className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold">Analytics Dashboard</h2>
          <p className="text-muted-foreground mt-1">
            Comprehensive insights into your business performance
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="gap-2">
              <Download className="w-4 h-4" />
              Export Report
              <ChevronDown className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => handleExport('pdf')}>
              <FileText className="w-4 h-4 mr-2" />
              Export as PDF
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleExport('csv')}>
              <Table className="w-4 h-4 mr-2" />
              Export as CSV
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleExport('screenshot')}>
              <Camera className="w-4 h-4 mr-2" />
              Export Screenshot
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KPICard
          title="Total Revenue"
          value={formatCurrencySync(revenue?.totalRevenue || 0, currency)}
          subtitle={`${formatCurrencySync(revenue?.revenueByPeriod.thisMonth || 0, currency)} this month`}
          icon={DollarSign}
          trend={{
            value: revenueGrowth,
            label: 'vs last month'
          }}
        />

        <KPICard
          title="Occupancy Rate"
          value={occupancy?.currentOccupancyRate || 0}
          valueSuffix="%"
          subtitle={`${occupancy?.occupiedRooms || 0} of ${occupancy?.totalRooms || 0} rooms`}
          icon={Percent}
        />

        <KPICard
          title="Average Daily Rate"
          value={formatCurrencySync(performance?.adr || 0, currency)}
          subtitle="Per room per night"
          icon={TrendingUp}
        />

        <KPICard
          title="Total Guests"
          value={guests?.totalGuests || 0}
          subtitle={`${guests?.repeatGuestRate || 0}% repeat guests`}
          icon={Users}
        />
      </div>

      {/* Secondary KPI Row */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KPICard
          title="RevPAR"
          value={formatCurrencySync(performance?.revPAR || 0, currency)}
          subtitle="Revenue per Available Room"
          icon={BarChart3}
        />

        <KPICard
          title="Total Bookings"
          value={performance?.totalBookings || 0}
          subtitle="Confirmed bookings"
          icon={Calendar}
        />

        <KPICard
          title="Avg Length of Stay"
          value={occupancy?.averageLengthOfStay || 0}
          valueSuffix=" nights"
          subtitle="Average per booking"
          icon={Clock}
        />

        <KPICard
          title="New Guests"
          value={guests?.newGuestsThisMonth || 0}
          subtitle="This month"
          icon={Users}
        />
      </div>

      {/* Charts Row 1 */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Occupancy Trend */}
        <Card>
          <CardHeader>
            <CardTitle>Occupancy Trend (30 Days)</CardTitle>
          </CardHeader>
          <CardContent>
            {occupancy?.occupancyTrend && occupancy.occupancyTrend.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={occupancy.occupancyTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
                  <XAxis 
                    dataKey="date" 
                    tickFormatter={(value) => {
                      const date = new Date(value)
                      return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                    }}
                    tick={{ fontSize: 12 }}
                  />
                  <YAxis 
                    tick={{ fontSize: 12 }}
                    label={{ value: 'Occupancy %', angle: -90, position: 'insideLeft' }}
                  />
                  <Tooltip 
                    formatter={(value: any) => [`${value.toFixed(1)}%`, 'Occupancy Rate']}
                    labelFormatter={(label) => new Date(label).toLocaleDateString()}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="rate" 
                    stroke="#8884d8" 
                    strokeWidth={2}
                    name="Occupancy Rate"
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                <p>No occupancy data available</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Revenue by Room Type */}
        <Card>
          <CardHeader>
            <CardTitle>Revenue by Room Type</CardTitle>
          </CardHeader>
          <CardContent>
            {revenue?.revenueByRoomType && revenue.revenueByRoomType.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={revenue?.revenueByRoomType || []}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={(entry) => `${entry.roomTypeName}: ${formatCurrencySync(entry.revenue || 0, currency)}`}
                    outerRadius={80}
                    fill="#8884d8"
                    dataKey="revenue"
                  >
                    {(revenue?.revenueByRoomType || []).map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value: any) => formatCurrencySync(value || 0, currency)} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                <p>No revenue data available</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Charts Row 2 */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Payment Methods */}
        <Card>
          <CardHeader>
            <CardTitle>Revenue by Payment Method</CardTitle>
          </CardHeader>
          <CardContent>
            {revenue?.revenueByPaymentMethod ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart
                  data={[
                    { method: 'Cash', amount: revenue.revenueByPaymentMethod.cash },
                    { method: 'Mobile Money', amount: revenue.revenueByPaymentMethod.mobileMoney },
                    { method: 'Card', amount: revenue.revenueByPaymentMethod.card }
                  ]}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
                  <XAxis dataKey="method" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip formatter={(value: any) => formatCurrencySync(value || 0, currency)} />
                  <Bar dataKey="amount" fill="#82ca9d" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                <p>No payment data available</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Revenue Trend */}
        <Card>
          <CardHeader>
            <CardTitle>Daily Revenue Trend (30 Days)</CardTitle>
          </CardHeader>
          <CardContent>
            {revenue?.dailyRevenueHistory && revenue.dailyRevenueHistory.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={revenue.dailyRevenueHistory}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
                  <XAxis 
                    dataKey="date" 
                    tickFormatter={(value) => {
                      const date = new Date(value)
                      return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                    }}
                    tick={{ fontSize: 12 }}
                  />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip 
                    formatter={(value: any) => [formatCurrencySync(value || 0, currency), 'Revenue']}
                    labelFormatter={(label) => new Date(label).toLocaleDateString()}
                  />
                  <Line  
                    type="monotone" 
                    dataKey="revenue" 
                    stroke="#10b981" 
                    strokeWidth={2}
                    name="Daily Revenue"
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                <p>No revenue trend data available</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* This Week's Bookings Breakdown */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">This Week's Booking Breakdown</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                {format(thisWeekStart, 'MMM d')} – {format(thisWeekEnd, 'MMM d, yyyy')} · Matches staff weekly revenue reports
              </p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold text-primary">{formatCurrencySync(weekTotal, currency)}</p>
              <p className="text-xs text-muted-foreground">{weekBookings.length} booking{weekBookings.length !== 1 ? 's' : ''}</p>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {weekBookings.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <Calendar className="w-10 h-10 mx-auto mb-2 opacity-40" />
              <p>No bookings checked in this week yet</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground text-xs uppercase tracking-wide">
                    <th className="text-left py-2 font-medium">#</th>
                    <th className="text-left py-2 font-medium">Guest</th>
                    <th className="text-left py-2 font-medium">Room</th>
                    <th className="text-left py-2 font-medium">Check-in</th>
                    <th className="text-left py-2 font-medium">Check-out</th>
                    <th className="text-left py-2 font-medium">Staff</th>
                    <th className="text-left py-2 font-medium">Status</th>
                    <th className="text-right py-2 font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {weekBookings.map((b, i) => (
                    <tr key={b.id} className="border-b last:border-0 hover:bg-accent/30 transition-colors">
                      <td className="py-2.5 text-muted-foreground">{i + 1}</td>
                      <td className="py-2.5 font-medium">{b.guest?.fullName || '—'}</td>
                      <td className="py-2.5">{b.roomNumber || '—'}</td>
                      <td className="py-2.5">{b.dates.checkIn}</td>
                      <td className="py-2.5">{b.dates.checkOut}</td>
                      <td className="py-2.5 text-muted-foreground">
                        {b.status === 'checked-out'
                          ? (b.checkOutByName || b.checkInByName || b.createdByName || '—')
                          : (b.checkInByName || b.createdByName || '—')}
                      </td>
                      <td className="py-2.5">
                        <Badge
                          variant={
                            b.status === 'checked-out' ? 'secondary'
                            : b.status === 'checked-in' ? 'default'
                            : 'outline'
                          }
                          className="capitalize"
                        >
                          {b.status}
                        </Badge>
                      </td>
                      <td className="py-2.5 text-right font-semibold">{formatCurrencySync(Number(b.amount || 0), currency)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 font-bold">
                    <td colSpan={7} className="py-3 text-right pr-4">Total</td>
                    <td className="py-3 text-right text-primary">{formatCurrencySync(weekTotal, currency)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Top Guests Table */}
      <Card>
        <CardHeader>
          <CardTitle>Top Guests by Revenue</CardTitle>
        </CardHeader>
        <CardContent>
          {guests?.topGuests && guests.topGuests.length > 0 ? (
            <div className="space-y-4">
              {guests.topGuests.slice(0, 5).map((guest, index) => (
                <div key={guest.id} className="flex items-center justify-between p-3 rounded-lg border hover:bg-accent/50 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center font-bold text-primary">
                      {index + 1}
                    </div>
                    <div>
                      <p className="font-medium">{guest.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {guest.bookingCount} booking{guest.bookingCount > 1 ? 's' : ''} • 
                        {' '}{guest.averageStay.toFixed(1)} avg nights
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-primary text-lg">
                      {formatCurrencySync(guest.totalRevenue || 0, currency)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Last visit: {new Date(guest.lastVisit).toLocaleDateString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <Users className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>No guest data available yet</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Insights Summary */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Revenue Insights</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">This Week</span>
              <span className="font-medium">{formatCurrencySync(revenue?.revenueByPeriod.thisWeek || 0, currency)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">This Month</span>
              <span className="font-medium">{formatCurrencySync(revenue?.revenueByPeriod.thisMonth || 0, currency)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">This Year</span>
              <span className="font-medium">{formatCurrencySync(revenue?.revenueByPeriod.thisYear || 0, currency)}</span>
            </div>
            <div className="flex justify-between pt-2 border-t">
              <span className="text-muted-foreground">Online Revenue</span>
              <span className="font-medium">{formatCurrencySync(revenue?.revenueBySource.online || 0, currency)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Reception Revenue</span>
              <span className="font-medium">{formatCurrencySync(revenue?.revenueBySource.reception || 0, currency)}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Occupancy Insights</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Current Rate</span>
              <span className="font-medium">{occupancy?.currentOccupancyRate}%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Occupied Rooms</span>
              <span className="font-medium">{occupancy?.occupiedRooms}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Available Rooms</span>
              <span className="font-medium">{occupancy?.availableRooms}</span>
            </div>
            <div className="flex justify-between pt-2 border-t">
              <span className="text-muted-foreground">Avg Stay Length</span>
              <span className="font-medium">{occupancy?.averageLengthOfStay} nights</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Booking Lead Time</span>
              <span className="font-medium">{occupancy?.bookingLeadTime} days</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Guest Insights</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Total Guests</span>
              <span className="font-medium">{guests?.totalGuests}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">New This Month</span>
              <span className="font-medium">{guests?.newGuestsThisMonth}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Repeat Rate</span>
              <span className="font-medium">{guests?.repeatGuestRate}%</span>
            </div>
            <div className="flex justify-between pt-2 border-t">
              <span className="text-muted-foreground">Avg Lifetime Value</span>
              <span className="font-medium">{formatCurrencySync(guests?.guestLifetimeValue.average || 0, currency)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">VIP Guests</span>
              <span className="font-medium">{guests?.guestSegmentation.vip}</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

