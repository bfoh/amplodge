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
import { Loader2, TrendingUp, BookOpen, ChevronDown, Send, CheckCircle, Clock, Eye } from 'lucide-react'
import { toast } from 'sonner'
import { useStaffRole } from '@/hooks/use-staff-role'
import {
  getWeekBounds,
  getPastWeeksBounds,
  getOrCreateWeekReport,
  getStaffAllReports,
  fetchBookingsForStaffWeek,
  submitWeekReport,
  type WeeklyRevenueReport,
  type WeekBounds,
  type BookingSummary,
} from '@/services/revenue-service'
import { format } from 'date-fns'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatGHS(amount: number) {
  return `GHS ${amount.toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function StatusBadge({ status }: { status: WeeklyRevenueReport['status'] | 'init' }) {
  if (status === 'reviewed') return <Badge className="bg-green-100 text-green-800 border-green-200">Reviewed</Badge>
  if (status === 'submitted') return <Badge className="bg-blue-100 text-blue-800 border-blue-200">Submitted</Badge>
  return <Badge variant="outline" className="text-muted-foreground">Draft</Badge>
}

// ─── Booking breakdown row ─────────────────────────────────────────────────────

function BookingRow({ b }: { b: BookingSummary }) {
  return (
    <TableRow>
      <TableCell className="font-mono text-xs">{b.id.slice(0, 8)}…</TableCell>
      <TableCell>{b.guestName}</TableCell>
      <TableCell>{b.roomNumber}</TableCell>
      <TableCell>{b.checkIn}</TableCell>
      <TableCell>{b.checkOut}</TableCell>
      <TableCell className="text-right font-medium">{formatGHS(b.totalPrice)}</TableCell>
      <TableCell>
        <Badge variant="outline" className="text-xs capitalize">{b.status}</Badge>
      </TableCell>
    </TableRow>
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
  const [bookings, setBookings] = useState<BookingSummary[]>([])
  const [loadingBookings, setLoadingBookings] = useState(false)

  const loadBookings = useCallback(async () => {
    if (bookings.length > 0) return
    setLoadingBookings(true)
    try {
      const { bookings: bks } = await fetchBookingsForStaffWeek(staffId, report.weekStart, report.weekEnd)
      setBookings(bks)
    } catch {
      toast.error('Failed to load bookings')
    } finally {
      setLoadingBookings(false)
    }
  }, [staffId, report.weekStart, report.weekEnd, bookings.length])

  const handleOpen = (v: boolean) => {
    setOpen(v)
    if (v) loadBookings()
  }

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
              <span className="font-semibold text-sm">{formatGHS(report.totalRevenue)}</span>
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
            ) : bookings.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">No bookings found for this week.</p>
            ) : (
              <div className="overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Booking ID</TableHead>
                      <TableHead>Guest</TableHead>
                      <TableHead>Room</TableHead>
                      <TableHead>Check-in</TableHead>
                      <TableHead>Check-out</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {bookings.map((b) => <BookingRow key={b.id} b={b} />)}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export function MyRevenuePage() {
  const { userId, staffRecord, loading: roleLoading } = useStaffRole()

  const [currentWeek] = useState<WeekBounds>(() => getWeekBounds())
  const [currentReport, setCurrentReport] = useState<WeeklyRevenueReport | null>(null)
  const [currentBookings, setCurrentBookings] = useState<BookingSummary[]>([])
  const [pastReports, setPastReports] = useState<WeeklyRevenueReport[]>([])
  const [loading, setLoading] = useState(true)
  const [currentWeekOpen, setCurrentWeekOpen] = useState(false)
  const [currentWeekBookingsLoaded, setCurrentWeekBookingsLoaded] = useState(false)
  const [loadingCurrentBookings, setLoadingCurrentBookings] = useState(false)

  // Submit dialog
  const [submitOpen, setSubmitOpen] = useState(false)
  const [submitNotes, setSubmitNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)

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

  const loadCurrentBookings = useCallback(async () => {
    if (!userId || currentWeekBookingsLoaded) return
    setLoadingCurrentBookings(true)
    try {
      const { bookings } = await fetchBookingsForStaffWeek(userId, currentWeek.weekStart, currentWeek.weekEnd)
      setCurrentBookings(bookings)
      setCurrentWeekBookingsLoaded(true)
    } catch {
      toast.error('Failed to load bookings')
    } finally {
      setLoadingCurrentBookings(false)
    }
  }, [userId, currentWeek, currentWeekBookingsLoaded])

  const handleCurrentWeekOpen = (v: boolean) => {
    setCurrentWeekOpen(v)
    if (v) loadCurrentBookings()
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

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Page header */}
      <div>
        <h2 className="text-xl font-bold">My Weekly Revenue</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Track the revenue you've brought in — one week at a time (Mon–Sun).
        </p>
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
          {/* Stats row */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-muted/40 rounded-lg px-4 py-3">
              <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Total Revenue</p>
              <p className="text-2xl font-bold text-primary">
                {formatGHS(currentReport?.totalRevenue ?? 0)}
              </p>
            </div>
            <div className="bg-muted/40 rounded-lg px-4 py-3">
              <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Bookings Created</p>
              <p className="text-2xl font-bold">
                {currentReport?.bookingCount ?? 0}
              </p>
            </div>
          </div>

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
          {currentReport && currentReport.bookingCount > 0 && (
            <Collapsible open={currentWeekOpen} onOpenChange={handleCurrentWeekOpen}>
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="flex items-center gap-2 text-sm text-primary hover:underline"
                >
                  <BookOpen className="w-4 h-4" />
                  {currentWeekOpen ? 'Hide' : 'Show'} booking breakdown
                  <ChevronDown className={`w-4 h-4 transition-transform ${currentWeekOpen ? 'rotate-180' : ''}`} />
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="mt-3 overflow-auto">
                  {loadingCurrentBookings ? (
                    <div className="flex items-center gap-2 py-4 text-muted-foreground text-sm">
                      <Loader2 className="w-4 h-4 animate-spin" /> Loading…
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Booking ID</TableHead>
                          <TableHead>Guest</TableHead>
                          <TableHead>Room</TableHead>
                          <TableHead>Check-in</TableHead>
                          <TableHead>Check-out</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {currentBookings.map((b) => <BookingRow key={b.id} b={b} />)}
                      </TableBody>
                    </Table>
                  )}
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
              <p className="text-sm font-medium">Revenue: <span className="font-normal text-primary">{formatGHS(currentReport?.totalRevenue ?? 0)}</span></p>
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
    </div>
  )
}
