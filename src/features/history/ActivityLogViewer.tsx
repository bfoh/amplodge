import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { blink } from '@/blink/client'
import { Loader2, Search, FileEdit, Trash2, UserPlus, Shield, Clock } from 'lucide-react'
import { format } from 'date-fns'

interface ActivityLog {
  id: string
  userId: string
  action: string
  entityType: string
  entityId: string
  details: string
  createdAt: string
}

interface ActivityLogViewerProps {
  /** Filter logs by entity type */
  entityType?: string
  /** Filter logs by entity ID */
  entityId?: string
  /** Maximum number of logs to display */
  limit?: number
  /** Show search and filters */
  showFilters?: boolean
}

/**
 * Component to view and filter activity logs for audit purposes
 */
export function ActivityLogViewer({
  entityType,
  entityId,
  limit = 50,
  showFilters = true
}: ActivityLogViewerProps) {
  const [logs, setLogs] = useState<ActivityLog[]>([])
  const [filteredLogs, setFilteredLogs] = useState<ActivityLog[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [actionFilter, setActionFilter] = useState<string>('all')

  useEffect(() => {
    loadLogs()
  }, [entityType, entityId])

  useEffect(() => {
    applyFilters()
  }, [logs, searchQuery, actionFilter])

  async function loadLogs() {
    try {
      setIsLoading(true)
      const where: any = {}
      
      if (entityType) where.entityType = entityType
      if (entityId) where.entityId = entityId

      const activityLogs = await blink.db.activityLogs.list({
        where,
        orderBy: { createdAt: 'desc' },
        limit
      })

      setLogs(activityLogs as ActivityLog[])
    } catch (error) {
      console.error('Failed to load activity logs:', error)
    } finally {
      setIsLoading(false)
    }
  }

  function applyFilters() {
    let filtered = [...logs]

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      filtered = filtered.filter(log => {
        try {
          const details = JSON.parse(log.details)
          return (
            log.entityType.toLowerCase().includes(query) ||
            log.action.toLowerCase().includes(query) ||
            JSON.stringify(details).toLowerCase().includes(query)
          )
        } catch {
          return log.entityType.toLowerCase().includes(query) ||
            log.action.toLowerCase().includes(query)
        }
      })
    }

    // Apply action filter
    if (actionFilter !== 'all') {
      filtered = filtered.filter(log => log.action === actionFilter)
    }

    setFilteredLogs(filtered)
  }

  function getActionIcon(action: string) {
    switch (action) {
      case 'created':
        return <UserPlus className="w-4 h-4" />
      case 'edited':
      case 'updated':
        return <FileEdit className="w-4 h-4" />
      case 'deleted':
        return <Trash2 className="w-4 h-4" />
      default:
        return <Shield className="w-4 h-4" />
    }
  }

  function getActionBadgeVariant(action: string): 'default' | 'secondary' | 'destructive' | 'outline' {
    switch (action) {
      case 'created':
        return 'default'
      case 'edited':
      case 'updated':
        return 'secondary'
      case 'deleted':
        return 'destructive'
      default:
        return 'outline'
    }
  }

  function formatDetails(detailsJson: string) {
    try {
      const details = JSON.parse(detailsJson)
      return (
        <div className="space-y-1 text-xs">
          {Object.entries(details).map(([key, value]) => (
            <div key={key}>
              <span className="font-medium">{key}:</span>{' '}
              <span className="text-muted-foreground">
                {typeof value === 'object' ? JSON.stringify(value) : String(value)}
              </span>
            </div>
          ))}
        </div>
      )
    } catch {
      return <span className="text-xs text-muted-foreground">{detailsJson}</span>
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="w-5 h-5" />
            <CardTitle>Activity Log</CardTitle>
          </div>
          {!isLoading && (
            <Badge variant="outline">{filteredLogs.length} entries</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {showFilters && (
          <div className="flex gap-3 mb-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search logs..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={actionFilter} onValueChange={setActionFilter}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Filter by action" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All actions</SelectItem>
                <SelectItem value="created">Created</SelectItem>
                <SelectItem value="edited">Edited</SelectItem>
                <SelectItem value="updated">Updated</SelectItem>
                <SelectItem value="deleted">Deleted</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            <span className="ml-2 text-muted-foreground">Loading activity logs...</span>
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            {searchQuery || actionFilter !== 'all' 
              ? 'No activity logs match your filters'
              : 'No activity logs yet'
            }
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Action</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead>Details</TableHead>
                  <TableHead>Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredLogs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {getActionIcon(log.action)}
                        <Badge variant={getActionBadgeVariant(log.action)}>
                          {log.action}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium">{log.entityType}</span>
                        <span className="text-xs text-muted-foreground">{log.entityId}</span>
                      </div>
                    </TableCell>
                    <TableCell className="max-w-md">
                      {formatDetails(log.details)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      <div className="flex flex-col">
                        <span className="text-sm">
                          {format(new Date(log.createdAt), 'MMM d, yyyy')}
                        </span>
                        <span className="text-xs">
                          {format(new Date(log.createdAt), 'h:mm a')}
                        </span>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

