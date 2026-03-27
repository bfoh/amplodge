import { useEffect, useState } from 'react'
import { bookingEngine, LocalBooking, AuditLog } from '@/services/booking-engine'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AlertTriangle, CheckCircle, Clock, RefreshCw, Trash2, XCircle, TestTube, Shield } from 'lucide-react'
import { format } from 'date-fns'
import { toast } from 'sonner'
import { formatCurrencySync } from '@/lib/utils'
import { useCurrency } from '@/hooks/use-currency'
import { cleanupTestBookings, getBookingStatistics } from '@/utils/cleanup-test-bookings'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

export function AdminPanelPage() {
  const { currency } = useCurrency()
  const [allBookings, setAllBookings] = useState<LocalBooking[]>([])
  const [pendingBookings, setPendingBookings] = useState<LocalBooking[]>([])
  const [conflictedBookings, setConflictedBookings] = useState<LocalBooking[]>([])
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([])
  const [syncing, setSyncing] = useState(false)
  const [selectedConflict, setSelectedConflict] = useState<{ keep: string; cancel: string } | null>(null)
  const [showClearDialog, setShowClearDialog] = useState(false)
  const [cleaningTestBookings, setCleaningTestBookings] = useState(false)
  const [bookingStats, setBookingStats] = useState<{
    total: number
    byStatus: Record<string, number>
    testBookings: number
  } | null>(null)

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      const [all, pending, conflicts, logs, stats] = await Promise.all([
        bookingEngine.getAllBookings(),
        bookingEngine.getPendingSyncBookings(),
        bookingEngine.getConflictedBookings(),
        bookingEngine.getAuditLogs(50),
        getBookingStatistics()
      ])
      
      setAllBookings(all)
      setPendingBookings(pending)
      setConflictedBookings(conflicts)
      setAuditLogs(logs)
      setBookingStats(stats)
    } catch (error) {
      console.error('Failed to load admin data:', error)
      toast.error('Failed to load data')
    }
  }

  const handleSyncNow = async () => {
    setSyncing(true)
    try {
      await bookingEngine.syncWithRemote()
      toast.success('Sync completed successfully')
      await loadData()
    } catch (error) {
      toast.error('Sync failed. Check your connection.')
    } finally {
      setSyncing(false)
    }
  }

  const handleResolveConflict = async (keepId: string, cancelId: string) => {
    try {
      await bookingEngine.resolveConflict(keepId, cancelId)
      toast.success('Conflict resolved')
      await loadData()
      setSelectedConflict(null)
    } catch (error) {
      toast.error('Failed to resolve conflict')
    }
  }

  const handleClearAllData = async () => {
    try {
      await bookingEngine.clearAllData()
      toast.success('All local data cleared')
      await loadData()
      setShowClearDialog(false)
    } catch (error) {
      toast.error('Failed to clear data')
    }
  }

  const handleCleanupTestBookings = async () => {
    setCleaningTestBookings(true)
    try {
      const result = await cleanupTestBookings()
      
      if (result.identified === 0) {
        toast.success('No test bookings found!')
      } else {
        toast.success(`Cleaned up ${result.deleted} test bookings successfully!`)
        if (result.failed > 0) {
          toast.warning(`${result.failed} bookings failed to delete`)
        }
      }
      
      await loadData() // Reload data to show updated statistics
    } catch (error) {
      console.error('Failed to cleanup test bookings:', error)
      toast.error('Failed to cleanup test bookings')
    } finally {
      setCleaningTestBookings(false)
    }
  }

  const getStatusBadge = (status: LocalBooking['status']) => {
    const configs: Record<string, { icon: any; cls: string }> = {
      reserved:      { icon: Clock,        cls: 'bg-yellow-50 text-yellow-700 ring-yellow-200' },
      confirmed:     { icon: CheckCircle,  cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
      cancelled:     { icon: XCircle,      cls: 'bg-red-50 text-red-700 ring-red-200' },
      'checked-in':  { icon: CheckCircle,  cls: 'bg-blue-50 text-blue-700 ring-blue-200' },
      'checked-out': { icon: CheckCircle,  cls: 'bg-slate-50 text-slate-700 ring-slate-200' },
    }
    const config = configs[status] || configs.reserved
    const Icon = config.icon
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ring-1 ${config.cls}`}>
        <Icon className="h-3 w-3" />
        {status}
      </span>
    )
  }

  return (
    <div className="min-h-screen pt-20 pb-20 bg-gradient-to-b from-secondary/30 to-secondary/60">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <div className="p-1.5 rounded-lg bg-primary/10">
                <Shield className="w-5 h-5 text-primary" />
              </div>
              <h1 className="text-2xl font-bold tracking-tight">Admin Panel</h1>
            </div>
            <p className="text-sm text-muted-foreground">Manage bookings, sync data, and resolve conflicts</p>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={handleCleanupTestBookings}
              disabled={cleaningTestBookings}
              variant="outline"
              className="flex items-center gap-2"
            >
              <TestTube className={`h-4 w-4 ${cleaningTestBookings ? 'animate-spin' : ''}`} />
              Clean Test Bookings
            </Button>
            <Button
              onClick={handleSyncNow}
              disabled={syncing}
              variant="outline"
              className="flex items-center gap-2"
            >
              <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
              Sync Now
            </Button>
            <Button
              onClick={() => setShowClearDialog(true)}
              variant="destructive"
              className="flex items-center gap-2"
            >
              <Trash2 className="h-4 w-4" />
              Clear All Data
            </Button>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-8">
          <div className="relative overflow-hidden rounded-xl border bg-card p-5 shadow-sm">
            <div className="absolute inset-0 bg-gradient-to-br from-slate-500/5 via-transparent to-transparent pointer-events-none" />
            <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-slate-400 to-slate-600" />
            <div className="flex items-start justify-between mb-3">
              <p className="text-sm font-medium text-muted-foreground">Total Bookings</p>
              <div className="p-2 rounded-lg bg-slate-500/10">
                <CheckCircle className="w-4 h-4 text-slate-600" />
              </div>
            </div>
            <div className="text-2xl font-bold">{allBookings.length}</div>
            <p className="text-xs text-muted-foreground mt-1">All local records</p>
          </div>
          <div className="relative overflow-hidden rounded-xl border bg-card p-5 shadow-sm">
            <div className="absolute inset-0 bg-gradient-to-br from-orange-500/5 via-transparent to-transparent pointer-events-none" />
            <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-orange-400 to-orange-600" />
            <div className="flex items-start justify-between mb-3">
              <p className="text-sm font-medium text-muted-foreground">Test Bookings</p>
              <div className="p-2 rounded-lg bg-orange-500/10">
                <TestTube className="w-4 h-4 text-orange-600" />
              </div>
            </div>
            <div className="text-2xl font-bold">{bookingStats?.testBookings || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">Can be cleaned up</p>
          </div>
          <div className="relative overflow-hidden rounded-xl border bg-card p-5 shadow-sm">
            <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 via-transparent to-transparent pointer-events-none" />
            <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-blue-400 to-blue-600" />
            <div className="flex items-start justify-between mb-3">
              <p className="text-sm font-medium text-muted-foreground">Pending Sync</p>
              <div className="p-2 rounded-lg bg-blue-500/10">
                <RefreshCw className="w-4 h-4 text-blue-600" />
              </div>
            </div>
            <div className="text-2xl font-bold">{pendingBookings.length}</div>
            <p className="text-xs text-muted-foreground mt-1">Awaiting remote sync</p>
          </div>
          <div className="relative overflow-hidden rounded-xl border bg-card p-5 shadow-sm">
            <div className="absolute inset-0 bg-gradient-to-br from-red-500/5 via-transparent to-transparent pointer-events-none" />
            <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-red-400 to-red-600" />
            <div className="flex items-start justify-between mb-3">
              <p className="text-sm font-medium text-muted-foreground">Conflicts</p>
              <div className="p-2 rounded-lg bg-red-500/10">
                <AlertTriangle className="w-4 h-4 text-red-600" />
              </div>
            </div>
            <div className="text-2xl font-bold">{conflictedBookings.length}</div>
            <p className="text-xs text-muted-foreground mt-1">Require resolution</p>
          </div>
          <div className="relative overflow-hidden rounded-xl border bg-card p-5 shadow-sm">
            <div className={`absolute inset-0 bg-gradient-to-br ${navigator.onLine ? 'from-emerald-500/5' : 'from-slate-500/5'} via-transparent to-transparent pointer-events-none`} />
            <div className={`absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r ${navigator.onLine ? 'from-emerald-400 to-emerald-600' : 'from-slate-400 to-slate-600'}`} />
            <div className="flex items-start justify-between mb-3">
              <p className="text-sm font-medium text-muted-foreground">Status</p>
              <div className={`p-2 rounded-lg ${navigator.onLine ? 'bg-emerald-500/10' : 'bg-slate-500/10'}`}>
                <Shield className={`w-4 h-4 ${navigator.onLine ? 'text-emerald-600' : 'text-slate-600'}`} />
              </div>
            </div>
            <div className="text-2xl font-bold">
              {navigator.onLine ? (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">Online</span>
              ) : (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground ring-1 ring-border">Offline</span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Connection state</p>
          </div>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="bookings" className="space-y-6">
          <TabsList>
            <TabsTrigger value="bookings">All Bookings</TabsTrigger>
            <TabsTrigger value="pending">
              Pending Sync
              {pendingBookings.length > 0 && (
                <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-yellow-50 text-yellow-700 ring-1 ring-yellow-200">
                  {pendingBookings.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="conflicts">
              Conflicts
              {conflictedBookings.length > 0 && (
                <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-700 ring-1 ring-red-200">
                  {conflictedBookings.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="logs">Audit Logs</TabsTrigger>
          </TabsList>

          {/* All Bookings */}
          <TabsContent value="bookings">
            <Card>
              <CardHeader>
                <CardTitle>All Bookings</CardTitle>
                <CardDescription>Complete list of all local bookings</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {allBookings.map((booking) => (
                    <div
                      key={booking._id}
                      className="p-4 border rounded-lg bg-white hover:shadow-md transition-shadow"
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <h3 className="font-semibold text-lg">{booking.guest.fullName}</h3>
                          <p className="text-sm text-muted-foreground">{booking.guest.email}</p>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          {getStatusBadge(booking.status)}
                          {booking.conflict && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-700 ring-1 ring-red-200">
                              <AlertTriangle className="h-3 w-3" />
                              Conflict
                            </span>
                          )}
                          {!booking.synced && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground ring-1 ring-border">Not Synced</span>
                          )}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                        <div>
                          <p className="text-muted-foreground">Room</p>
                          <p className="font-medium">{booking.roomNumber}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Check-in</p>
                          <p className="font-medium">{format(new Date(booking.dates.checkIn), 'MMM dd, yyyy')}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Check-out</p>
                          <p className="font-medium">{format(new Date(booking.dates.checkOut), 'MMM dd, yyyy')}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Amount</p>
                          <p className="font-medium text-primary">{formatCurrencySync(booking.amount, currency)}</p>
                        </div>
                      </div>
                      {booking.payment && (
                        <div className="mt-3 p-2 bg-secondary/50 rounded text-sm">
                          <span className="font-medium">Payment:</span> {booking.payment.method} - {booking.payment.status}
                        </div>
                      )}
                    </div>
                  ))}
                  {allBookings.length === 0 && (
                    <div className="text-center py-12 text-muted-foreground">
                      No bookings found
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Pending Sync */}
          <TabsContent value="pending">
            <Card>
              <CardHeader>
                <CardTitle>Pending Sync</CardTitle>
                <CardDescription>Bookings waiting to be synced with remote database</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {pendingBookings.map((booking) => (
                    <div
                      key={booking._id}
                      className="p-4 border border-blue-200 rounded-lg bg-blue-50"
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <h3 className="font-semibold">{booking.guest.fullName}</h3>
                          <p className="text-sm text-muted-foreground">Room {booking.roomNumber}</p>
                        </div>
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-50 text-yellow-700 ring-1 ring-yellow-200">
                          <Clock className="h-3 w-3" />
                          Pending
                        </span>
                      </div>
                      <div className="text-sm text-muted-foreground">
                        Created: {format(new Date(booking.createdAt), 'MMM dd, yyyy HH:mm')}
                      </div>
                    </div>
                  ))}
                  {pendingBookings.length === 0 && (
                    <div className="text-center py-12 text-muted-foreground">
                      <CheckCircle className="h-12 w-12 mx-auto mb-4 text-green-600" />
                      All bookings are synced
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Conflicts */}
          <TabsContent value="conflicts">
            <Card>
              <CardHeader>
                <CardTitle>Booking Conflicts</CardTitle>
                <CardDescription>Resolve overlapping bookings for the same room</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {conflictedBookings.map((booking) => (
                    <div
                      key={booking._id}
                      className="p-4 border border-red-200 rounded-lg bg-red-50"
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <h3 className="font-semibold">{booking.guest.fullName}</h3>
                          <p className="text-sm text-muted-foreground">
                            Room {booking.roomNumber} • {format(new Date(booking.dates.checkIn), 'MMM dd')} - {format(new Date(booking.dates.checkOut), 'MMM dd')}
                          </p>
                        </div>
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-700 ring-1 ring-red-200">
                          <AlertTriangle className="h-3 w-3" />
                          Conflict
                        </span>
                      </div>
                      <div className="flex gap-2 mt-3">
                        <Button
                          size="sm"
                          onClick={() => {
                            const otherConflict = conflictedBookings.find(b => 
                              b._id !== booking._id && 
                              b.roomNumber === booking.roomNumber
                            )
                            if (otherConflict) {
                              setSelectedConflict({ keep: booking._id, cancel: otherConflict._id })
                            }
                          }}
                        >
                          Keep This Booking
                        </Button>
                      </div>
                    </div>
                  ))}
                  {conflictedBookings.length === 0 && (
                    <div className="text-center py-12 text-muted-foreground">
                      <CheckCircle className="h-12 w-12 mx-auto mb-4 text-green-600" />
                      No conflicts detected
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Audit Logs */}
          <TabsContent value="logs">
            <Card>
              <CardHeader>
                <CardTitle>Audit Logs</CardTitle>
                <CardDescription>System activity and change history</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {auditLogs.map((log) => (
                    <div
                      key={log._id}
                      className="p-3 border rounded-lg text-sm bg-white"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{log.action.replace(/_/g, ' ').toUpperCase()}</span>
                        <span className="text-muted-foreground text-xs">
                          {format(new Date(log.timestamp), 'MMM dd, yyyy HH:mm:ss')}
                        </span>
                      </div>
                      <div className="text-muted-foreground mt-1">
                        {log.entityType}: {log.entityId}
                      </div>
                    </div>
                  ))}
                  {auditLogs.length === 0 && (
                    <div className="text-center py-12 text-muted-foreground">
                      No audit logs available
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Conflict Resolution Dialog */}
      {selectedConflict && (
        <AlertDialog open={!!selectedConflict} onOpenChange={() => setSelectedConflict(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Resolve Conflict</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to keep this booking and cancel the conflicting one?
                This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => handleResolveConflict(selectedConflict.keep, selectedConflict.cancel)}
              >
                Resolve Conflict
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      {/* Clear Data Dialog */}
      <AlertDialog open={showClearDialog} onOpenChange={setShowClearDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear All Data</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete all local bookings, rooms, and audit logs.
              Make sure all data is synced before proceeding. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleClearAllData} className="bg-destructive text-destructive-foreground">
              Clear All Data
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
