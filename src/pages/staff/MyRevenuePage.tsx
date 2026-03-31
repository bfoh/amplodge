/**
 * My Revenue Page
 * Staff self-view: weekly revenue report based on bookings they created.
 * Visible to all authenticated staff. Data scoped to the current user only.
 */

import { useEffect, useState, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Loader2, TrendingUp, BookOpen, ChevronDown, Send, CheckCircle, Clock, Eye, ShoppingBag, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useStaffRole } from '@/hooks/use-staff-role'
import {
  getWeekBounds,
  getPastWeeksBounds,
  getOrCreateWeekReport,
  getStaffAllReports,
  fetchBookingsForStaffWeek,
  submitWeekReport,
  CHARGE_CATEGORIES,
  type WeeklyRevenueReport,
  type WeekBounds,
  type BookingSummary,
  type StaffWeekResult,
} from '@/services/revenue-service'
import { standaloneSalesService, SALE_CATEGORIES, type StandaloneSale } from '@/services/standalone-sales-service'
import { LogSaleDialog } from '@/components/dialogs/LogSaleDialog'
import { format } from 'date-fns'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatGHS(amount: number) {
  return `GHS ${amount.toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function StatusBadge({ status }: { status: WeeklyRevenueReport['status'] | 'init' }) {
  if (status === 'reviewed') return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">Reviewed</span>
  if (status === 'submitted') return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 ring-1 ring-blue-200">Submitted</span>
  return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-50 text-gray-600 ring-1 ring-gray-200">Draft</span>
}

// ─── Payment method label helper ──────────────────────────────────────────────

function PaymentMethodBadge({ method, splits }: { method: string; splits?: Array<{ method: string; amount: number }> }) {
  const map: Record<string, { label: string; className: string }> = {
    cash:         { label: '💵 Cash',         className: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' },
    mobile_money: { label: '📱 Mobile Money', className: 'bg-blue-50 text-blue-700 ring-1 ring-blue-200' },
    card:         { label: '💳 Card',          className: 'bg-purple-50 text-purple-700 ring-1 ring-purple-200' },
    not_paid:     { label: '⏳ Not Paid',      className: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200' },
  }
  if (splits && splits.length > 1) {
    return (
      <div className="flex flex-wrap gap-1">
        {splits.map((s, i) => {
          const entry = map[s.method]
          return entry ? (
            <span key={i} className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium ${entry.className}`}>
              {entry.label.split(' ')[0]} {formatGHS(s.amount)}
            </span>
          ) : null
        })}
      </div>
    )
  }
  if (!method) return <span className="text-xs text-muted-foreground">—</span>
  const entry = map[method]
  if (!entry) return <span className="text-xs text-muted-foreground">—</span>
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${entry.className}`}>
      {entry.label}
    </span>
  )
}

// ─── Category icon helper ──────────────────────────────────────────────────────

const CATEGORY_ICONS: Record<string, string> = {
  food_beverage: '🍽',
  room_service:  '🛎',
  minibar:       '🍷',
  laundry:       '👕',
  phone_internet:'📡',
  parking:       '🚗',
  room_extension:'🛏',
  other:         '📦',
}

// ─── Booking breakdown row with expandable charges ────────────────────────────

function BookingRow({ b }: { b: BookingSummary }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <>
      <TableRow
        className={b.additionalChargesTotal > 0 ? 'cursor-pointer hover:bg-muted/30' : ''}
        onClick={() => b.additionalChargesTotal > 0 && setExpanded(e => !e)}
      >
        <TableCell className="font-mono text-xs">{b.id.slice(0, 8)}…</TableCell>
        <TableCell>{b.guestName}</TableCell>
        <TableCell>{b.roomNumber}</TableCell>
        <TableCell>{b.checkIn}</TableCell>
        <TableCell>{b.checkOut}</TableCell>
        <TableCell className="text-right font-medium">
          {b.discountAmount > 0
            ? <span className="flex flex-col items-end gap-0.5">
                <span className="line-through text-xs text-muted-foreground">{formatGHS(b.totalPrice)}</span>
                <span>{formatGHS(b.effectivePrice)}</span>
              </span>
            : formatGHS(b.effectivePrice)}
        </TableCell>
        <TableCell className="text-right">
          {b.additionalChargesTotal > 0
            ? <span className="text-orange-600 font-medium">{formatGHS(b.additionalChargesTotal)}</span>
            : <span className="text-xs text-muted-foreground">—</span>}
        </TableCell>
        <TableCell className="text-right font-semibold text-emerald-700">{formatGHS(b.grandTotal)}</TableCell>
        <TableCell><PaymentMethodBadge method={b.paymentMethod} splits={b.paymentSplits} /></TableCell>
        <TableCell>
          <Badge variant="outline" className="text-xs capitalize">{b.status}</Badge>
        </TableCell>
        {b.additionalChargesTotal > 0 && (
          <TableCell>
            <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </TableCell>
        )}
      </TableRow>
      {expanded && b.additionalCharges.map((c) => (
        <TableRow key={c.id} className="bg-orange-50/60">
          <TableCell colSpan={2} />
          <TableCell colSpan={3} className="text-xs text-orange-800">
            <span className="mr-1">{CATEGORY_ICONS[c.category] || '📦'}</span>
            {c.description}
            <span className="ml-1 text-muted-foreground">({CHARGE_CATEGORIES[c.category as keyof typeof CHARGE_CATEGORIES] || c.category})</span>
            {c.paymentMethod && (
              <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-white border border-orange-200 text-orange-700">
                {c.paymentMethod === 'cash' ? '💵 Cash' : c.paymentMethod === 'mobile_money' ? '📱 MoMo' : '💳 Card'}
              </span>
            )}
          </TableCell>
          <TableCell className="text-xs text-right text-muted-foreground">×{c.quantity} @ {formatGHS(c.unitPrice)}</TableCell>
          <TableCell className="text-right text-xs font-medium text-orange-700">{formatGHS(c.amount)}</TableCell>
          <TableCell colSpan={3} />
        </TableRow>
      ))}
    </>
  )
}

// ─── Past week card ────────────────────────────────────────────────────────────

function PastWeekRow({
  report,
  staffId,
}: {
  report: WeeklyRevenueReport
  staffId: string
}) {
  const [open, setOpen] = useState(false)
  const [result, setResult] = useState<StaffWeekResult | null>(null)
  const [loadingBookings, setLoadingBookings] = useState(false)

  const loadData = useCallback(async () => {
    if (result) return
    setLoadingBookings(true)
    try {
      const r = await fetchBookingsForStaffWeek(staffId, report.weekStart, report.weekEnd)
      setResult(r)
    } catch {
      toast.error('Failed to load bookings')
    } finally {
      setLoadingBookings(false)
    }
  }, [staffId, report.weekStart, report.weekEnd, result])

  const handleOpen = (v: boolean) => {
    setOpen(v)
    if (v) loadData()
  }

  const grandRevenue = result?.grandRevenue ?? report.totalRevenue

  return (
    <Collapsible open={open} onOpenChange={handleOpen}>
      <div className="border rounded-lg overflow-hidden">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/50 transition-colors text-left"
          >
            <div className="flex items-center gap-4 flex-1 min-w-0">
              <span className="font-medium text-sm">{report.weekStart} → {report.weekEnd}</span>
              <StatusBadge status={report.status as WeeklyRevenueReport['status']} />
            </div>
            <div className="flex items-center gap-6 flex-shrink-0">
              <span className="text-sm text-muted-foreground">{report.bookingCount} booking{report.bookingCount !== 1 ? 's' : ''}</span>
              <span className="font-semibold text-sm">{formatGHS(grandRevenue)}</span>
              <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
            </div>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="border-t px-4 py-3 bg-muted/20">
            {report.adminNotes && (
              <div className="mb-3 p-3 bg-green-50 border border-green-200 rounded-md text-sm text-green-800">
                <span className="font-semibold">Admin feedback: </span>{report.adminNotes}
              </div>
            )}
            {report.notes && (
              <div className="mb-3 p-3 bg-blue-50 border border-blue-200 rounded-md text-sm text-blue-800">
                <span className="font-semibold">Your notes: </span>{report.notes}
              </div>
            )}
            {loadingBookings ? (
              <div className="flex items-center gap-2 py-4 text-muted-foreground text-sm">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading bookings…
              </div>
            ) : !result || result.bookings.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">No bookings found for this week.</p>
            ) : (
              <BookingBreakdown result={result} />
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}

// ─── Booking breakdown section (shared between current week and past weeks) ───

function BookingBreakdown({ result, onDeleteSale }: { result: StaffWeekResult; onDeleteSale?: (id: string) => void }) {
  const { bookings, chargesByCategory, standaloneSales, standaloneSalesRevenue, orphanCharges = [], orphanChargesTotal = 0 } = result

  // Category summary for charges
  const chargeCatEntries = Object.entries(chargesByCategory).filter(([, v]) => v > 0)

  return (
    <div className="space-y-4">
      {/* Charges category summary */}
      {chargeCatEntries.length > 0 && (
        <div className="rounded-xl border bg-orange-50/60 p-3">
          <p className="text-xs font-semibold text-orange-800 uppercase tracking-wide mb-2">Additional Charges Breakdown</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {chargeCatEntries.map(([cat, total]) => (
              <div key={cat} className="rounded-lg bg-white/70 px-3 py-2 border border-orange-100">
                <p className="text-[11px] text-muted-foreground">{CATEGORY_ICONS[cat] || '📦'} {CHARGE_CATEGORIES[cat as keyof typeof CHARGE_CATEGORIES] || cat}</p>
                <p className="text-sm font-bold text-orange-700">{formatGHS(total)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Booking table */}
      <div className="overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Booking ID</TableHead>
              <TableHead>Guest</TableHead>
              <TableHead>Room</TableHead>
              <TableHead>Check-in</TableHead>
              <TableHead>Check-out</TableHead>
              <TableHead className="text-right">Room Rate</TableHead>
              <TableHead className="text-right">Charges</TableHead>
              <TableHead className="text-right">Grand Total</TableHead>
              <TableHead>Payment</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {bookings.map((b) => <BookingRow key={b.id} b={b} />)}
          </TableBody>
        </Table>
      </div>

      {/* Orphan charges — charges added this week on bookings from other periods */}
      {orphanCharges.length > 0 && (
        <div className="rounded-xl border bg-amber-50/60 overflow-hidden">
          <div className="px-4 py-3 bg-amber-100/60 border-b flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-amber-800 uppercase tracking-wide">
                Charges on Earlier Bookings
              </p>
              <p className="text-[11px] text-amber-700 mt-0.5">
                Added this week to bookings checked-in before this period
              </p>
            </div>
            <span className="text-sm font-bold text-amber-800">{formatGHS(orphanChargesTotal)}</span>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Description</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Unit Price</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Payment</TableHead>
                <TableHead>Added</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orphanCharges.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="text-sm">
                    <span className="mr-1">{CATEGORY_ICONS[c.category] || '📦'}</span>
                    {c.description}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {CHARGE_CATEGORIES[c.category as keyof typeof CHARGE_CATEGORIES] || c.category}
                  </TableCell>
                  <TableCell className="text-right text-xs">{c.quantity}</TableCell>
                  <TableCell className="text-right text-xs">{formatGHS(c.unitPrice)}</TableCell>
                  <TableCell className="text-right font-medium text-amber-700">{formatGHS(c.amount)}</TableCell>
                  <TableCell className="text-xs">
                    {c.paymentMethod === 'cash' ? '💵 Cash' : c.paymentMethod === 'mobile_money' ? '📱 MoMo' : c.paymentMethod === 'card' ? '💳 Card' : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {c.createdAt ? format(new Date(c.createdAt), 'MMM d, HH:mm') : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Standalone sales */}
      {standaloneSales.length > 0 && (
        <StandaloneSalesTable sales={standaloneSales} total={standaloneSalesRevenue} onDelete={onDeleteSale} />
      )}
    </div>
  )
}

// ─── Standalone Sales Table ───────────────────────────────────────────────────

function StandaloneSalesTable({
  sales,
  total,
  onDelete,
}: {
  sales: StandaloneSale[]
  total: number
  onDelete?: (id: string) => void
}) {
  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <div className="px-4 py-3 bg-muted/30 border-b flex items-center justify-between">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
          <ShoppingBag className="w-3.5 h-3.5" /> Standalone Sales
        </p>
        <span className="text-xs font-bold text-emerald-700">{formatGHS(total)}</span>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Description</TableHead>
            <TableHead>Category</TableHead>
            <TableHead className="text-right">Qty</TableHead>
            <TableHead className="text-right">Unit Price</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead>Payment</TableHead>
            <TableHead>Date</TableHead>
            {onDelete && <TableHead />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {sales.map((s) => (
            <TableRow key={s.id}>
              <TableCell className="text-sm">{s.description}</TableCell>
              <TableCell className="text-xs">{CATEGORY_ICONS[s.category] || '📦'} {SALE_CATEGORIES[s.category]}</TableCell>
              <TableCell className="text-right text-xs">{s.quantity}</TableCell>
              <TableCell className="text-right text-xs">{formatGHS(s.unitPrice)}</TableCell>
              <TableCell className="text-right font-medium text-emerald-700">{formatGHS(s.amount)}</TableCell>
              <TableCell className="text-xs">
                {s.paymentMethod === 'cash' ? '💵 Cash' : s.paymentMethod === 'mobile_money' ? '📱 Momo' : '💳 Card'}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">{s.saleDate}</TableCell>
              {onDelete && (
                <TableCell>
                  <button
                    type="button"
                    onClick={() => onDelete(s.id)}
                    className="text-destructive hover:text-destructive/80 p-1 rounded hover:bg-destructive/10"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export function MyRevenuePage() {
  const { userId, staffRecord, loading: roleLoading } = useStaffRole()

  const [currentWeek] = useState<WeekBounds>(() => getWeekBounds())
  const [currentReport, setCurrentReport] = useState<WeeklyRevenueReport | null>(null)
  const [currentResult, setCurrentResult] = useState<StaffWeekResult | null>(null)
  const [pastReports, setPastReports] = useState<WeeklyRevenueReport[]>([])
  const [loading, setLoading] = useState(true)
  const [currentWeekOpen, setCurrentWeekOpen] = useState(false)
  const [loadingCurrentBookings, setLoadingCurrentBookings] = useState(false)

  // Submit dialog
  const [submitOpen, setSubmitOpen] = useState(false)
  const [submitNotes, setSubmitNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Log Sale dialog
  const [logSaleOpen, setLogSaleOpen] = useState(false)

  const load = useCallback(async (uid: string, name: string) => {
    setLoading(true)
    try {
      const [report, history] = await Promise.all([
        getOrCreateWeekReport(uid, name, currentWeek),
        getStaffAllReports(uid),
      ])
      setCurrentReport(report)
      // Filter history to exclude the current week (shown separately)
      setPastReports(history.filter((r) => r.weekStart !== currentWeek.weekStart))
    } catch (err) {
      console.error('[MyRevenuePage] Failed to load:', err)
      toast.error('Failed to load your revenue data')
    } finally {
      setLoading(false)
    }
  }, [currentWeek])

  useEffect(() => {
    if (!roleLoading && userId && staffRecord?.name) {
      load(userId, staffRecord.name)
    }
  }, [roleLoading, userId, staffRecord?.name, load])

  const loadCurrentData = useCallback(async () => {
    if (!userId) return
    setLoadingCurrentBookings(true)
    try {
      const r = await fetchBookingsForStaffWeek(userId, currentWeek.weekStart, currentWeek.weekEnd)
      setCurrentResult(r)
    } catch {
      toast.error('Failed to load bookings')
    } finally {
      setLoadingCurrentBookings(false)
    }
  }, [userId, currentWeek])

  // Auto-refresh every 60s while the current week report is still a draft
  useEffect(() => {
    if (!userId || !staffRecord?.name || currentReport?.status !== 'draft') return
    const refresh = async () => {
      try {
        const report = await getOrCreateWeekReport(userId, staffRecord.name, currentWeek)
        setCurrentReport(report)
        if (currentWeekOpen) {
          const r = await fetchBookingsForStaffWeek(userId, currentWeek.weekStart, currentWeek.weekEnd)
          setCurrentResult(r)
        }
      } catch {
        // silently ignore background refresh errors
      }
    }
    const id = setInterval(refresh, 60_000)
    return () => clearInterval(id)
  }, [userId, staffRecord?.name, currentReport?.status, currentWeek, currentWeekOpen])

  const handleCurrentWeekOpen = (v: boolean) => {
    setCurrentWeekOpen(v)
    if (v) loadCurrentData()
  }

  const handleSubmit = async () => {
    if (!currentReport) return
    setSubmitting(true)
    try {
      await submitWeekReport(currentReport.id, submitNotes)
      setCurrentReport((prev) => prev ? { ...prev, status: 'submitted', notes: submitNotes, submittedAt: new Date().toISOString() } : prev)
      setSubmitOpen(false)
      setSubmitNotes('')
      toast.success('Weekly report submitted successfully!')
    } catch (err) {
      toast.error('Failed to submit report')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDeleteSale = async (id: string) => {
    try {
      await standaloneSalesService.deleteSale(id)
      toast.success('Sale removed')
      loadCurrentData()
    } catch {
      toast.error('Failed to remove sale')
    }
  }

  if (roleLoading || loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    )
  }

  if (!userId) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        Not authenticated.
      </div>
    )
  }

  const isDraft = currentReport?.status === 'draft'
  const isSubmitted = currentReport?.status === 'submitted'
  const isReviewed = currentReport?.status === 'reviewed'

  const roomRevenue = currentResult?.totalRevenue ?? currentReport?.totalRevenue ?? 0
  const addRevenue = currentResult?.additionalRevenue ?? 0
  const salesRevenue = currentResult?.standaloneSalesRevenue ?? 0
  const grandRevenue = currentResult?.grandRevenue ?? roomRevenue

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="p-1.5 rounded-lg bg-primary/10">
              <TrendingUp className="w-5 h-5 text-primary" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">My Weekly Revenue</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Track the revenue you've brought in — one week at a time (Mon–Sun).
          </p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setLogSaleOpen(true)}>
          <Plus className="w-4 h-4" /> Log a Sale
        </Button>
      </div>

      {/* Current week card */}
      <Card className="border-2 border-primary/20">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-primary" />
                Current Week
              </CardTitle>
              <p className="text-sm text-muted-foreground mt-0.5">{currentWeek.label}</p>
            </div>
            {currentReport && <StatusBadge status={currentReport.status as WeeklyRevenueReport['status']} />}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Stats row — 4 cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="relative overflow-hidden rounded-xl border bg-card p-3 shadow-sm">
              <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-blue-400 to-blue-600" />
              <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Room Revenue</p>
              <p className="text-lg font-bold text-blue-700">{formatGHS(roomRevenue)}</p>
            </div>
            <div className="relative overflow-hidden rounded-xl border bg-card p-3 shadow-sm">
              <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-orange-400 to-orange-600" />
              <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Add. Charges</p>
              <p className="text-lg font-bold text-orange-600">{formatGHS(addRevenue)}</p>
            </div>
            <div className="relative overflow-hidden rounded-xl border bg-card p-3 shadow-sm">
              <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-purple-400 to-purple-600" />
              <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Standalone Sales</p>
              <p className="text-lg font-bold text-purple-600">{formatGHS(salesRevenue)}</p>
            </div>
            <div className="relative overflow-hidden rounded-xl border bg-card p-4 shadow-sm">
              <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-emerald-400 to-emerald-600" />
              <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Grand Total</p>
              <p className="text-xl font-bold text-emerald-700">{formatGHS(grandRevenue)}</p>
            </div>
          </div>

          {/* Bookings count stat */}
          <div className="relative overflow-hidden rounded-xl border bg-card p-3 shadow-sm">
            <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-gray-300 to-gray-400" />
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Bookings Created</p>
            <p className="text-xl font-bold">{currentReport?.bookingCount ?? 0}</p>
          </div>

          {/* Payment method breakdown — shown once bookings are loaded */}
          {currentWeekOpen && currentResult && currentResult.bookings.length > 0 && (() => {
            const methods = [
              { key: 'cash',         label: '💵 Cash',         color: '#10b981' },
              { key: 'mobile_money', label: '📱 Mobile Money', color: '#3b82f6' },
              { key: 'card',         label: '💳 Card',          color: '#8b5cf6' },
              { key: 'not_paid',     label: '⏳ Not Paid',      color: '#f59e0b' },
            ]
            const counts = methods.map(m => {
              let count = 0
              let revenue = 0
              for (const b of currentResult.bookings) {
                if (b.paymentSplits && b.paymentSplits.length > 1) {
                  const splitAmt = b.paymentSplits
                    .filter((s: any) => s.method === m.key)
                    .reduce((a: number, s: any) => a + Number(s.amount || 0), 0)
                  if (splitAmt > 0) { count++; revenue += splitAmt }
                } else if (b.paymentMethod === m.key) {
                  count++; revenue += b.effectivePrice
                }
              }
              return { ...m, count, revenue }
            }).filter(m => m.count > 0)
            if (!counts.length) return null
            return (
              <div className="rounded-xl border bg-card p-4 shadow-sm">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Payment Method Breakdown</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {counts.map(m => (
                    <div key={m.key} className="rounded-lg bg-muted/30 px-3 py-2">
                      <p className="text-[11px] text-muted-foreground">{m.label}</p>
                      <p className="text-base font-bold">{m.count} <span className="text-xs font-normal text-muted-foreground">booking{m.count !== 1 ? 's' : ''}</span></p>
                      <p className="text-xs font-medium" style={{ color: m.color }}>{formatGHS(m.revenue)}</p>
                    </div>
                  ))}
                </div>
              </div>
            )
          })()}

          {/* Status info */}
          {isSubmitted && (
            <div className="flex items-center gap-2 text-sm text-blue-700 bg-blue-50 border border-blue-200 rounded-md px-3 py-2">
              <Clock className="w-4 h-4 flex-shrink-0" />
              <span>Report submitted{currentReport?.submittedAt ? ` on ${format(new Date(currentReport.submittedAt), 'MMM d, yyyy')}` : ''}. Awaiting admin review.</span>
            </div>
          )}
          {isReviewed && (
            <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-md px-3 py-2">
              <CheckCircle className="w-4 h-4 flex-shrink-0" />
              <span>Reviewed by admin.{currentReport?.adminNotes ? ` Feedback: "${currentReport.adminNotes}"` : ''}</span>
            </div>
          )}
          {isDraft && currentReport && currentReport.bookingCount > 0 && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/30 rounded-md px-3 py-2">
              <Eye className="w-4 h-4 flex-shrink-0" />
              <span>Live — updates automatically as you add bookings this week.</span>
            </div>
          )}

          {/* Booking breakdown (collapsible) */}
          {currentReport && (currentReport.bookingCount > 0 || (currentResult?.standaloneSales?.length ?? 0) > 0) && (
            <Collapsible open={currentWeekOpen} onOpenChange={handleCurrentWeekOpen}>
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="flex items-center gap-2 text-sm text-primary hover:underline"
                >
                  <BookOpen className="w-4 h-4" />
                  {currentWeekOpen ? 'Hide' : 'Show'} full breakdown
                  <ChevronDown className={`w-4 h-4 transition-transform ${currentWeekOpen ? 'rotate-180' : ''}`} />
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="mt-3">
                  {loadingCurrentBookings ? (
                    <div className="flex items-center gap-2 py-4 text-muted-foreground text-sm">
                      <Loader2 className="w-4 h-4 animate-spin" /> Loading…
                    </div>
                  ) : currentResult ? (
                    <BookingBreakdown result={currentResult} onDeleteSale={handleDeleteSale} />
                  ) : null}
                </div>
              </CollapsibleContent>
            </Collapsible>
          )}

          {/* Submit action */}
          {isDraft && (
            <div className="pt-2 border-t">
              <Button
                onClick={() => setSubmitOpen(true)}
                disabled={!currentReport || currentReport.bookingCount === 0}
                className="gap-2"
              >
                <Send className="w-4 h-4" />
                Submit Weekly Report
              </Button>
              {currentReport?.bookingCount === 0 && (
                <p className="text-xs text-muted-foreground mt-1">
                  You haven't created any bookings this week yet.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Past weeks */}
      {pastReports.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Previous Weeks
          </h3>
          <div className="space-y-2">
            {pastReports.map((r) => (
              <PastWeekRow key={r.id} report={r} staffId={userId} />
            ))}
          </div>
        </div>
      )}

      {pastReports.length === 0 && !loading && (
        <div className="text-center py-12 text-muted-foreground text-sm">
          No previous week reports yet. Keep creating bookings — your history will appear here.
        </div>
      )}

      {/* Submit dialog */}
      <Dialog open={submitOpen} onOpenChange={setSubmitOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Submit Weekly Report</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="bg-muted/40 rounded-lg p-4 space-y-1">
              <p className="text-sm font-medium">Week: <span className="font-normal">{currentWeek.label}</span></p>
              <p className="text-sm font-medium">Room Revenue: <span className="font-normal text-blue-700">{formatGHS(roomRevenue)}</span></p>
              {addRevenue > 0 && <p className="text-sm font-medium">Additional Charges: <span className="font-normal text-orange-600">{formatGHS(addRevenue)}</span></p>}
              {salesRevenue > 0 && <p className="text-sm font-medium">Standalone Sales: <span className="font-normal text-purple-600">{formatGHS(salesRevenue)}</span></p>}
              <p className="text-sm font-medium">Grand Total: <span className="font-normal text-emerald-700 font-semibold">{formatGHS(grandRevenue)}</span></p>
              <p className="text-sm font-medium">Bookings: <span className="font-normal">{currentReport?.bookingCount ?? 0}</span></p>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Notes (optional)</label>
              <Textarea
                placeholder="Add any notes about this week's performance…"
                value={submitNotes}
                onChange={(e) => setSubmitNotes(e.target.value)}
                rows={3}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Once submitted, this report will be locked and sent to your admin for review.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSubmitOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={submitting} className="gap-2">
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Submit Report
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Log Sale dialog */}
      {userId && staffRecord && (
        <LogSaleDialog
          open={logSaleOpen}
          onOpenChange={setLogSaleOpen}
          staffId={userId}
          staffName={staffRecord.name}
          onSuccess={() => {
            loadCurrentData()
            if (!currentWeekOpen) setCurrentWeekOpen(true)
          }}
        />
      )}
    </div>
  )
}
