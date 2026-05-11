import { useEffect, useState } from 'react'
import { bookingEngine } from '@/services/booking-engine'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { CalendarIcon, Download, TrendingUp } from 'lucide-react'
import { format } from 'date-fns'
import { formatCurrencySync } from '@/lib/utils'
import { useCurrency } from '@/hooks/use-currency'

export function EndOfDayReportPage() {
  const { currency } = useCurrency()
  const [selectedDate, setSelectedDate] = useState<Date>(new Date())
  const [report, setReport] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    loadReport()
  }, [selectedDate])

  const loadReport = async () => {
    setLoading(true)
    try {
      const reportData = await bookingEngine.getEndOfDayReport(selectedDate.toISOString())
      setReport(reportData)
    } catch (error) {
      console.error('Failed to load report:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleExport = () => {
    if (!report) return

    const csv = `AMP Lodge - End of Day Report
Date: ${format(selectedDate, 'MMMM dd, yyyy')}

Summary
Total Bookings,${report.totalBookings}
Confirmed Bookings,${report.confirmedBookings}
Cancelled Bookings,${report.cancelledBookings}
Total Revenue,${report.totalRevenue}

Payments
Cash,${report.payments.cash}
Mobile Money,${report.payments.mobileMoney}
Card,${report.payments.card}

System Status
Pending Syncs,${report.pendingSyncs}
Conflicts,${report.conflicts}
`

    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `eod-report-${format(selectedDate, 'yyyy-MM-dd')}.csv`
    a.click()
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <div className="p-1.5 rounded-lg bg-primary/10">
                <TrendingUp className="w-5 h-5 text-primary" />
              </div>
              <h1 className="text-2xl font-bold tracking-tight">End of Day Report</h1>
            </div>
            <p className="text-sm text-muted-foreground">Daily business summary and analytics</p>
          </div>
          <div className="flex gap-2">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="flex items-center gap-2">
                  <CalendarIcon className="h-4 w-4" />
                  {format(selectedDate, 'PPP')}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0">
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={(date) => date && setSelectedDate(date)}
                  disabled={(date) => date > new Date()}
                />
              </PopoverContent>
            </Popover>
            <Button onClick={handleExport} className="flex items-center gap-2">
              <Download className="h-4 w-4" />
              Export CSV
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-20">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4" />
            <p className="text-muted-foreground">Loading report...</p>
          </div>
        ) : report ? (
          <div className="space-y-6">
            {/* Summary Cards - Premium Mobile Optimized */}
            <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              <div className="relative overflow-hidden rounded-xl border bg-white p-4 sm:p-5 shadow-sm active:scale-[0.98] transition-all">
                <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 via-transparent to-transparent pointer-events-none" />
                <div className="absolute top-0 left-0 w-full h-1 bg-blue-500" />
                <p className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground mb-1.5">Total Bookings</p>
                <div className="text-2xl font-bold text-stone-800 tabular-nums">{report.totalBookings}</div>
                <p className="text-[10px] text-muted-foreground mt-2 font-medium uppercase tracking-tight">{report.confirmedBookings} confirmed</p>
              </div>

              <div className="relative overflow-hidden rounded-xl border bg-white p-4 sm:p-5 shadow-sm active:scale-[0.98] transition-all">
                <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 via-transparent to-transparent pointer-events-none" />
                <div className="absolute top-0 left-0 w-full h-1 bg-emerald-500" />
                <p className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground mb-1.5">Total Revenue</p>
                <div className="text-xl sm:text-2xl font-bold text-emerald-700 tabular-nums">{formatCurrencySync(report.totalRevenue, currency)}</div>
                <p className="text-[9px] text-emerald-600 mt-2 font-bold uppercase tracking-tighter flex items-center gap-1">
                  <TrendingUp className="h-3 w-3" />
                  Confirmed only
                </p>
              </div>

              <div className="relative overflow-hidden rounded-xl border bg-white p-4 sm:p-5 shadow-sm active:scale-[0.98] transition-all">
                <div className="absolute inset-0 bg-gradient-to-br from-red-500/5 via-transparent to-transparent pointer-events-none" />
                <div className="absolute top-0 left-0 w-full h-1 bg-red-500" />
                <p className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground mb-1.5">Cancellations</p>
                <div className="text-2xl font-bold text-red-600 tabular-nums">{report.cancelledBookings}</div>
                <p className="text-[9px] text-rose-500 mt-2 font-bold uppercase tracking-tighter">
                  {report.totalBookings > 0
                    ? `${((report.cancelledBookings / report.totalBookings) * 100).toFixed(1)}% cancel rate`
                    : '0% cancel rate'}
                </p>
              </div>

              <div className="relative overflow-hidden rounded-xl border bg-white p-4 sm:p-5 shadow-sm active:scale-[0.98] transition-all">
                <div className="absolute inset-0 bg-gradient-to-br from-stone-500/5 via-transparent to-transparent pointer-events-none" />
                <div className="absolute top-0 left-0 w-full h-1 bg-stone-500" />
                <p className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground mb-1.5">System Status</p>
                <div className="space-y-1.5 pt-1">
                  <div className="flex justify-between items-center text-[10px]">
                    <span className="font-medium text-muted-foreground uppercase tracking-tight">Sync</span>
                    <span className="font-bold text-stone-700 tabular-nums">{report.pendingSyncs}</span>
                  </div>
                  <div className="flex justify-between items-center text-[10px]">
                    <span className="font-medium text-muted-foreground uppercase tracking-tight">Conflicts</span>
                    <span className={`font-bold tabular-nums ${report.conflicts > 0 ? 'text-rose-500' : 'text-stone-700'}`}>{report.conflicts}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Payment Breakdown - Premium Mobile Optimized */}
            <div className="bg-white border rounded-xl overflow-hidden shadow-sm">
              <div className="px-5 py-4 border-b bg-stone-50/50">
                <h3 className="font-bold text-base text-stone-800">Payment Breakdown</h3>
                <p className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground">Revenue by method</p>
              </div>
              <div className="p-4 space-y-3">
                {[
                  { label: 'Cash', value: report.payments.cash, desc: 'Physical currency', color: 'blue' },
                  { label: 'Mobile Money', value: report.payments.mobileMoney, desc: 'Digital wallet', color: 'purple' },
                  { label: 'Card', value: report.payments.card, desc: 'Credit/Debit card', color: 'emerald' }
                ].map((item) => (
                  <div key={item.label} className="flex items-center justify-between p-4 rounded-xl border border-stone-100 bg-white active:scale-[0.99] transition-transform shadow-sm">
                    <div className="space-y-0.5">
                      <p className="font-bold text-sm text-stone-800">{item.label}</p>
                      <p className="text-[10px] text-muted-foreground font-medium">{item.desc}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-bold text-primary tabular-nums">{formatCurrencySync(item.value, currency)}</p>
                    </div>
                  </div>
                ))}

                <div className="mt-4 pt-5 border-t border-stone-100">
                  <div className="flex items-center justify-between px-2">
                    <p className="text-sm font-bold text-stone-700 uppercase tracking-widest">Total Daily Revenue</p>
                    <p className="text-2xl font-black text-primary tabular-nums">
                      {formatCurrencySync(report.payments.cash + report.payments.mobileMoney + report.payments.card, currency)}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Alerts */}
            {(report.pendingSyncs > 0 || report.conflicts > 0) && (
              <Card className="border-orange-200 bg-orange-50">
                <CardHeader>
                  <CardTitle className="text-orange-900">Action Required</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {report.pendingSyncs > 0 && (
                    <p className="text-orange-800">
                      ⚠️ {report.pendingSyncs} booking{report.pendingSyncs > 1 ? 's' : ''} pending sync with remote database
                    </p>
                  )}
                  {report.conflicts > 0 && (
                    <p className="text-orange-800">
                      ⚠️ {report.conflicts} booking conflict{report.conflicts > 1 ? 's' : ''} require resolution
                    </p>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        ) : (
          <div className="text-center py-20 text-muted-foreground">
            Select a date to view the report
          </div>
        )}
      </div>
    </div>
  )
}
