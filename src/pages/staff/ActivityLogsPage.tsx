import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Loader2, Download, Filter, Search, Calendar, User, FileText, RefreshCw } from 'lucide-react'
import { activityLogService, type ActivityLog, type ActivityAction, type EntityType } from '@/services/activity-log-service'
import { format } from 'date-fns'
import { toast } from 'sonner'
import { blink } from '@/blink/client'
// Removed test utility imports - no longer needed

export function ActivityLogsPage() {
  const [logs, setLogs] = useState<ActivityLog[]>([])
  const [filteredLogs, setFilteredLogs] = useState<ActivityLog[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [actionFilter, setActionFilter] = useState<ActivityAction | 'all'>('all')
  const [entityTypeFilter, setEntityTypeFilter] = useState<EntityType | 'all'>('all')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [userFilter, setUserFilter] = useState<string>('all')
  const [users, setUsers] = useState<Array<{ id: string; name: string }>>([])

  useEffect(() => {
    initializePageDatabase()
  }, [])

  async function initializePageDatabase() {
    try {
      console.log('[ActivityLogsPage] Loading activity logs...')

      // Load existing logs and users
      await loadLogs()
      await loadUsers()

      console.log('[ActivityLogsPage] ✅ Activity logs loaded successfully')

    } catch (error) {
      console.error('[ActivityLogsPage] Failed to load activity logs:', error)
      toast.error('Failed to load activity logs')
    }
  }

  useEffect(() => {
    applyFilters()
  }, [logs, searchQuery, actionFilter, entityTypeFilter, startDate, endDate, userFilter])

  async function loadLogs() {
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
  }

  // Test function removed

  async function loadUsers() {
    try {
      const db = blink.db as any
      const staffList = await db.staff.list({ limit: 100 })
      setUsers(staffList.map((s: any) => ({
        id: s.userId || s.id,
        name: s.name || s.email || 'Unknown User'
      })))
    } catch (error) {
      console.error('Failed to load users:', error)
    }
  }

  // Helper function to resolve userId to user name
  function resolveUserName(userId: string | undefined): string {
    if (!userId || userId === 'system') return 'System'
    if (userId === 'guest') return 'Guest'

    // Try to find in users list
    const user = users.find(u => u.id === userId)
    if (user) return user.name

    // Check if it looks like an email
    if (userId.includes('@')) return userId

    // Otherwise return a shortened version of the ID
    return userId.length > 20 ? `${userId.slice(0, 8)}...` : userId
  }

  // All test functions removed

  function applyFilters() {
    let filtered = [...logs]

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      filtered = filtered.filter(log => {
        const readableDetails = convertDetailsToReadableMessage(log.details).toLowerCase()
        return (
          log.entityType.toLowerCase().includes(query) ||
          log.action.toLowerCase().includes(query) ||
          log.entityId.toLowerCase().includes(query) ||
          readableDetails.includes(query)
        )
      })
    }

    setFilteredLogs(filtered)
  }

  function getActionBadgeVariant(action: ActivityAction): 'default' | 'secondary' | 'destructive' | 'outline' {
    switch (action) {
      case 'created':
        return 'default'
      case 'updated':
        return 'secondary'
      case 'deleted':
        return 'destructive'
      case 'checked_in':
      case 'checked_out':
        return 'outline'
      default:
        return 'outline'
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
    // Handle different types of details and create readable messages
    if (details.guestName && details.roomNumber) {
      // Booking-related details
      const guestName = details.guestName
      const roomNumber = details.roomNumber
      const roomType = details.roomType || 'room'
      const checkIn = details.checkIn
      const checkOut = details.checkOut
      const amount = details.amount
      const status = details.status

      let message = `Guest ${guestName} booked ${roomType} (Room ${roomNumber})`
      if (checkIn && checkOut) {
        message += ` from ${checkIn} to ${checkOut}`
      }
      if (amount) {
        message += ` for GH₵${amount}`
      }
      if (status) {
        message += ` - Status: ${status}`
      }
      return message
    }

    if (details.logoutAt) {
      // Logout details
      const logoutTime = new Date(details.logoutAt).toLocaleString()
      return `Logged out at ${logoutTime}`
    }

    if (details.loginAt) {
      // Login details
      const loginTime = new Date(details.loginAt).toLocaleString()
      return `Logged in at ${loginTime}`
    }

    if (details.email && details.role) {
      // User authentication details
      const email = details.email
      const role = details.role
      return `User ${email} authenticated as ${role}`
    }

    if (details.ipAddress || details.userAgent) {
      // Authentication with device info
      const ipAddress = details.ipAddress
      const userAgent = details.userAgent
      let message = 'Authentication event'
      if (ipAddress && ipAddress !== 'unknown') {
        message += ` from IP ${ipAddress}`
      }
      return message
    }

    if (details.name && details.email) {
      // Guest/Staff creation details
      const name = details.name
      const email = details.email
      const role = details.role

      let message = `Created ${role ? role.toLowerCase() : 'user'} ${name}`
      if (email) {
        message += ` (${email})`
      }
      return message
    }

    if (details.amount && details.method) {
      // Payment details
      const amount = details.amount
      const method = details.method
      const reference = details.reference

      let message = `Payment of GH₵${amount} received via ${method}`
      if (reference) {
        message += ` (Reference: ${reference})`
      }
      return message
    }

    if (details.invoiceNumber) {
      // Invoice details
      const invoiceNumber = details.invoiceNumber
      const totalAmount = details.totalAmount
      const guestName = details.guestName

      let message = `Invoice ${invoiceNumber}`
      if (guestName) {
        message += ` for ${guestName}`
      }
      if (totalAmount) {
        message += ` - Amount: GH₵${totalAmount}`
      }
      return message
    }

    if (details.roomNumber && details.roomType) {
      // Room details
      const roomNumber = details.roomNumber
      const roomType = details.roomType
      const status = details.status

      let message = `Room ${roomNumber} (${roomType})`
      if (status) {
        message += ` - Status: ${status}`
      }
      return message
    }

    if (details.title) {
      // Task details
      const title = details.title
      const roomNumber = details.roomNumber
      const completedBy = details.completedBy

      let message = `Task: ${title}`
      if (roomNumber) {
        message += ` (Room ${roomNumber})`
      }
      if (completedBy) {
        message += ` - Completed by ${completedBy}`
      }
      return message
    }

    if (details.changes) {
      // Update details
      const changes = details.changes
      if (typeof changes === 'object') {
        const changeKeys = Object.keys(changes)
        if (changeKeys.length > 0) {
          return `Updated: ${changeKeys.join(', ')}`
        }
      }
      return 'Updated details'
    }

    if (details.reason) {
      // Cancellation details
      let message = 'Cancelled'
      if (details.guestName) message += ` - ${details.guestName}`
      if (details.roomNumber) message += ` (Room ${details.roomNumber})`
      message += `: ${details.reason}`
      return message
    }

    if (details.message) {
      // Generic message
      return details.message
    }

    // Handle empty or simple details
    if (Object.keys(details).length === 0) {
      return 'No additional details'
    }

    // Handle single key-value pairs
    const entries = Object.entries(details)
    if (entries.length === 1) {
      const [key, value] = entries[0]
      if (typeof value === 'string' || typeof value === 'number') {
        return `${key}: ${value}`
      }
    }

    // Handle timestamp fields
    if (details.timestamp) {
      const timestamp = new Date(details.timestamp).toLocaleString()
      return `Event occurred at ${timestamp}`
    }

    if (details.createdAt) {
      const createdAt = new Date(details.createdAt).toLocaleString()
      return `Created at ${createdAt}`
    }

    // Fallback: create a readable message from available details
    const keyValuePairs = entries
      .slice(0, 3)
      .map(([key, value]) => {
        if (typeof value === 'object') {
          return `${key}: ${JSON.stringify(value)}`
        }
        return `${key}: ${value}`
      })
      .join(', ')

    return keyValuePairs || 'No details available'
  }

  async function handleExportCSV() {
    try {
      const csv = [
        ['Timestamp', 'Action', 'Entity Type', 'Entity ID', 'User ID', 'Details'].join(','),
        ...filteredLogs.map(log => [
          format(new Date(log.createdAt), 'yyyy-MM-dd HH:mm:ss'),
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
                  <td class="timestamp">${format(new Date(log.createdAt), 'yyyy-MM-dd HH:mm:ss')}</td>
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
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold flex items-center gap-2">
            <FileText className="w-8 h-8" />
            Activity Logs
          </h2>
          <p className="text-muted-foreground mt-1">
            Complete audit trail of all user activities in the system
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={loadLogs} variant="outline" disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button onClick={handleExportCSV} variant="outline" disabled={filteredLogs.length === 0}>
            <Download className="w-4 h-4 mr-2" />
            Export CSV
          </Button>
          <Button onClick={handleExportPDF} variant="outline" disabled={filteredLogs.length === 0}>
            <Download className="w-4 h-4 mr-2" />
            Export PDF
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Filter className="w-4 h-4" />
            Filters
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-5">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>

            {/* Action Filter */}
            <Select value={actionFilter} onValueChange={(value) => setActionFilter(value as any)}>
              <SelectTrigger>
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
              <SelectTrigger>
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
                <SelectItem value="task">Task</SelectItem>
              </SelectContent>
            </Select>

            {/* User Filter */}
            <Select value={userFilter} onValueChange={setUserFilter}>
              <SelectTrigger>
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
            <Button onClick={handleReset} variant="outline" className="w-full">
              Reset Filters
            </Button>
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

      {/* Activity Logs Table */}
      <Card>
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
                  <TableRow>
                    <TableHead>Timestamp</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Entity Type</TableHead>
                    <TableHead>Entity ID</TableHead>
                    <TableHead>Details</TableHead>
                    <TableHead>User</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredLogs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="whitespace-nowrap">
                        <div className="flex flex-col">
                          <span className="text-sm font-medium">
                            {format(new Date(log.createdAt), 'MMM d, yyyy')}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {format(new Date(log.createdAt), 'h:mm a')}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={getActionBadgeVariant(log.action)}>
                          {log.action}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge className={getEntityTypeBadgeColor(log.entityType)}>
                          {log.entityType}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {log.entityId.slice(0, 12)}...
                      </TableCell>
                      <TableCell>
                        {formatDetails(log.details)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {resolveUserName(log.userId)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Statistics Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Activities
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{logs.length}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Filtered Results
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{filteredLogs.length}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Active Users
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {new Set(logs.map(l => l.userId)).size}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

