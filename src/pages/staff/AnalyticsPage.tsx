import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
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
  ChevronDown,
  ArrowUpRight,
  ArrowDownRight,
  BedDouble,
  Activity,
  Star,
  CreditCard,
} from 'lucide-react'
import { usePermissions } from '@/hooks/use-permissions'
import { analyticsService } from '@/services/analytics-service'
import { AnalyticsExportService } from '@/services/analytics-export-service'
import { bookingEngine } from '@/services/booking-engine'
import { blink } from '@/blink/client'
import { standaloneSalesService } from '@/services/standalone-sales-service'
import {
  startOfWeek, endOfWeek, format,
  subWeeks, subMonths, startOfMonth, endOfMonth,
  subYears, startOfYear, endOfYear,
} from 'date-fns'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { formatCurrencySync, cn } from '@/lib/utils'
import { useCurrency } from '@/hooks/use-currency'
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import type {
  RevenueAnalytics,
  OccupancyAnalytics,
  GuestAnalytics,
  PerformanceMetrics
} from '@/types/analytics'

const ROOM_COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4']

const ChartTooltip = ({ active, payload, label, formatter }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border bg-card shadow-lg px-3 py-2 text-xs">
      <p className="font-medium text-foreground mb-1">
        {label ? new Date(label).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : ''}
      </p>
      {payload.map((p: any, i: number) => (
        <p key={i} style={{ color: p.color }} className="font-semibold">
          {formatter ? formatter(p.value) : p.value}
        </p>
      ))}
    </div>
  )
}

export function AnalyticsPage() {
  const { currency } = useCurrency()
  const permissions = usePermissions()
  const [loading, setLoading] = useState(true)
  const [revenue, setRevenue] = useState<RevenueAnalytics | null>(null)
  const [occupancy, setOccupancy] = useState<OccupancyAnalytics | null>(null)
  const [guests, setGuests] = useState<GuestAnalytics | null>(null)
  const [performance, setPerformance] = useState<PerformanceMetrics | null>(null)
  const [allRevenueBookings, setAllRevenueBookings] = useState<any[]>([])
  const [allDepositBookings, setAllDepositBookings] = useState<any[]>([])
  const [breakdownMode, setBreakdownMode] = useState<'week' | 'month' | 'year'>('week')
  const [selectedWeekIdx, setSelectedWeekIdx] = useState(0)
  const [selectedMonthIdx, setSelectedMonthIdx] = useState(0)
  const [selectedYearIdx, setSelectedYearIdx] = useState(0)
  const [isTableExpanded, setIsTableExpanded] = useState(false)
  // Additional Revenue Sources period state
  const [allChargesRaw, setAllChargesRaw] = useState<any[]>([])
  const [allSalesRaw, setAllSalesRaw] = useState<any[]>([])
  const [chargePeriodMode, setChargePeriodMode] = useState<'week' | 'month' | 'year'>('week')
  const [chargeWeekIdx, setChargeWeekIdx] = useState(0)
  const [chargeMonthIdx, setChargeMonthIdx] = useState(0)
  const [chargeYearIdx, setChargeYearIdx] = useState(0)

  useEffect(() => {
    loadAnalytics()
    const interval = setInterval(() => { loadAnalytics() }, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [])

  const loadAnalytics = async () => {
    setLoading(true)
    try {
      // Fetch all shared data ONCE, then pass to each analytics method — no redundant DB calls
      // Timeout after 15s to prevent infinite hang from IndexedDB/network issues
      const shared = await Promise.race([
        analyticsService.prefetchSharedData(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Analytics data fetch timed out')), 15000)),
      ])
      const [revenueData, occupancyData, guestData] = await Promise.all([
        analyticsService.getRevenueAnalytics(undefined, undefined, shared),
        analyticsService.getOccupancyAnalytics(shared),
        analyticsService.getGuestAnalytics(shared),
      ])
      const performanceData = await analyticsService.getPerformanceMetrics(
        shared, { revenue: revenueData, occupancy: occupancyData }
      )
      const allBookings = shared.bookings
      const chargesRaw = shared.chargesRaw
      const salesRaw = shared.standaloneSales
      setRevenue(revenueData)
      setOccupancy(occupancyData)
      setGuests(guestData)
      setPerformance(performanceData)
      setAllRevenueBookings(
        allBookings.filter(b => ['checked-in', 'checked-out'].includes(b.status))
      )
      // Confirmed bookings that collected a deposit — these are real cash received
      // For groups: only the primary booking (to avoid double-counting)
      const _seenDepositGroups = new Set<string>()
      setAllDepositBookings(
        allBookings.filter(b => {
          if (b.status !== 'confirmed') return false
          if ((b.amountPaid || 0) <= 0 && (b.paymentStatus || 'pending') === 'pending') return false
          if (b.groupId) {
            if (!b.isPrimaryBooking) return false
            if (_seenDepositGroups.has(b.groupId)) return false
            _seenDepositGroups.add(b.groupId)
          }
          return true
        })
      )
      setAllChargesRaw(chargesRaw || [])
      setAllSalesRaw(salesRaw || [])
    } catch (error) {
      console.error('Failed to load analytics:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleExport = async (fmt: 'pdf' | 'csv' | 'screenshot') => {
    try {
      if (fmt === 'pdf') await AnalyticsExportService.exportToPDF(revenue, occupancy, guests, performance)
      else if (fmt === 'csv') AnalyticsExportService.exportToCSV(revenue, occupancy, guests, performance)
      else await AnalyticsExportService.exportScreenshot('analytics-dashboard')
    } catch (error) {
      console.error('Export failed:', error)
    }
  }

  const calculateGrowth = (current: number, previous: number): number => {
    if (!current || !previous || previous === 0) return current > 0 ? 100 : 0
    return ((current - previous) / previous) * 100
  }

  // ── Period options ─────────────────────────────────────────────────────
  const weekOptions = Array.from({ length: 12 }, (_, i) => {
    const weekStart = startOfWeek(subWeeks(new Date(), i), { weekStartsOn: 1 })
    const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 })
    return {
      label: i === 0 ? 'This Week' : `${format(weekStart, 'MMM d')} – ${format(weekEnd, 'MMM d')}`,
      sublabel: i === 0 ? format(weekStart, 'MMM d') + ' – ' + format(weekEnd, 'MMM d, yyyy') : format(weekEnd, 'yyyy'),
      start: weekStart, end: weekEnd, idx: i,
    }
  })
  const monthOptions = Array.from({ length: 12 }, (_, i) => {
    const d = subMonths(new Date(), i)
    const start = startOfMonth(d)
    const end = endOfMonth(d)
    return {
      label: i === 0 ? 'This Month' : format(start, 'MMMM yyyy'),
      sublabel: format(start, 'MMMM yyyy'),
      start, end, idx: i,
    }
  })
  const yearOptions = Array.from({ length: 3 }, (_, i) => {
    const d = subYears(new Date(), i)
    const start = startOfYear(d)
    const end = endOfYear(d)
    return {
      label: i === 0 ? 'This Year' : format(start, 'yyyy'),
      sublabel: format(start, 'yyyy'),
      start, end, idx: i,
    }
  })

  // ── Active period & filtered bookings ──────────────────────────────────
  const selectedIdx = breakdownMode === 'week' ? selectedWeekIdx
    : breakdownMode === 'month' ? selectedMonthIdx : selectedYearIdx
  const activePeriod = breakdownMode === 'week' ? weekOptions[selectedWeekIdx]
    : breakdownMode === 'month' ? monthOptions[selectedMonthIdx] : yearOptions[selectedYearIdx]

  const breakdownBookings = [
    ...allRevenueBookings
      .filter(b => { const d = new Date(b.dates.checkIn); return d >= activePeriod.start && d <= activePeriod.end })
      .map(b => ({ ...b, _isDeposit: false, _displayAmount: Number(b.amount || 0) })),
    ...allDepositBookings
      .filter(b => { const d = new Date(b.createdAt || ''); return !isNaN(d.getTime()) && d >= activePeriod.start && d <= activePeriod.end })
      .map(b => ({ ...b, _isDeposit: true, _displayAmount: Number(b.amountPaid || 0) })),
  ]
  const breakdownTotal = breakdownBookings.reduce((s, b) => s + (b as any)._displayAmount, 0)

  const normPay = (raw: string) => {
    const s = (raw || '').trim().toLowerCase()
    if (s === 'cash') return 'cash'
    if (s === 'mobile_money' || s === 'mobile money' || s.includes('mobile') || s.includes('momo')) return 'mobile_money'
    if (s === 'card' || s.includes('card') || s.includes('credit') || s.includes('debit')) return 'card'
    return ''
  }
  const bdAmounts = { cash: 0, mobile_money: 0, card: 0 }
  const bdCounts  = { cash: 0, mobile_money: 0, card: 0 }
  for (const b of breakdownBookings) {
    if ((b as any).paymentSplits?.length > 1) {
      for (const s of (b as any).paymentSplits) {
        const m = normPay(s.method)
        if (m in bdAmounts) {
          bdAmounts[m as keyof typeof bdAmounts] += Number(s.amount) || 0
          bdCounts[m as keyof typeof bdCounts]++
        }
      }
    } else {
      const m = normPay(b.paymentMethod || b.payment?.method || '')
      if (m in bdAmounts) {
        bdAmounts[m as keyof typeof bdAmounts] += ((b as any)._displayAmount ?? Number(b.amount)) || 0
        bdCounts[m as keyof typeof bdCounts]++
      }
    }
  }
  const bdPayMethods = [
    { key: 'cash', label: 'Cash',  amount: bdAmounts.cash,         count: bdCounts.cash,         color: '#10b981', dot: 'bg-emerald-500' },
    { key: 'momo', label: 'Momo',  amount: bdAmounts.mobile_money, count: bdCounts.mobile_money, color: '#3b82f6', dot: 'bg-blue-500' },
    { key: 'card', label: 'Card',  amount: bdAmounts.card,         count: bdCounts.card,          color: '#8b5cf6', dot: 'bg-purple-500' },
  ].filter(m => m.amount > 0 || m.count > 0)
  const bdPayTotal = bdPayMethods.reduce((s, m) => s + m.amount, 0)

  // ── Charge period filtering ─────────────────────────────────────────────
  const chargeActivePeriod = chargePeriodMode === 'week' ? weekOptions[chargeWeekIdx]
    : chargePeriodMode === 'month' ? monthOptions[chargeMonthIdx] : yearOptions[chargeYearIdx]
  const chargeSelectedIdx = chargePeriodMode === 'week' ? chargeWeekIdx
    : chargePeriodMode === 'month' ? chargeMonthIdx : chargeYearIdx

  const filteredCharges = allChargesRaw.filter(c => {
    const d = new Date(c.createdAt || c.created_at || '')
    return !isNaN(d.getTime()) && d >= chargeActivePeriod.start && d <= chargeActivePeriod.end
  })
  const filteredSales = allSalesRaw.filter((s: any) => {
    const sd = s.saleDate || s.sale_date || ''
    if (!sd) return false
    const d = new Date(sd)
    return d >= chargeActivePeriod.start && d <= chargeActivePeriod.end
  })
  const chargeCatMap: Record<string, number> = {}
  for (const c of filteredCharges) {
    const cat = c.category || 'other'
    chargeCatMap[cat] = (chargeCatMap[cat] || 0) + Number(c.amount || 0)
  }
  for (const s of filteredSales) {
    const cat = (s as any).category || 'other'
    chargeCatMap[cat] = (chargeCatMap[cat] || 0) + Number((s as any).amount || 0)
  }

  // ── Page-computed Revenue Summary (uses same raw data as Booking Breakdown & Additional Revenue Sources) ──
  // This ensures the Revenue Summary is always consistent with the other two cards.
  const computeRevForPeriod = (period: { start: Date; end: Date }) => {
    const roomRev = allRevenueBookings
      .filter(b => { const d = new Date(b.dates.checkIn); return d >= period.start && d <= period.end })
      .reduce((s: number, b: any) => s + Number(b.amount || 0), 0)
    const depositRev = allDepositBookings
      .filter(b => { const d = new Date(b.createdAt || ''); return !isNaN(d.getTime()) && d >= period.start && d <= period.end })
      .reduce((s: number, b: any) => s + Number(b.amountPaid || 0), 0)
    const chargesRev = allChargesRaw
      .filter(c => {
        const d = new Date(c.createdAt || c.created_at || '')
        return !isNaN(d.getTime()) && d >= period.start && d <= period.end
      })
      .reduce((s: number, c: any) => s + Number(c.amount || 0), 0)
    const salesRev = allSalesRaw
      .filter((s: any) => {
        const sd = s.saleDate || s.sale_date || ''
        const d = new Date(sd)
        return !isNaN(d.getTime()) && d >= period.start && d <= period.end
      })
      .reduce((s: number, sale: any) => s + Number(sale.amount || 0), 0)
    return roomRev + depositRev + chargesRev + salesRev
  }
  const pageRevThisWeek  = computeRevForPeriod(weekOptions[0])
  const pageRevThisMonth = computeRevForPeriod(monthOptions[0])
  const pageRevThisYear  = computeRevForPeriod(yearOptions[0])

  const revenueGrowth = revenue
    ? calculateGrowth(pageRevThisMonth, computeRevForPeriod(monthOptions[1]))
    : 0

  if (!permissions.can('analytics', 'read')) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
        <ShieldAlert className="w-16 h-16 text-destructive" />
        <h2 className="text-2xl font-bold">Access Denied</h2>
        <p className="text-muted-foreground text-center max-w-md">
          You do not have permission to view analytics. Please contact your administrator.
        </p>
        <Badge variant="outline">Required: Manager, Admin, or Owner role</Badge>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-3">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-muted-foreground">Loading analytics…</p>
      </div>
    )
  }

  // Payment method data for horizontal bar visualization
  const pm = revenue?.revenueByPaymentMethod
  const paymentData = pm
    ? [
        { label: 'Cash', value: pm.cash, count: pm.cashCount, color: '#10b981' },
        { label: 'Mobile Money', value: pm.mobileMoney, count: pm.mobileMonetyCount, color: '#3b82f6' },
        { label: 'Card', value: pm.card, count: pm.cardCount, color: '#8b5cf6' },
        { label: 'Not Paid', value: pm.notPaid, count: pm.notPaidCount, color: '#f59e0b' },
      ].filter(d => d.count > 0 || d.value > 0)
    : []
  const paymentTotal = paymentData.reduce((s, d) => s + d.value, 0)
  const paymentMax = Math.max(...paymentData.map(d => d.value), 1)
  const paymentTopMethod = paymentData.reduce((top, d) => d.count > (top?.count ?? -1) ? d : top, paymentData[0])

  return (
    <div id="analytics-dashboard" className="space-y-7 animate-fade-in pb-8">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-primary uppercase tracking-widest">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              Live Dashboard
            </span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Performance Analytics</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {format(new Date(), 'EEEE, MMMM d, yyyy')} · Figures in {currency}
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5 shrink-0">
              <Download className="w-3.5 h-3.5" />
              Export
              <ChevronDown className="w-3 h-3 opacity-50" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onClick={() => handleExport('pdf')}>
              <FileText className="w-3.5 h-3.5 mr-2" />Export as PDF
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleExport('csv')}>
              <Table className="w-3.5 h-3.5 mr-2" />Export as CSV
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleExport('screenshot')}>
              <Camera className="w-3.5 h-3.5 mr-2" />Screenshot
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* ── Primary KPI Cards ───────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {/* Total Revenue */}
        <div className="relative overflow-hidden rounded-xl border bg-card p-5 shadow-sm">
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/6 via-transparent to-transparent pointer-events-none" />
          <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-emerald-400 to-emerald-600 rounded-t-xl" />
          <div className="relative">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">Total Revenue</span>
              <div className="p-1.5 rounded-lg bg-emerald-500/10">
                <DollarSign className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              </div>
            </div>
            <p className="text-[1.65rem] font-bold tracking-tight leading-none">
              {formatCurrencySync(revenue?.totalRevenue || 0, currency)}
            </p>
            <div className="flex items-center gap-1.5 mt-2.5">
              {revenueGrowth >= 0
                ? <ArrowUpRight className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                : <ArrowDownRight className="w-3.5 h-3.5 text-red-500 shrink-0" />}
              <span className={cn('text-xs font-semibold', revenueGrowth >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500')}>
                {Math.abs(revenueGrowth).toFixed(1)}%
              </span>
              <span className="text-xs text-muted-foreground">vs last month</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {formatCurrencySync(pageRevThisMonth, currency)} this month
            </p>
          </div>
        </div>

        {/* Occupancy Rate */}
        <div className="relative overflow-hidden rounded-xl border bg-card p-5 shadow-sm">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-500/6 via-transparent to-transparent pointer-events-none" />
          <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-blue-400 to-blue-600 rounded-t-xl" />
          <div className="relative">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">Occupancy</span>
              <div className="p-1.5 rounded-lg bg-blue-500/10">
                <BedDouble className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
              </div>
            </div>
            <div className="flex items-end gap-0.5 leading-none">
              <p className="text-[1.65rem] font-bold tracking-tight">{occupancy?.currentOccupancyRate || 0}</p>
              <span className="text-lg font-semibold text-muted-foreground mb-0.5">%</span>
            </div>
            <div className="mt-3 h-1.5 rounded-full bg-secondary overflow-hidden">
              <div
                className="h-full rounded-full bg-blue-500 transition-all duration-1000"
                style={{ width: `${Math.min(occupancy?.currentOccupancyRate || 0, 100)}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1.5">
              {occupancy?.occupiedRooms || 0} of {occupancy?.totalRooms || 0} rooms occupied
            </p>
          </div>
        </div>

        {/* ADR */}
        <div className="relative overflow-hidden rounded-xl border bg-card p-5 shadow-sm">
          <div className="absolute inset-0 bg-gradient-to-br from-amber-500/6 via-transparent to-transparent pointer-events-none" />
          <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-amber-400 to-amber-600 rounded-t-xl" />
          <div className="relative">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">Avg Daily Rate</span>
              <div className="p-1.5 rounded-lg bg-amber-500/10">
                <TrendingUp className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
              </div>
            </div>
            <p className="text-[1.65rem] font-bold tracking-tight leading-none">
              {formatCurrencySync(performance?.adr || 0, currency)}
            </p>
            <p className="text-xs text-muted-foreground mt-2.5">Per room per night</p>
            <p className="text-xs text-muted-foreground">
              RevPAR: {formatCurrencySync(performance?.revPAR || 0, currency)}
            </p>
          </div>
        </div>

        {/* Total Guests */}
        <div className="relative overflow-hidden rounded-xl border bg-card p-5 shadow-sm">
          <div className="absolute inset-0 bg-gradient-to-br from-purple-500/6 via-transparent to-transparent pointer-events-none" />
          <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-purple-400 to-purple-600 rounded-t-xl" />
          <div className="relative">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">Guests</span>
              <div className="p-1.5 rounded-lg bg-purple-500/10">
                <Users className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
              </div>
            </div>
            <p className="text-[1.65rem] font-bold tracking-tight leading-none">{guests?.totalGuests || 0}</p>
            <p className="text-xs text-muted-foreground mt-2.5">{guests?.repeatGuestRate || 0}% repeat rate</p>
            <p className="text-xs text-muted-foreground">{guests?.newGuestsThisMonth || 0} new this month</p>
          </div>
        </div>
      </div>

      {/* ── Secondary Metrics Strip ──────────────────────────────────────── */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Total Bookings', value: (performance?.totalBookings || 0).toString(), sub: 'Checked-in / checked-out', icon: Calendar, color: 'text-sky-500' },
          { label: 'Avg Stay Length', value: `${occupancy?.averageLengthOfStay || 0} nights`, sub: 'Average per booking', icon: Clock, color: 'text-teal-500' },
          { label: 'New Guests', value: (guests?.newGuestsThisMonth || 0).toString(), sub: 'This month', icon: Users, color: 'text-violet-500' },
          { label: 'Booking Lead Time', value: `${occupancy?.bookingLeadTime || 0} days`, sub: 'Avg days before check-in', icon: Activity, color: 'text-orange-500' },
        ].map(({ label, value, sub, icon: Icon, color }) => (
          <div key={label} className="rounded-xl border bg-card px-4 py-3.5 flex items-center gap-3 shadow-sm">
            <Icon className={cn('w-5 h-5 shrink-0', color)} />
            <div className="min-w-0">
              <p className="text-[11px] font-medium text-muted-foreground truncate">{label}</p>
              <p className="text-base font-bold leading-tight">{value}</p>
              <p className="text-[10px] text-muted-foreground truncate">{sub}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ── Charts Row ──────────────────────────────────────────────────── */}
      <div className="grid gap-5 lg:grid-cols-2">
        {/* Daily Revenue Trend – Area Chart */}
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-sm font-semibold">Revenue Trend</CardTitle>
                <p className="text-[11px] text-muted-foreground mt-0.5">Daily revenue over the last 30 days</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground">This month</p>
                <p className="text-sm font-bold text-emerald-600">{formatCurrencySync(pageRevThisMonth, currency)}</p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-1">
            {revenue?.dailyRevenueHistory?.length ? (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={revenue.dailyRevenueHistory} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" stopOpacity={0.18} />
                      <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={v => format(new Date(v), 'MMM d')}
                    tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                    axisLine={false}
                    tickLine={false}
                    interval={6}
                  />
                  <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                  <Tooltip content={<ChartTooltip formatter={(v: number) => formatCurrencySync(v, currency)} />} />
                  <Area type="monotone" dataKey="revenue" stroke="#10b981" strokeWidth={2} fill="url(#revGrad)" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[220px] flex items-center justify-center text-sm text-muted-foreground">No data available</div>
            )}
          </CardContent>
        </Card>

        {/* Occupancy Trend – Area Chart */}
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-sm font-semibold">Occupancy Trend</CardTitle>
                <p className="text-[11px] text-muted-foreground mt-0.5">Daily occupancy rate over the last 30 days</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground">Current</p>
                <p className="text-sm font-bold text-blue-600">{occupancy?.currentOccupancyRate || 0}%</p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-1">
            {occupancy?.occupancyTrend?.length ? (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={occupancy.occupancyTrend} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="occGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.18} />
                      <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={v => format(new Date(v), 'MMM d')}
                    tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                    axisLine={false}
                    tickLine={false}
                    interval={6}
                  />
                  <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} />
                  <Tooltip content={<ChartTooltip formatter={(v: number) => `${v.toFixed(1)}%`} />} />
                  <Area type="monotone" dataKey="rate" stroke="#3b82f6" strokeWidth={2} fill="url(#occGrad)" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[220px] flex items-center justify-center text-sm text-muted-foreground">No data available</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Revenue Breakdown Row ────────────────────────────────────────── */}
      <div className="grid gap-5 lg:grid-cols-2">
        {/* Revenue by Room Type – Donut + Legend */}
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Revenue by Room Type</CardTitle>
            <p className="text-[11px] text-muted-foreground">Contribution per room category</p>
          </CardHeader>
          <CardContent>
            {revenue?.revenueByRoomType?.length ? (
              <div className="flex items-center gap-6">
                <div className="shrink-0">
                  <ResponsiveContainer width={160} height={160}>
                    <PieChart>
                      <Pie
                        data={revenue.revenueByRoomType}
                        cx="50%"
                        cy="50%"
                        innerRadius={48}
                        outerRadius={72}
                        paddingAngle={3}
                        dataKey="revenue"
                      >
                        {revenue.revenueByRoomType.map((_, i) => (
                          <Cell key={i} fill={ROOM_COLORS[i % ROOM_COLORS.length]} strokeWidth={0} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v: any) => formatCurrencySync(v, currency)} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex-1 space-y-2.5 min-w-0">
                  {revenue.revenueByRoomType.map((rt, i) => (
                    <div key={rt.roomTypeId}>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: ROOM_COLORS[i % ROOM_COLORS.length] }} />
                          <span className="text-muted-foreground truncate">{rt.roomTypeName}</span>
                        </div>
                        <span className="font-semibold ml-2 shrink-0">{rt.percentage.toFixed(0)}%</span>
                      </div>
                      <div className="h-1 rounded-full bg-secondary overflow-hidden">
                        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${rt.percentage}%`, backgroundColor: ROOM_COLORS[i % ROOM_COLORS.length] }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="h-40 flex items-center justify-center text-sm text-muted-foreground">No data available</div>
            )}
          </CardContent>
        </Card>

        {/* Payment Methods – Horizontal Bars */}
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-sm font-semibold">Revenue by Payment Method</CardTitle>
                <p className="text-[11px] text-muted-foreground">How guests are paying</p>
              </div>
              {paymentTopMethod && (
                <div className="text-right">
                  <p className="text-[10px] text-muted-foreground">Top method</p>
                  <p className="text-xs font-bold" style={{ color: paymentTopMethod.color }}>{paymentTopMethod.label}</p>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4 pt-2">
            {paymentData.map(({ label, value, count, color }) => (
              <div key={label}>
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                    <span className="font-medium text-foreground">{label}</span>
                    <span className="text-muted-foreground">({count} booking{count !== 1 ? 's' : ''})</span>
                  </div>
                  <div className="text-right">
                    <span className="font-semibold">{formatCurrencySync(value, currency)}</span>
                    <span className="text-muted-foreground ml-1.5">{paymentTotal > 0 ? `${((value / paymentTotal) * 100).toFixed(0)}%` : '0%'}</span>
                  </div>
                </div>
                <div className="h-2 rounded-full bg-secondary overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-1000"
                    style={{ width: `${(value / paymentMax) * 100}%`, backgroundColor: color }}
                  />
                </div>
              </div>
            ))}
            {!paymentData.length && (
              <div className="h-40 flex items-center justify-center text-sm text-muted-foreground">No payment data</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Additional Revenue Sources ───────────────────────────────────── */}
      {(() => {
        const catLabels: Record<string, string> = {
          food_beverage: 'Food & Beverage', room_service: 'Room Service',
          minibar: 'Minibar', laundry: 'Laundry', phone_internet: 'Phone / Internet',
          parking: 'Parking', room_extension: 'Room Extension', other: 'Other',
        }
        const catIcons: Record<string, string> = {
          food_beverage: '🍽', room_service: '🛎', minibar: '🍷', laundry: '👕',
          phone_internet: '📡', parking: '🚗', room_extension: '🛏', other: '📦',
        }
        const catEntries = Object.entries(chargeCatMap)
          .filter(([, v]) => v > 0)
          .sort((a, b) => b[1] - a[1])
        const maxVal = catEntries.length > 0 ? catEntries[0][1] : 1
        const grandTotal = catEntries.reduce((s, [, v]) => s + v, 0)
        return (
          <Card className="shadow-sm overflow-hidden">
            <CardHeader className="border-b pb-0 pt-5 px-5">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-4">
                <div>
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-orange-500" />
                    Additional Revenue Sources
                  </CardTitle>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {chargeActivePeriod.sublabel} · charges & walk-in sales by category
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-2xl font-bold text-orange-500 tabular-nums">{formatCurrencySync(grandTotal, currency)}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {filteredCharges.length} charge{filteredCharges.length !== 1 ? 's' : ''}{filteredSales.length > 0 ? ` · ${filteredSales.length} sale${filteredSales.length !== 1 ? 's' : ''}` : ''}
                  </p>
                </div>
              </div>

              {/* Mode switcher */}
              <div className="flex items-center gap-1 mb-4">
                {(['week', 'month', 'year'] as const).map(mode => (
                  <button
                    key={mode}
                    onClick={() => setChargePeriodMode(mode)}
                    className={cn(
                      'px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all',
                      chargePeriodMode === mode
                        ? 'bg-orange-500 text-white shadow-sm'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
                    )}
                  >
                    {mode === 'week' ? 'Weekly' : mode === 'month' ? 'Monthly' : 'Yearly'}
                  </button>
                ))}
                <div className="flex-1" />
                {/* Period selector */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground border rounded-lg px-3 py-1.5 hover:bg-muted/40 transition-all">
                      <Calendar className="w-3.5 h-3.5" />
                      {chargePeriodMode === 'week' ? weekOptions[chargeWeekIdx].label
                        : chargePeriodMode === 'month' ? monthOptions[chargeMonthIdx].label
                        : yearOptions[chargeYearIdx].label}
                      <ChevronDown className="w-3 h-3 opacity-50" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48 max-h-72 overflow-y-auto">
                    {(chargePeriodMode === 'week' ? weekOptions : chargePeriodMode === 'month' ? monthOptions : yearOptions).map((opt, i) => (
                      <DropdownMenuItem
                        key={i}
                        onClick={() => {
                          if (chargePeriodMode === 'week') setChargeWeekIdx(i)
                          else if (chargePeriodMode === 'month') setChargeMonthIdx(i)
                          else setChargeYearIdx(i)
                        }}
                        className={cn(chargeSelectedIdx === i && 'font-semibold text-orange-500 bg-orange-50')}
                      >
                        {opt.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </CardHeader>

            <CardContent className="pt-4">
              {catEntries.length === 0 ? (
                <div className="h-24 flex flex-col items-center justify-center text-muted-foreground gap-1">
                  <TrendingUp className="w-8 h-8 opacity-20" />
                  <p className="text-sm">No charges or sales recorded for this period</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {catEntries.map(([cat, total]) => (
                    <div key={cat}>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                          <span>{catIcons[cat] || '📦'}</span>
                          <span>{catLabels[cat] || cat}</span>
                        </span>
                        <span className="font-semibold tabular-nums">{formatCurrencySync(total, currency)}</span>
                      </div>
                      <div className="h-2 rounded-full bg-secondary overflow-hidden">
                        <div
                          className="h-full rounded-full bg-orange-400 transition-all duration-700"
                          style={{ width: `${maxVal > 0 ? (total / maxVal) * 100 : 0}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )
      })()}

      {/* ── Booking Breakdown Archive ─────────────────────────────────────── */}
      <Card className="shadow-sm overflow-hidden">
        {/* ── Card Header ── */}
        <CardHeader className="border-b pb-0 pt-5 px-5">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-4">
            <div>
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-primary" />
                Booking Breakdown Archive
              </CardTitle>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {activePeriod.sublabel} · {breakdownBookings.length} booking{breakdownBookings.length !== 1 ? 's' : ''}
              </p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-2xl font-bold text-primary tabular-nums">{formatCurrencySync(breakdownTotal, currency)}</p>
              {bdPayMethods.length > 0 && (
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {bdPayMethods.map(m => `${m.label}: ${formatCurrencySync(m.amount, currency)}`).join(' · ')}
                </p>
              )}
            </div>
          </div>

          {/* ── Mode switcher tabs ── */}
          <div className="flex items-center gap-1 mb-4">
            {(['week', 'month', 'year'] as const).map(mode => (
              <button
                key={mode}
                onClick={() => setBreakdownMode(mode)}
                className={cn(
                  'px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all',
                  breakdownMode === mode
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
                )}
              >
                {mode === 'week' ? 'Weekly' : mode === 'month' ? 'Monthly' : 'Yearly'}
              </button>
            ))}
            <div className="flex-1" />
            {/* ── Period selector ── */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground border rounded-lg px-3 py-1.5 hover:bg-muted/40 transition-all">
                  <Calendar className="w-3.5 h-3.5" />
                  {breakdownMode === 'week' ? weekOptions[selectedWeekIdx].label
                    : breakdownMode === 'month' ? monthOptions[selectedMonthIdx].label
                    : yearOptions[selectedYearIdx].label}
                  <ChevronDown className="w-3 h-3 opacity-50" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48 max-h-72 overflow-y-auto">
                {(breakdownMode === 'week' ? weekOptions : breakdownMode === 'month' ? monthOptions : yearOptions).map((opt, i) => (
                  <DropdownMenuItem
                    key={i}
                    onClick={() => {
                      if (breakdownMode === 'week') setSelectedWeekIdx(i)
                      else if (breakdownMode === 'month') setSelectedMonthIdx(i)
                      else setSelectedYearIdx(i)
                    }}
                    className={cn(selectedIdx === i && 'font-semibold text-primary bg-primary/5')}
                  >
                    {opt.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* ── Stats bar ── */}
          {bdPayMethods.length > 0 && (
            <div className="mb-4 rounded-xl bg-muted/30 px-4 py-3">
              {/* Segmented revenue bar */}
              <div className="h-2 w-full rounded-full overflow-hidden flex gap-px mb-3">
                {bdPayMethods.map(m => (
                  <div key={m.key} className="h-full rounded-full transition-all duration-700"
                    style={{ width: `${bdPayTotal > 0 ? (m.amount / bdPayTotal) * 100 : 0}%`, backgroundColor: m.color }} />
                ))}
              </div>
              {/* Method chips */}
              <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                {bdPayMethods.map(m => (
                  <div key={m.key} className="flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-full ${m.dot} shrink-0`} />
                    <span className="text-[11px] text-muted-foreground">{m.label}</span>
                    <span className="text-[11px] font-bold tabular-nums">{formatCurrencySync(m.amount, currency)}</span>
                    <span className="text-[10px] text-muted-foreground/70">({m.count})</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Expand/collapse toggle ── */}
          <button
            onClick={() => setIsTableExpanded(v => !v)}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all group"
          >
            <ChevronDown className={cn('w-4 h-4 transition-transform duration-300', isTableExpanded && 'rotate-180')} />
            {isTableExpanded
              ? `Hide ${breakdownBookings.length} entr${breakdownBookings.length !== 1 ? 'ies' : 'y'}`
              : `Show ${breakdownBookings.length} entr${breakdownBookings.length !== 1 ? 'ies' : 'y'}`}
            <ChevronDown className={cn('w-4 h-4 transition-transform duration-300', isTableExpanded && 'rotate-180')} />
          </button>
        </CardHeader>

        {/* ── Table (collapsible) ── */}
        {isTableExpanded && (
        <CardContent className="p-0">
          {breakdownBookings.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 text-muted-foreground">
              <Calendar className="w-10 h-10 mb-3 opacity-25" />
              <p className="text-sm font-medium">No bookings found for this period</p>
              <p className="text-xs text-muted-foreground mt-1">Try selecting a different {breakdownMode}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/40">
                    <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">#</th>
                    <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Guest</th>
                    <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Room</th>
                    <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Check-in</th>
                    <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Check-out</th>
                    <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Staff</th>
                    <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Payment</th>
                    <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Status</th>
                    <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {breakdownBookings.map((b, i) => {
                    const staffName = b.status === 'checked-out'
                      ? (b.checkOutByName || b.checkInByName || b.createdByName)
                      : (b.checkInByName || b.createdByName)
                    const rawPay = (b.paymentMethod || b.payment?.method || (b as any).payment_method || '').trim().toLowerCase()
                    const payMap: Record<string, { label: string; cls: string }> = {
                      cash:         { label: '💵 Cash',         cls: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:ring-emerald-800' },
                      mobile_money: { label: '📱 Mobile Money', cls: 'bg-blue-50 text-blue-700 ring-1 ring-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:ring-blue-800' },
                      card:         { label: '💳 Card',          cls: 'bg-purple-50 text-purple-700 ring-1 ring-purple-200 dark:bg-purple-950/40 dark:text-purple-400 dark:ring-purple-800' },
                    }
                    const normKey = rawPay === 'cash' ? 'cash'
                      : (rawPay === 'mobile_money' || rawPay === 'mobile money' || rawPay.includes('mobile') || rawPay.includes('momo')) ? 'mobile_money'
                      : (rawPay === 'card' || rawPay.includes('card') || rawPay.includes('credit') || rawPay.includes('debit')) ? 'card'
                      : ''
                    const payEntry = normKey ? payMap[normKey] : null
                    return (
                      <tr key={b.id || i} className="hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3 text-xs text-muted-foreground">{i + 1}</td>
                        <td className="px-4 py-3">
                          <span className="font-medium">{b.guest?.fullName || '—'}</span>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{b.roomNumber || '—'}</td>
                        <td className="px-4 py-3 text-muted-foreground tabular-nums">{b.dates.checkIn}</td>
                        <td className="px-4 py-3 text-muted-foreground tabular-nums">{b.dates.checkOut}</td>
                        <td className="px-4 py-3 text-muted-foreground">{staffName || '—'}</td>
                        <td className="px-4 py-3">
                          {(b as any).paymentSplits?.length > 1 ? (
                            <div className="flex flex-wrap gap-1">
                              {(b as any).paymentSplits.map((s: any, si: number) => {
                                const splitKey = normPay(s.method)
                                const splitEntry = splitKey ? payMap[splitKey] : null
                                return splitEntry ? (
                                  <span key={si} className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium ${splitEntry.cls}`}>
                                    {splitEntry.label.split(' ')[0]} {formatCurrencySync(Number(s.amount) || 0, currency)}
                                  </span>
                                ) : null
                              })}
                            </div>
                          ) : payEntry ? (
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${payEntry.cls}`}>{payEntry.label}</span>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {(b as any)._isDeposit ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
                              Deposit
                            </span>
                          ) : (
                            <span className={cn(
                              'inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold',
                              b.status === 'checked-out'
                                ? 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                                : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400'
                            )}>
                              {b.status === 'checked-out' ? 'Checked Out' : 'Checked In'}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right font-semibold tabular-nums">
                          {formatCurrencySync((b as any)._displayAmount ?? Number(b.amount || 0), currency)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-muted/40 border-t-2 border-border">
                    <td colSpan={8} className="px-4 py-3 text-xs font-semibold text-right text-muted-foreground">
                      TOTAL ({breakdownBookings.length} booking{breakdownBookings.length !== 1 ? 's' : ''})
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-primary tabular-nums">
                      {formatCurrencySync(breakdownTotal, currency)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </CardContent>
        )}
      </Card>

      {/* ── Top Guests ──────────────────────────────────────────────────── */}
      <Card className="shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Star className="w-4 h-4 text-amber-500" />
            Top Guests by Revenue
          </CardTitle>
          <p className="text-[11px] text-muted-foreground">Your highest-value guests across all time</p>
        </CardHeader>
        <CardContent>
          {guests?.topGuests?.length ? (
            <div className="space-y-2">
              {guests.topGuests.slice(0, 5).map((guest, index) => {
                const medals = ['🥇', '🥈', '🥉']
                const barPct = guests.topGuests[0].totalRevenue > 0
                  ? (guest.totalRevenue / guests.topGuests[0].totalRevenue) * 100
                  : 0
                return (
                  <div key={guest.id} className="group flex items-center gap-3 p-3 rounded-lg hover:bg-muted/40 transition-colors">
                    <div className="w-7 text-center shrink-0">
                      {index < 3
                        ? <span className="text-base">{medals[index]}</span>
                        : <span className="text-xs font-bold text-muted-foreground">{index + 1}</span>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <p className="font-semibold text-sm truncate">{guest.name}</p>
                        <p className="font-bold text-sm text-primary ml-3 shrink-0">
                          {formatCurrencySync(guest.totalRevenue || 0, currency)}
                        </p>
                      </div>
                      <div className="h-1 rounded-full bg-secondary overflow-hidden mb-1">
                        <div
                          className="h-full rounded-full bg-amber-400 transition-all duration-700"
                          style={{ width: `${barPct}%` }}
                        />
                      </div>
                      <p className="text-[10px] text-muted-foreground">
                        {guest.bookingCount} booking{guest.bookingCount !== 1 ? 's' : ''} &nbsp;·&nbsp;
                        {guest.averageStay.toFixed(1)} avg nights &nbsp;·&nbsp;
                        Last: {new Date(guest.lastVisit).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Users className="w-10 h-10 mb-3 opacity-25" />
              <p className="text-sm">No guest data available yet</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Revenue / Occupancy / Guest / Payment Summary ───────────────── */}
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        {/* Revenue Summary */}
        <Card className="shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-emerald-500/10">
                <DollarSign className="w-3.5 h-3.5 text-emerald-600" />
              </div>
              <CardTitle className="text-sm font-semibold">Revenue Summary</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {([
              { label: 'This Week',  value: pageRevThisWeek,  pm: revenue?.revenueByPaymentMethodByPeriod?.thisWeek,  highlight: true },
              { label: 'This Month', value: pageRevThisMonth, pm: revenue?.revenueByPaymentMethodByPeriod?.thisMonth, highlight: false },
              { label: 'This Year',  value: pageRevThisYear,  pm: revenue?.revenueByPaymentMethodByPeriod?.thisYear,  highlight: false },
            ] as Array<{ label: string; value: number; pm: any; highlight: boolean }>).map(({ label, value, pm, highlight }) => {
              const methods = pm ? [
                { key: 'cash', label: 'Cash',  amount: pm.cash,        count: pm.cashCount,        color: '#10b981', dot: 'bg-emerald-500' },
                { key: 'momo', label: 'Momo',  amount: pm.mobileMoney, count: pm.mobileMonetyCount, color: '#3b82f6', dot: 'bg-blue-500' },
                { key: 'card', label: 'Card',  amount: pm.card,        count: pm.cardCount,         color: '#8b5cf6', dot: 'bg-purple-500' },
              ].filter(m => m.amount > 0 || m.count > 0) : []
              const totalPaid = methods.reduce((s, m) => s + m.amount, 0)
              return (
                <div key={label} className={cn('rounded-xl px-3 pt-2.5 pb-3', highlight ? 'bg-emerald-50 dark:bg-emerald-950/30' : 'bg-muted/30')}>
                  {/* Period label + total */}
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs text-muted-foreground font-medium">{label}</span>
                    <span className={cn('text-sm font-bold', highlight ? 'text-emerald-700 dark:text-emerald-400' : '')}>
                      {formatCurrencySync(value, currency)}
                    </span>
                  </div>
                  {/* Payment breakdown */}
                  {methods.length > 0 ? (
                    <>
                      {/* Segmented proportion bar */}
                      <div className="h-1 w-full rounded-full overflow-hidden flex gap-px mb-2">
                        {methods.map(m => (
                          <div key={m.key} className="h-full rounded-full transition-all duration-500"
                            style={{ width: `${totalPaid > 0 ? (m.amount / totalPaid) * 100 : 0}%`, backgroundColor: m.color }} />
                        ))}
                      </div>
                      {/* Chips */}
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                        {methods.map(m => (
                          <div key={m.key} className="flex items-center gap-1">
                            <span className={`w-1.5 h-1.5 rounded-full ${m.dot} flex-shrink-0`} />
                            <span className="text-[10px] text-muted-foreground">{m.label}</span>
                            <span className="text-[10px] font-semibold tabular-nums">{formatCurrencySync(m.amount, currency)}</span>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <p className="text-[10px] text-muted-foreground/50 italic">No payment data yet</p>
                  )}
                </div>
              )
            })}
            <div className="border-t pt-3 space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Online</span>
                <span className="font-medium">{formatCurrencySync(revenue?.revenueBySource.online || 0, currency)}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Reception</span>
                <span className="font-medium">{formatCurrencySync(revenue?.revenueBySource.reception || 0, currency)}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Occupancy Summary */}
        <Card className="shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-blue-500/10">
                <BedDouble className="w-3.5 h-3.5 text-blue-600" />
              </div>
              <CardTitle className="text-sm font-semibold">Occupancy Summary</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between rounded-lg bg-blue-50 dark:bg-blue-950/30 px-3 py-2">
              <span className="text-xs text-muted-foreground font-medium">Current Rate</span>
              <span className="text-sm font-bold text-blue-700 dark:text-blue-400">{occupancy?.currentOccupancyRate}%</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: 'Occupied', value: occupancy?.occupiedRooms ?? '—' },
                { label: 'Available', value: occupancy?.availableRooms ?? '—' },
              ].map(({ label, value }) => (
                <div key={label} className="rounded-lg bg-muted/30 px-3 py-2">
                  <p className="text-[10px] text-muted-foreground">{label}</p>
                  <p className="text-base font-bold">{value}</p>
                </div>
              ))}
            </div>
            <div className="border-t pt-3 space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Avg Stay</span>
                <span className="font-medium">{occupancy?.averageLengthOfStay} nights</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Booking Lead Time</span>
                <span className="font-medium">{occupancy?.bookingLeadTime} days</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Guest Summary */}
        <Card className="shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-purple-500/10">
                <Users className="w-3.5 h-3.5 text-purple-600" />
              </div>
              <CardTitle className="text-sm font-semibold">Guest Summary</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between rounded-lg bg-purple-50 dark:bg-purple-950/30 px-3 py-2">
              <span className="text-xs text-muted-foreground font-medium">Total Guests</span>
              <span className="text-sm font-bold text-purple-700 dark:text-purple-400">{guests?.totalGuests}</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: 'New (month)', value: guests?.newGuestsThisMonth ?? '—' },
                { label: 'VIP', value: guests?.guestSegmentation.vip ?? '—' },
              ].map(({ label, value }) => (
                <div key={label} className="rounded-lg bg-muted/30 px-3 py-2">
                  <p className="text-[10px] text-muted-foreground">{label}</p>
                  <p className="text-base font-bold">{value}</p>
                </div>
              ))}
            </div>
            <div className="border-t pt-3 space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Repeat Rate</span>
                <span className="font-medium">{guests?.repeatGuestRate}%</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Avg Lifetime Value</span>
                <span className="font-medium">{formatCurrencySync(guests?.guestLifetimeValue.average || 0, currency)}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Payment Methods Summary */}
        <Card className="shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-sky-500/10">
                <CreditCard className="w-3.5 h-3.5 text-sky-600" />
              </div>
              <CardTitle className="text-sm font-semibold">Payment Methods</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {paymentTopMethod ? (
              <div className="flex items-center justify-between rounded-lg px-3 py-2" style={{ backgroundColor: `${paymentTopMethod.color}15` }}>
                <span className="text-xs text-muted-foreground font-medium">Top Method</span>
                <span className="text-sm font-bold" style={{ color: paymentTopMethod.color }}>{paymentTopMethod.label}</span>
              </div>
            ) : (
              <div className="flex items-center justify-between rounded-lg bg-sky-50 dark:bg-sky-950/30 px-3 py-2">
                <span className="text-xs text-muted-foreground font-medium">Top Method</span>
                <span className="text-sm font-bold text-sky-700">—</span>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: 'Cash', value: pm?.cashCount ?? 0, color: '#10b981' },
                { label: 'Mobile Money', value: pm?.mobileMonetyCount ?? 0, color: '#3b82f6' },
                { label: 'Card', value: pm?.cardCount ?? 0, color: '#8b5cf6' },
                { label: 'Not Paid', value: pm?.notPaidCount ?? 0, color: '#f59e0b' },
              ].map(({ label, value, color }) => (
                <div key={label} className="rounded-lg bg-muted/30 px-3 py-2">
                  <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                    {label}
                  </p>
                  <p className="text-base font-bold">{value}</p>
                </div>
              ))}
            </div>
            <div className="border-t pt-3 space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Total Paid</span>
                <span className="font-medium">{formatCurrencySync((pm?.cash ?? 0) + (pm?.mobileMoney ?? 0) + (pm?.card ?? 0), currency)}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Outstanding</span>
                <span className="font-medium text-amber-600">{formatCurrencySync(pm?.notPaid ?? 0, currency)}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

    </div>
  )
}
