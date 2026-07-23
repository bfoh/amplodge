import { useState, useEffect, useRef, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Loader2, Download, Filter, Search, Calendar, User, FileText, RefreshCw } from 'lucide-react'
import { activityLogService } from '@/services/activity-log-service'
import type { ActivityLog, ActivityAction, EntityType } from '@/types'
import { format } from 'date-fns'
import { safeFormatAny } from '@/lib/safe-date'
import { toast } from 'sonner'
import { db, auth } from '@/lib/db'
import { useSubscription } from '@/hooks/use-subscription'
import { hotelSettingsService } from '@/services/hotel-settings'

export function ActivityLogsPage() {
  const [logs, setLogs] = useState<ActivityLog[]>([])
  const [filteredLogs, setFilteredLogs] = useState<ActivityLog[]>([])
  const [loading, setLoading] = useState(true)
  const logsUpdate = useSubscription('activity_logs')
  const [searchQuery, setSearchQuery] = useState('')
  const [actionFilter, setActionFilter] = useState<ActivityAction | 'all'>('all')
  const [entityTypeFilter, setEntityTypeFilter] = useState<EntityType | 'all'>('all')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [userFilter, setUserFilter] = useState<string>('all')
  const [users, setUsers] = useState<Array<{ id: string; name: string }>>([])
  const [rooms, setRooms] = useState<any[]>([])
  const [bookings, setBookings] = useState<any[]>([])
  const [autoRefresh, setAutoRefresh] = useState(false)
  const refreshIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const loadLogs = useCallback(async () => {
    try {
      setLoading(true)
      const options: any = { limit: 500 }

      if (startDate) options.startDate = new Date(startDate)
      if (endDate) options.endDate = new Date(endDate)
      if (actionFilter !== 'all') options.action = actionFilter
      if (entityTypeFilter !== 'all') options.entityType = entityTypeFilter
      if (userFilter !== 'all') options.userId = userFilter

      const data = await activityLogService.getActivityLogs(options)
      setLogs(data)
      console.log('[ActivityLogsPage] Loaded logs:', data)
      if (data.length > 0) {
        toast.success(`Loaded ${data.length} activity logs`)
      } else {
        console.log('[ActivityLogsPage] No logs found, table might not exist yet')
      }
    } catch (error) {
      console.error('Failed to load activity logs:', error)
      toast.error('Failed to load activity logs')
    } finally {
      setLoading(false)
    }
  }, [actionFilter, entityTypeFilter, startDate, endDate, userFilter])

  async function loadUsers() {
    try {
      const [staffList, guestList, roomList, bookingList] = await Promise.all([
        db.staff.list({ limit: 100 }),
        db.guests.list({ limit: 500 }),
        db.properties.list({ limit: 100 }),
        db.bookings.list({ limit: 500, orderBy: { createdAt: 'desc' } })
      ])
      
      setRooms(roomList)
      setBookings(bookingList)

      const mappedStaff = staffList.map((s: any) => ({
        id: s.userId || s.id,
        name: s.name || s.email || 'Staff member'
      }))

      const mappedGuests = guestList.map((g: any) => ({
        id: g.id,
        name: `Guest: ${g.name || 'Anonymous'}`
      }))

      setUsers([...mappedStaff, ...mappedGuests])
    } catch (error) {
      console.error('Failed to load users/guests/rooms:', error)
    }
  }

  function applyFilters() {
    let filtered = [...logs]

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      filtered = filtered.filter(log => {
        const readableDetails = convertDetailsToReadableMessage(log.details || '').toLowerCase()
        return (
          (log.entityType || '').toLowerCase().includes(query) ||
          (log.action || '').toLowerCase().includes(query) ||
          (log.entityId || '').toLowerCase().includes(query) ||
          readableDetails.includes(query)
        )
      })
    }

    setFilteredLogs(filtered)
  }

  useEffect(() => {
    loadUsers()
  }, [])

  useEffect(() => {
    loadLogs()
  }, [logsUpdate, loadLogs])

  useEffect(() => {
    applyFilters()
  }, [logs, searchQuery])

  // Implement auto-refresh logic
  useEffect(() => {
    if (autoRefresh) {
      refreshIntervalRef.current = setInterval(() => {
        console.log('[ActivityLogsPage] Auto-refreshing logs...')
        loadLogs()
      }, 30000) // 30 seconds
    } else {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current)
        refreshIntervalRef.current = null
      }
    }

    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current)
      }
    }
  }, [autoRefresh, loadLogs])

  // Helper function to resolve userId to user name
  function resolveUserName(userId: string | undefined, details?: any): string {
    // 1. Check if details contains staff info (for "system" logs or misattributed logs)
    if (details) {
      if (details.createdBy && details.createdBy !== 'system') return details.createdBy
      if (details.staffName && details.staffName !== 'system') return details.staffName
      if (details.performedBy && details.performedBy !== 'system') return details.performedBy
      if (details.completedBy && details.completedBy !== 'system') return details.completedBy
    }

    if (!userId || userId === 'system') return 'System'
    if (userId === 'guest') return 'Guest'

    // 2. Try to find in the local users list (hydrated from staff table)
    const user = users.find(u => u.id === userId || (u as any).userId === userId)
    if (user) return user.name

    // 3. Try to resolve guest from bookings if it's a guest-initiated action
    const booking = bookings.find(b => b.guestId === userId)
    if (booking && booking.guestName) return `Guest: ${booking.guestName}`

    // 4. Check if the ID itself looks like an email or human name
    if (typeof userId === 'string' && userId.includes('@')) return userId
    if (typeof userId === 'string' && userId.length < 20 && !userId.includes('-')) return userId // Likely a legacy manual name

    // 5. Final fallback: Return a shortened ID
    if (typeof userId !== 'string') return 'Unknown'
    return userId.length > 20 ? `${userId.slice(0, 8)}...` : userId
  }

  // All test functions removed

  function applyFilters() {
    let filtered = [...logs]

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      filtered = filtered.filter(log => {
        const readableDetails = convertDetailsToReadableMessage(log.details || '').toLowerCase()
        return (
          (log.entityType || '').toLowerCase().includes(query) ||
          (log.action || '').toLowerCase().includes(query) ||
          (log.entityId || '').toLowerCase().includes(query) ||
          readableDetails.includes(query)
        )
      })
    }

    setFilteredLogs(filtered)
  }

  function getActionPillColor(action: ActivityAction): string {
    switch (action) {
      case 'created': return 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
      case 'updated': return 'bg-blue-50 text-blue-700 ring-1 ring-blue-200'
      case 'deleted': return 'bg-red-50 text-red-700 ring-1 ring-red-200'
      case 'checked_in': return 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200'
      case 'checked_out': return 'bg-slate-50 text-slate-700 ring-1 ring-slate-200'
      case 'payment_received': return 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
      case 'cancelled': return 'bg-red-50 text-red-700 ring-1 ring-red-200'
      case 'login': return 'bg-violet-50 text-violet-700 ring-1 ring-violet-200'
      case 'logout': return 'bg-gray-50 text-gray-700 ring-1 ring-gray-200'
      default: return 'bg-gray-50 text-gray-700 ring-1 ring-gray-200'
    }
  }

  function getEntityTypeBadgeColor(entityType: EntityType): string {
    const colors: Record<EntityType, string> = {
      booking: 'bg-blue-100 text-blue-800',
      guest: 'bg-green-100 text-green-800',
      invoice: 'bg-purple-100 text-purple-800',
      staff: 'bg-orange-100 text-orange-800',
      room: 'bg-cyan-100 text-cyan-800',
      room_type: 'bg-teal-100 text-teal-800',
      property: 'bg-indigo-100 text-indigo-800',
      task: 'bg-yellow-100 text-yellow-800',
      contact_message: 'bg-pink-100 text-pink-800',
      payment: 'bg-emerald-100 text-emerald-800',
      report: 'bg-gray-100 text-gray-800',
      settings: 'bg-slate-100 text-slate-800',
      user: 'bg-violet-100 text-violet-800',
      inventory: 'bg-amber-100 text-amber-800',
      housekeeping_task: 'bg-lime-100 text-lime-800',
      employee: 'bg-orange-100 text-orange-800',
      system: 'bg-slate-100 text-slate-800',
      test: 'bg-gray-100 text-gray-800',
      diagnostic: 'bg-rose-100 text-rose-800',
      attendance: 'bg-sky-100 text-sky-800',
    }
    return colors[entityType] || 'bg-gray-100 text-gray-800'
  }

  function formatDetails(details: Record<string, any>) {
    // Convert details to human-readable message
    const readableMessage = convertDetailsToReadableMessage(details)

    return (
      <div className="space-y-1 text-xs max-w-md">
        <div className="text-foreground leading-relaxed">
          {readableMessage}
        </div>
      </div>
    )
  }

  function convertDetailsToReadableMessage(details: Record<string, any>): string {
    if (!details) return 'No details available'

    // Create a local copy to enrich without mutating the original log
    const enrichedDetails = { ...details }

    // Enrich with booking data if bookingId exists
    if (enrichedDetails.bookingId) {
      const booking = bookings.find(b => b.id === enrichedDetails.bookingId)
      if (booking) {
        if (!enrichedDetails.guestName) enrichedDetails.guestName = booking.guestName
        if (!enrichedDetails.roomNumber) {
          const room = rooms.find(r => r.id === booking.roomId)
          enrichedDetails.roomNumber = room?.roomNumber || room?.room_number || booking.roomNumber
        }
        if (!enrichedDetails.amount && booking.totalPrice) enrichedDetails.amount = booking.totalPrice
      }
    }

    // Enrich with room number if missing but roomId exists
    if (!enrichedDetails.roomNumber && enrichedDetails.roomId) {
      const room = rooms.find(r => r.id === enrichedDetails.roomId)
      if (room) enrichedDetails.roomNumber = room.roomNumber || room.room_number
    }

    // Use enrichedDetails for all subsequent logic
    const d = enrichedDetails

    // 1. Booking-related details
    if (d.guestName || d.roomNumber) {
      const parts = []
      if (d.guestName) parts.push(`Guest: ${d.guestName}`)
      if (d.roomNumber) parts.push(`Room: ${d.roomNumber}${d.roomType ? ` (${d.roomType})` : ''}`)
      if (d.checkIn && d.checkOut) parts.push(`Stay: ${d.checkIn} to ${d.checkOut}`)
      if (d.amount) parts.push(`Amount: GHS ${d.amount}`)
      if (d.status) parts.push(`Status: ${d.status}`)
      if (d.reason) parts.push(`Reason: ${d.reason}`)
      return parts.join(' | ') || 'Booking details updated'
    }

    // 2. Financial transactions (Invoices/Payments)
    if (d.invoiceNumber || d.paymentMethod || d.amount || d.totalAmount) {
      const parts = []
      if (d.invoiceNumber) parts.push(`Invoice: ${d.invoiceNumber}`)
      if (d.paymentMethod) parts.push(`via ${d.paymentMethod}`)
      const amt = d.amount || d.totalAmount
      if (amt) parts.push(`Amount: GHS ${amt}`)
      if (d.guestName) parts.push(`for ${d.guestName}`)
      if (d.roomNumber) parts.push(`Room ${d.roomNumber}`)
      if (d.reference) parts.push(`Ref: ${d.reference}`)
      return parts.join(' ') || 'Financial transaction recorded'
    }

    // 3. Authentication details
    if (d.loginAt) return `Logged in at ${new Date(d.loginAt).toLocaleString()}`
    if (d.logoutAt) return `Logged out at ${new Date(d.logoutAt).toLocaleString()}`
    if (d.email && d.role) return `User ${d.email} (${d.role})`

    // 4. Tasks & Maintenance
    if (d.title) {
      const parts = [`Task: ${d.title}`]
      if (d.roomNumber) parts.push(`Room ${d.roomNumber}`)
      if (d.completedBy) parts.push(`by ${d.completedBy}`)
      return parts.join(' ')
    }

    // 5. Staff/Guest basic info
    if (d.name && d.email) {
      const roleText = d.role ? `${d.role.toLowerCase()} ` : ''
      return `Created ${roleText}${d.name} (${d.email})`
    }

    // 6. Generic update changes
    if (d.changes && typeof d.changes === 'object') {
      const changeKeys = Object.keys(d.changes)
      if (changeKeys.length > 0) {
        return `Updated: ${changeKeys.join(', ')}`
      }
    }

    // 7. Generic device/IP info
    if (d.ipAddress && d.ipAddress !== 'unknown') {
      return `Action from IP ${d.ipAddress}`
    }

    // 8. Final fallback: Stringify relevant keys
    const summary = Object.entries(d)
      .filter(([key]) => !['timestamp', 'userId', 'id', 'userAgent', 'bookingId', 'roomId', 'entityId', 'entityType', 'action'].includes(key))
      .map(([key, val]) => {
        if (val === null || val === undefined) return `${key}: N/A`
        if (typeof val === 'object') return `${key}: [Data]`
        return `${key}: ${val}`
      })
      .join(', ')

    return summary || 'Action recorded'
  }

  async function handleExportCSV() {
    try {
      const csv = [
        ['Timestamp', 'Action', 'Entity Type', 'Entity ID', 'User ID', 'Details'].join(','),
        ...filteredLogs.map(log => [
          safeFormatAny(log.createdAt, 'yyyy-MM-dd HH:mm:ss'),
          log.action,
          log.entityType,
          log.entityId,
          log.userId,
          convertDetailsToReadableMessage(log.details).replace(/"/g, '""')
        ].map(field => `"${field}"`).join(','))
      ].join('\n')

      const blob = new Blob([csv], { type: 'text/csv' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `activity-logs-${format(new Date(), 'yyyy-MM-dd-HHmmss')}.csv`
      a.click()
      URL.revokeObjectURL(url)
      toast.success('Activity logs exported successfully')
    } catch (error) {
      console.error('Failed to export logs:', error)
      toast.error('Failed to export logs')
    }
  }

  async function handleExportPDF() {
    try {
      // Create PDF content
      const pdfContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <title>Activity Logs Report</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 20px; }
            h1 { color: #333; text-align: center; margin-bottom: 30px; }
            .report-info { margin-bottom: 20px; font-size: 12px; color: #666; }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            th, td { border: 1px solid #ddd; padding: 8px; text-align: left; font-size: 11px; }
            th { background-color: #f2f2f2; font-weight: bold; }
            tr:nth-child(even) { background-color: #f9f9f9; }
            .timestamp { white-space: nowrap; }
            .details { max-width: 200px; word-wrap: break-word; }
          </style>
        </head>
        <body>
          <h1>Activity Logs Report</h1>
          <div class="report-info">
            <p><strong>Generated:</strong> ${format(new Date(), 'yyyy-MM-dd HH:mm:ss')}</p>
            <p><strong>Total Records:</strong> ${filteredLogs.length}</p>
            <p><strong>Date Range:</strong> ${startDate ? format(new Date(startDate), 'yyyy-MM-dd') : 'All'} to ${endDate ? format(new Date(endDate), 'yyyy-MM-dd') : 'All'}</p>
          </div>
          <table>
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Action</th>
                <th>Entity Type</th>
                <th>Entity ID</th>
                <th>User ID</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              ${filteredLogs.map(log => `
                <tr>
                  <td class="timestamp">${safeFormatAny(log.createdAt, 'yyyy-MM-dd HH:mm:ss')}</td>
                  <td>${log.action}</td>
                  <td>${log.entityType}</td>
                  <td>${log.entityId}</td>
                  <td>${log.userId}</td>
                  <td class="details">${convertDetailsToReadableMessage(log.details)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </body>
        </html>
      `

      // Create blob and download
      const blob = new Blob([pdfContent], { type: 'text/html' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `activity-logs-${format(new Date(), 'yyyy-MM-dd-HHmmss')}.html`
      a.click()
      URL.revokeObjectURL(url)

      // For better PDF generation, we'll create an HTML file that can be printed as PDF
      toast.success('Activity logs exported as HTML (print as PDF)')
    } catch (error) {
      console.error('Failed to export PDF:', error)
      toast.error('Failed to export PDF')
    }
  }

  function handleReset() {
    setSearchQuery('')
    setActionFilter('all')
    setEntityTypeFilter('all')
    setStartDate('')
    setEndDate('')
    setUserFilter('all')
    toast.success('Filters reset')
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="p-1.5 rounded-lg bg-primary/10">
              <FileText className="w-5 h-5 text-primary" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">Activity Logs</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Complete audit trail — {logs.length} total activities
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={loadLogs} variant="outline" size="sm" disabled={loading} className="flex-1 sm:flex-none">
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button onClick={handleExportCSV} variant="outline" size="sm" disabled={filteredLogs.length === 0} className="flex-1 sm:flex-none">
            <Download className="w-4 h-4 mr-2" />
            CSV
          </Button>
          <Button onClick={handleExportPDF} variant="outline" size="sm" disabled={filteredLogs.length === 0} className="flex-1 sm:flex-none">
            <Download className="w-4 h-4 mr-2" />
            PDF
          </Button>
        </div>
      </div>

      {/* Stats Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="relative overflow-hidden rounded-xl border bg-card p-4 shadow-sm">
          <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-blue-400 to-blue-600" />
          <p className="text-xs font-medium text-muted-foreground">Total Activities</p>
          <p className="text-2xl font-bold mt-1">{logs.length}</p>
        </div>
        <div className="relative overflow-hidden rounded-xl border bg-card p-4 shadow-sm">
          <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-violet-400 to-violet-600" />
          <p className="text-xs font-medium text-muted-foreground">Filtered Results</p>
          <p className="text-2xl font-bold mt-1">{filteredLogs.length}</p>
        </div>
        <div className="relative overflow-hidden rounded-xl border bg-card p-4 shadow-sm">
          <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-emerald-400 to-emerald-600" />
          <p className="text-xs font-medium text-muted-foreground">Active Users</p>
          <p className="text-2xl font-bold mt-1">{new Set(logs.map(l => l.userId)).size}</p>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader className="p-4 sm:p-6 pb-2">
          <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
            <Filter className="w-4 h-4" />
            Filters
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 sm:p-6 pt-2">
          <div className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-5">
            {/* Search */}
            <div className="relative lg:col-span-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search logs..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 h-10"
              />
            </div>

            {/* Action Filter */}
            <Select value={actionFilter} onValueChange={(value) => setActionFilter(value as any)}>
              <SelectTrigger className="h-10">
                <SelectValue placeholder="Filter by action" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Actions</SelectItem>
                <SelectItem value="created">Created</SelectItem>
                <SelectItem value="updated">Updated</SelectItem>
                <SelectItem value="deleted">Deleted</SelectItem>
                <SelectItem value="checked_in">Checked In</SelectItem>
                <SelectItem value="checked_out">Checked Out</SelectItem>
                <SelectItem value="payment_received">Payment Received</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
                <SelectItem value="assigned">Assigned</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="login">Login</SelectItem>
                <SelectItem value="logout">Logout</SelectItem>
              </SelectContent>
            </Select>

            {/* Entity Type Filter */}
            <Select value={entityTypeFilter} onValueChange={(value) => setEntityTypeFilter(value as any)}>
              <SelectTrigger className="h-10">
                <SelectValue placeholder="Filter by entity" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="booking">Booking</SelectItem>
                <SelectItem value="guest">Guest</SelectItem>
                <SelectItem value="invoice">Invoice</SelectItem>
                <SelectItem value="staff">Staff</SelectItem>
                <SelectItem value="payment">Payment</SelectItem>
                <SelectItem value="room">Room</SelectItem>
                <SelectItem value="employee">Employee</SelectItem>
                <SelectItem value="task">Task</SelectItem>
              </SelectContent>
            </Select>

            {/* User Filter */}
            <Select value={userFilter} onValueChange={setUserFilter}>
              <SelectTrigger className="h-10">
                <SelectValue placeholder="Filter by user" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Users</SelectItem>
                {users.map(user => (
                  <SelectItem key={user.id} value={user.id}>
                    {user.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Reset Button */}
            <div className="flex gap-2">
              <Button onClick={handleReset} variant="outline" className="flex-1 h-10 px-2 text-xs font-semibold">
                Reset
              </Button>
              <Button
                onClick={() => setAutoRefresh(!autoRefresh)}
                variant={autoRefresh ? 'default' : 'outline'}
                className={`flex-1 h-10 px-2 text-xs font-semibold ${autoRefresh ? 'bg-green-600 hover:bg-green-700 text-white border-green-600' : ''}`}
              >
                {autoRefresh ? 'Live ON' : 'Live OFF'}
              </Button>
            </div>
          </div>

          {/* Date Range */}
          <div className="grid gap-4 md:grid-cols-2 mt-4">
            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-2">
                <Calendar className="w-4 h-4" />
                Start Date
              </label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-2">
                <Calendar className="w-4 h-4" />
                End Date
              </label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Results Summary */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <User className="w-4 h-4" />
        Showing {filteredLogs.length} of {logs.length} activity logs
      </div>

      {/* Desktop Table View */}
      <Card className="hidden md:block">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              <span className="ml-2 text-muted-foreground">Loading activity logs...</span>
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              {searchQuery || actionFilter !== 'all' || entityTypeFilter !== 'all'
                ? 'No activity logs match your filters'
                : 'No activity logs yet'
              }
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground py-3">Timestamp</TableHead>
                    <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground py-3">Action</TableHead>
                    <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground py-3">Entity Type</TableHead>
                    <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground py-3">Entity ID</TableHead>
                    <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground py-3">Details</TableHead>
                    <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground py-3">User</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredLogs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="whitespace-nowrap">
                        <div className="flex flex-col">
                          <span className="text-sm font-medium">
                            {log.createdAt ? format(new Date(log.createdAt), 'MMM d, yyyy') : 'N/A'}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {log.createdAt ? format(new Date(log.createdAt), 'h:mm a') : 'N/A'}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${getActionPillColor(log.action)}`}>
                          {log.action}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${getEntityTypeBadgeColor(log.entityType)}`}>
                          {log.entityType}
                        </span>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {log.entityId?.slice(0, 12) || '---'}...
                      </TableCell>
                      <TableCell>
                        {formatDetails(log.details)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {resolveUserName(log.userId, log.details)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Mobile Card List View */}
      <div className="md:hidden space-y-3 pb-20">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="w-8 h-8 animate-spin mb-2" />
            <p>Loading activity logs...</p>
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground border rounded-xl bg-white/50">
            No activity logs match your filters
          </div>
        ) : (
          filteredLogs.map((log) => (
            <Card key={log.id} className="overflow-hidden border-border/60 shadow-sm">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <div className="flex flex-col">
                    <span className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground">
                      {log.createdAt ? format(new Date(log.createdAt), 'MMM d, yyyy • h:mm a') : 'N/A'}
                    </span>
                    <div className="flex flex-wrap gap-2 mt-1.5">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-tight ${getActionPillColor(log.action)}`}>
                        {log.action}
                      </span>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-tight ${getEntityTypeBadgeColor(log.entityType)}`}>
                        {log.entityType}
                      </span>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-[11px] font-medium text-primary bg-primary/5 px-2 py-1 rounded-md">
                      {resolveUserName(log.userId, log.details)}
                    </span>
                  </div>
                </div>
                
                <div className="bg-muted/30 rounded-lg p-3 text-[13px] leading-relaxed border border-border/40">
                  {convertDetailsToReadableMessage(log.details)}
                </div>
                
                <div className="flex items-center justify-between text-[10px] text-muted-foreground font-mono bg-stone-50 px-2 py-1 rounded">
                  <span>REF: {log.id?.slice(0, 8) || '---'}</span>
                  <span>ENT: {log.entityId?.slice(0, 8) || '---'}</span>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

    </div>
  )
}

