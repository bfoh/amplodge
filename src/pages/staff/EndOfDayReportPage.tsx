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
            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="relative overflow-hidden rounded-xl border bg-card p-5 shadow-sm">
                <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 via-transparent to-transparent pointer-events-none" />
                <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-blue-400 to-blue-600" />
                <p className="text-sm font-medium text-muted-foreground mb-2">Total Bookings</p>
                <div className="text-3xl font-bold">{report.totalBookings}</div>
                <p className="text-xs text-muted-foreground mt-1">{report.confirmedBookings} confirmed</p>
              </div>

              <div className="relative overflow-hidden rounded-xl border bg-card p-5 shadow-sm">
                <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 via-transparent to-transparent pointer-events-none" />
                <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-emerald-400 to-emerald-600" />
                <p className="text-sm font-medium text-muted-foreground mb-2">Total Revenue</p>
                <div className="text-3xl font-bold text-emerald-700">{formatCurrencySync(report.totalRevenue, currency)}</div>
                <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1">
                  <TrendingUp className="h-3 w-3" />
                  From confirmed bookings
                </p>
              </div>

              <div className="relative overflow-hidden rounded-xl border bg-card p-5 shadow-sm">
                <div className="absolute inset-0 bg-gradient-to-br from-red-500/5 via-transparent to-transparent pointer-events-none" />
                <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-red-400 to-red-600" />
                <p className="text-sm font-medium text-muted-foreground mb-2">Cancellations</p>
                <div className="text-3xl font-bold text-red-600">{report.cancelledBookings}</div>
                <p className="text-xs text-muted-foreground mt-1">
                  {report.totalBookings > 0
                    ? `${((report.cancelledBookings / report.totalBookings) * 100).toFixed(1)}% rate`
                    : '0% rate'}
                </p>
              </div>

              <div className="relative overflow-hidden rounded-xl border bg-card p-5 shadow-sm">
                <div className="absolute inset-0 bg-gradient-to-br from-slate-500/5 via-transparent to-transparent pointer-events-none" />
                <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-slate-400 to-slate-600" />
                <p className="text-sm font-medium text-muted-foreground mb-2">System Status</p>
                <div className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span>Pending Sync:</span>
                    <span className="font-semibold">{report.pendingSyncs}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Conflicts:</span>
                    <span className="font-semibold text-red-600">{report.conflicts}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Payment Breakdown */}
            <Card>
              <CardHeader>
                <CardTitle>Payment Breakdown</CardTitle>
                <CardDescription>Revenue by payment method</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex items-center justify-between p-4 border rounded-lg">
                    <div>
                      <p className="font-medium">Cash</p>
                      <p className="text-sm text-muted-foreground">Physical currency payments</p>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-bold text-primary">{formatCurrencySync(report.payments.cash, currency)}</p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between p-4 border rounded-lg">
                    <div>
                      <p className="font-medium">Mobile Money</p>
                      <p className="text-sm text-muted-foreground">Digital wallet payments</p>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-bold text-primary">{formatCurrencySync(report.payments.mobileMoney, currency)}</p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between p-4 border rounded-lg">
                    <div>
                      <p className="font-medium">Card</p>
                      <p className="text-sm text-muted-foreground">Credit/Debit card payments</p>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-bold text-primary">{formatCurrencySync(report.payments.card, currency)}</p>
                    </div>
                  </div>
                </div>

                <div className="mt-6 pt-6 border-t">
                  <div className="flex items-center justify-between">
                    <p className="text-lg font-semibold">Total Payments</p>
                    <p className="text-3xl font-bold text-primary">
                      {formatCurrencySync(report.payments.cash + report.payments.mobileMoney + report.payments.card, currency)}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

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
