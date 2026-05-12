/**
 * Admin reports — attendance summarized by Day / Week / Month / Quarter /
 * Year / Custom.
 *
 * Backed by `get_attendance_report` RPC for server-side aggregation, so even
 * a year-long range stays cheap.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  format, startOfWeek, endOfWeek,
  startOfMonth, endOfMonth,
  startOfQuarter, endOfQuarter,
  startOfYear, endOfYear,
  addDays, addWeeks, addMonths, addQuarters, addYears,
} from 'date-fns'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ChevronLeft, ChevronRight, Download, BarChart3, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  getAttendanceReport,
  type AttendanceReport,
} from '@/services/attendance-service'
import { useSubscription } from '@/hooks/use-subscription'

type Period = 'day' | 'week' | 'month' | 'quarter' | 'year' | 'custom'

export function ReportsPanel() {
  const [period, setPeriod] = useState<Period>('week')
  const [anchor, setAnchor] = useState<Date>(new Date())
  const [customStart, setCustomStart] = useState<string>('')
  const [customEnd, setCustomEnd] = useState<string>('')
  const [report, setReport] = useState<AttendanceReport | null>(null)
  const [loading, setLoading] = useState(false)

  const { start, end } = useMemo(
    () => rangeFor(period, anchor, customStart, customEnd),
    [period, anchor, customStart, customEnd]
  )

  const refresh = useCallback(async () => {
    if (!start || !end) return
    setLoading(true)
    try {
      setReport(await getAttendanceReport(start, end))
    } catch {
      setReport(null)
      toast.error('Failed to load report.')
    } finally {
      setLoading(false)
    }
  }, [start, end])

  const updatedAt = useSubscription('hr_attendance')
  useEffect(() => { refresh() }, [refresh, updatedAt])

  const shift = (dir: -1 | 1) => {
    if (period === 'custom') return
    setAnchor((d) => {
      switch (period) {
        case 'day':     return addDays(d, dir)
        case 'week':    return addWeeks(d, dir)
        case 'month':   return addMonths(d, dir)
        case 'quarter': return addQuarters(d, dir)
        case 'year':    return addYears(d, dir)
        default:        return d
      }
    })
  }

  const handleExport = () => {
    if (!report || !start || !end) return
    const rows = [
      ['Staff', 'Days', 'Hours', 'Late', 'Avg per day'].join(','),
      ...report.per_staff.map(s => [
        `"${s.name}"`, s.days, s.hours, s.late, s.avg_per_day ?? '',
      ].join(',')),
    ].join('\n')
    const blob = new Blob([rows], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `attendance_report_${start}_to_${end}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="border rounded-xl overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 bg-muted/30 border-b">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-primary" />
          <h3 className="font-semibold text-sm">Reports</h3>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {(['day', 'week', 'month', 'quarter', 'year', 'custom'] as Period[]).map(p => (
            <Button
              key={p}
              variant={period === p ? 'default' : 'outline'}
              size="sm"
              className="h-7 capitalize text-xs"
              onClick={() => setPeriod(p)}
            >
              {p}
            </Button>
          ))}
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 ml-1"
            onClick={handleExport}
            disabled={!report}
          >
            <Download className="w-3.5 h-3.5" /> Export
          </Button>
        </div>
      </div>

      <div className="px-4 py-3 flex flex-wrap items-center gap-2 border-b bg-background">
        {period === 'custom' ? (
          <>
            <Input
              type="date"
              value={customStart}
              onChange={e => setCustomStart(e.target.value)}
              className="h-8 w-auto"
            />
            <span className="text-xs text-muted-foreground">to</span>
            <Input
              type="date"
              value={customEnd}
              onChange={e => setCustomEnd(e.target.value)}
              className="h-8 w-auto"
            />
          </>
        ) : (
          <>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => shift(-1)}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="text-sm font-medium flex-1 text-center">{labelFor(period, anchor)}</span>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => shift(1)}>
              <ChevronRight className="w-4 h-4" />
            </Button>
          </>
        )}
      </div>

      <div className="p-4 space-y-4">
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : !report ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            Pick a range to see the report.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              <StatTile label="Hours" value={report.totals.hours} />
              <StatTile label="Days" value={report.totals.present_days} />
              <StatTile label="Late" value={report.totals.late} />
              <StatTile label="Absent" value={report.totals.absent} />
              <StatTile label="Overrides" value={report.totals.overrides} />
            </div>

            <div className="rounded-lg border overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr>
                    {['Staff', 'Days', 'Hours', 'Late', 'Avg/day'].map(h => (
                      <th
                        key={h}
                        className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {report.per_staff.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-3 py-6 text-center text-xs text-muted-foreground">
                        No records in this range.
                      </td>
                    </tr>
                  )}
                  {report.per_staff.map(s => (
                    <tr key={s.staff_id}>
                      <td className="px-3 py-2 font-medium">{s.name}</td>
                      <td className="px-3 py-2">{s.days}</td>
                      <td className="px-3 py-2">{s.hours}h</td>
                      <td className="px-3 py-2">{s.late}</td>
                      <td className="px-3 py-2">{s.avg_per_day != null ? `${s.avg_per_day}h` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function StatTile({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border p-3 bg-card">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">{label}</p>
      <p className="text-xl font-bold">{value}</p>
    </div>
  )
}

function rangeFor(
  period: Period,
  anchor: Date,
  customStart: string,
  customEnd: string
): { start: string; end: string } {
  const iso = (d: Date) => format(d, 'yyyy-MM-dd')
  switch (period) {
    case 'day':
      return { start: iso(anchor), end: iso(anchor) }
    case 'week':
      return {
        start: iso(startOfWeek(anchor, { weekStartsOn: 1 })),
        end: iso(endOfWeek(anchor, { weekStartsOn: 1 })),
      }
    case 'month':
      return { start: iso(startOfMonth(anchor)), end: iso(endOfMonth(anchor)) }
    case 'quarter':
      return { start: iso(startOfQuarter(anchor)), end: iso(endOfQuarter(anchor)) }
    case 'year':
      return { start: iso(startOfYear(anchor)), end: iso(endOfYear(anchor)) }
    case 'custom':
      return { start: customStart || '', end: customEnd || '' }
  }
}

function labelFor(period: Period, anchor: Date): string {
  switch (period) {
    case 'day':
      return format(anchor, 'EEEE, d MMM yyyy')
    case 'week': {
      const s = startOfWeek(anchor, { weekStartsOn: 1 })
      const e = endOfWeek(anchor, { weekStartsOn: 1 })
      return `${format(s, 'd MMM')} – ${format(e, 'd MMM yyyy')}`
    }
    case 'month':
      return format(anchor, 'MMMM yyyy')
    case 'quarter':
      return `Q${Math.floor(anchor.getMonth() / 3) + 1} ${anchor.getFullYear()}`
    case 'year':
      return String(anchor.getFullYear())
    default:
      return ''
  }
}
