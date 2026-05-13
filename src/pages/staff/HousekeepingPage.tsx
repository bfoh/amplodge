import { useState, useEffect, useTransition } from 'react'
import { useSubscription } from '@/hooks/use-subscription'
import { motion } from 'framer-motion'
import { Calendar, CheckCircle2, Clock, Search, User, AlertCircle, Trash2, Loader2, Activity, X } from 'lucide-react'
import { callFunction } from '@/lib/api'
import { useStaffRole } from '@/hooks/use-staff-role'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { db, auth } from '@/lib/db'
import { toast } from 'sonner'
import { activityLogService } from '@/services/activity-log-service'
import { format } from 'date-fns'
import { safeFormatAny } from '@/lib/safe-date'
import { sendTaskAssignmentEmail } from '@/services/task-notification-service'

import { housekeepingService } from '@/services/housekeeping-service'
import type { HousekeepingTask, Staff, Room } from '@/types'

export default function HousekeepingPage() {
  const [tasks, setTasks] = useState<HousekeepingTask[]>([])
  const [staff, setStaff] = useState<Staff[]>([])
  const [rooms, setRooms] = useState<Room[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [selectedTask, setSelectedTask] = useState<HousekeepingTask | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [completionNotes, setCompletionNotes] = useState('')
  const [isPending, startTransition] = useTransition()
  // Bulk selection state — Set of task ids that are checked. Bulk action bar
  // renders when size > 0 and offers complete / delete on the whole set.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkConfirm, setBulkConfirm] = useState<'complete' | 'delete' | null>(null)
  const [bulkBusy, setBulkBusy] = useState(false)

  // Notification-diagnostic state
  const { role } = useStaffRole()
  const isAdmin = role === 'admin' || role === 'owner'
  const [diagOpen, setDiagOpen] = useState(false)
  const [diagBusy, setDiagBusy] = useState(false)
  const [diagResult, setDiagResult] = useState<any | null>(null)
  const runDiagnostics = async () => {
    setDiagBusy(true)
    setDiagResult(null)
    try {
      const res = await callFunction('notification-diag', { method: 'GET' })
      const text = await res.text()
      let parsed: any = null
      try { parsed = JSON.parse(text) } catch { /* keep raw */ }
      setDiagResult(parsed ?? { rawStatus: res.status, rawBody: text })
    } catch (e: any) {
      setDiagResult({ networkError: e?.message || 'Network failure' })
    } finally {
      setDiagBusy(false)
    }
  }

  const tasksUpdate = useSubscription('housekeeping_tasks')
  const propertiesUpdate = useSubscription('properties')
  const staffUpdate = useSubscription('staff')

  useEffect(() => {
    loadData()
  }, [tasksUpdate, propertiesUpdate, staffUpdate])

  const loadData = async () => {
    try {
      setLoading(true)

      // Load staff and rooms first (these should always exist)
      const [staffData, roomsData] = await Promise.all([
        db.staff.list().catch((e) => {
          console.warn('Failed to load staff:', e)
          return []
        }),
        db.properties.list().catch((e) => {
          console.warn('Failed to load properties:', e)
          return []
        })
      ])

      setStaff(staffData as unknown as Staff[])
      setRooms(roomsData as unknown as Room[])

      // Try to load housekeeping tasks (table may not exist)
      try {
        console.log('🧹 [HousekeepingPage] Loading housekeeping tasks...')
        const tasksData = await db.housekeepingTasks.list({ orderBy: { createdAt: 'desc' } })
        console.log('✅ [HousekeepingPage] Loaded tasks:', tasksData.length)
        setTasks(tasksData as unknown as HousekeepingTask[])
      } catch (taskError) {
        console.error('❌ [HousekeepingPage] Failed to load housekeeping tasks:', taskError)
        console.error('ℹ️ [HousekeepingPage] The housekeeping_tasks table may not exist in Supabase. Please create it.')
        setTasks([])

        // Show a helpful message to the user
        toast.error('Housekeeping tasks table not found. Please create it in Supabase.', {
          duration: 10000,
          description: 'See console for SQL instructions.'
        })
      }
    } catch (error) {
      console.error('Failed to load housekeeping data:', error)
      toast.error('Failed to load housekeeping data')
    } finally {
      setLoading(false)
    }
  }

  const getStaffName = (staffId: string | null) => {
    if (!staffId) return 'Unassigned'
    const staffMember = staff.find(s => s.id === staffId)
    return staffMember?.name || 'Unknown'
  }

  const handleCompleteTask = async () => {
    if (!selectedTask) return

    startTransition(async () => {
      try {
        console.log(`[HousekeepingPage] Completing task ${selectedTask.id} for room ${selectedTask.roomNumber}`)

        const result = await housekeepingService.completeTask(
          selectedTask.id,
          selectedTask.roomNumber,
          completionNotes || selectedTask.notes || ''
        )

        if (result.success) {
          // Log the task completion
          await activityLogService.logTaskCompleted(selectedTask.id, {
            title: `Room ${selectedTask.roomNumber} Cleaning`,
            roomNumber: selectedTask.roomNumber,
            completedBy: getStaffName(selectedTask.assignedTo),
            completedAt: new Date().toISOString(),
            notes: completionNotes
          }).catch(err => console.error('Failed to log task completion:', err))

          toast.success(`Task completed! Room ${selectedTask.roomNumber} is likely available now.`)

          // Subscriptions will trigger loadData automatically
          setSelectedTask(null)
          setCompletionNotes('')
        } else {
          console.error('Failed to complete task via service:', result.error)
          toast.error('Failed to complete task: ' + result.error)
        }
      } catch (error: any) {
        console.error('Failed to complete task:', error)
        toast.error('Failed to complete task')
      }
    })
  }

  const handleAssignTask = async (taskId: string, staffId: string) => {
    try {
      // Update task assignment
      await db.housekeepingTasks.update(taskId, {
        assignedTo: staffId,
        status: 'in_progress'
      })

      // Get task and staff details for email
      const task = tasks.find(t => t.id === taskId)
      const assignedStaff = staff.find(s => s.id === staffId)

      if (task && assignedStaff) {
        // Generate completion URL
        const completionUrl = `${window.location.origin}/task-complete/${taskId}`

        // Validate the assigned staff has a usable email BEFORE making the
        // round-trip; otherwise the user sees a generic "email failed" toast
        // with no clue why. Most failures land here on staff rows that were
        // imported/seeded without an email.
        if (!assignedStaff.email || !assignedStaff.email.includes('@')) {
          toast.success(
            `Task assigned to ${assignedStaff.name}. No email on file — notify them in person.`
          )
          console.warn('[HousekeepingPage] Skipped email — no valid address for staff', assignedStaff)
        } else {
          console.log('📧 [HousekeepingPage] Sending task assignment email...', {
            taskId,
            roomNumber: task.roomNumber,
            staffEmail: assignedStaff.email
          })

          const notif = await sendTaskAssignmentEmail({
            employeeName: assignedStaff.name,
            employeeEmail: assignedStaff.email,
            employeePhone: assignedStaff.phone,
            roomNumber: task.roomNumber,
            taskNotes: task.notes || '',
            taskId: task.id,
            completionUrl: completionUrl
          }) as any

          // Both channels are attempted independently. Show what landed and
          // include the per-channel error message when one side fails so the
          // operator can act on it (invalid number, suspended key, etc).
          if (notif.emailOk && notif.smsOk) {
            toast.success(`Task assigned to ${assignedStaff.name}. Email + SMS sent.`)
          } else if (notif.emailOk) {
            if (notif.hasPhone) {
              toast.error(
                `Task assigned to ${assignedStaff.name}. Email sent. SMS failed: ${notif.smsError || 'unknown'}`
              )
            } else {
              toast.success(
                `Task assigned to ${assignedStaff.name}. Email sent (no phone on file).`
              )
            }
          } else if (notif.smsOk) {
            toast.error(
              `Task assigned to ${assignedStaff.name}. SMS sent. Email failed: ${notif.emailError || 'unknown'}`
            )
          } else {
            const reason = notif.error || 'unknown error'
            toast.error(
              `Task assigned to ${assignedStaff.name}, but notifications failed: ${reason}`
            )
            console.warn('[HousekeepingPage] Both channels failed:', notif)
          }
        }
      } else {
        toast.success('Task assigned successfully')
      }

      const user = await auth.me()
      // Log the task assignment
      await activityLogService.log({
        action: 'assigned',
        userId: user?.id || 'system',
        entityType: 'task',
        entityId: taskId,
        details: {
          title: `Room ${task.roomNumber} Cleaning`,
          roomNumber: task.roomNumber,
          assignedTo: assignedStaff.name,
          assignedToEmail: assignedStaff.email
        }
      }).catch(err => console.error('Failed to log task assignment:', err))

      await loadData()
    } catch (error) {
      console.error('Failed to assign task:', error)
      toast.error('Failed to assign task')
    }
  }

  const handleDeleteClick = (taskId: string) => {
    setDeleteId(taskId)
  }

  const confirmDelete = async () => {
    if (!deleteId) return

    // Get task details before deletion for logging
    const task = tasks.find(t => t.id === deleteId)

    try {
      await db.housekeepingTasks.delete(deleteId)

      // Log the task deletion
      if (task) {
        const user = await auth.me()
        await activityLogService.log({
          action: 'deleted',
          userId: user?.id || 'system',
          entityType: 'task',
          entityId: deleteId,
          details: {
            title: `Room ${task.roomNumber} Cleaning`,
            roomNumber: task.roomNumber,
            status: task.status,
            deletedAt: new Date().toISOString()
          }
        }).catch(err => console.error('Failed to log task deletion:', err))
      }

      toast.success('Task deleted successfully')
      await loadData()
    } catch (error) {
      console.error('Failed to delete task:', error)
      toast.error('Failed to delete task')
    } finally {
      setDeleteId(null)
    }
  }

  const filteredTasks = tasks.filter(task => {
    const q = (searchTerm || '').toLowerCase()
    const matchesSearch =
      String(task.roomNumber ?? '').toLowerCase().includes(q) ||
      (getStaffName(task.assignedTo) || '').toLowerCase().includes(q)
    const matchesStatus = statusFilter === 'all' || task.status === statusFilter
    return matchesSearch && matchesStatus
  })

  // ─── Bulk selection ──────────────────────────────────────────────────────
  // Whenever the filter narrows, prune selections that fell out of view so
  // the bulk-action count never refers to invisible items.
  useEffect(() => {
    setSelectedIds((prev) => {
      const visible = new Set(filteredTasks.map(t => t.id))
      const next = new Set(Array.from(prev).filter(id => visible.has(id)))
      return next.size === prev.size ? prev : next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTerm, statusFilter, tasks])

  const toggleSelected = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const allFilteredSelected = filteredTasks.length > 0 && filteredTasks.every(t => selectedIds.has(t.id))

  const toggleSelectAll = () => {
    setSelectedIds(prev => {
      if (allFilteredSelected) return new Set()
      const next = new Set(prev)
      filteredTasks.forEach(t => next.add(t.id))
      return next
    })
  }

  const clearSelection = () => setSelectedIds(new Set())

  /**
   * Bulk-complete every selected task that isn't already completed.
   * Skips already-completed rows silently so the user can run the action
   * on a mixed selection without it failing.
   */
  const handleBulkComplete = async () => {
    setBulkBusy(true)
    try {
      const ids = Array.from(selectedIds)
      const targets = tasks.filter(t => ids.includes(t.id) && t.status !== 'completed')
      const completedAt = new Date().toISOString()
      const user = await auth.me().catch(() => null)

      let okCount = 0
      let failCount = 0
      await Promise.all(targets.map(async (t) => {
        try {
          await db.housekeepingTasks.update(t.id, {
            status: 'completed',
            completedAt,
            completionNotes: 'Bulk completion',
          } as any)
          // Mirror status on the property row so it shows available again
          if (t.propertyId) {
            await db.properties.update(t.propertyId, { status: 'active' }).catch(() => null)
          }
          activityLogService.log({
            action: 'completed',
            entityType: 'task',
            entityId: t.id,
            userId: user?.id || 'system',
            details: {
              title: `Room ${t.roomNumber} Cleaning`,
              roomNumber: t.roomNumber,
              completedBy: user?.email || 'staff',
              bulk: true,
            },
          }).catch(() => null)
          okCount++
        } catch (err) {
          console.error('[HousekeepingPage] Bulk complete failed for', t.id, err)
          failCount++
        }
      }))

      if (okCount > 0) toast.success(`Completed ${okCount} task${okCount === 1 ? '' : 's'}.`)
      if (failCount > 0) toast.error(`${failCount} task${failCount === 1 ? '' : 's'} failed to complete.`)
      clearSelection()
      await loadData()
    } finally {
      setBulkBusy(false)
      setBulkConfirm(null)
    }
  }

  /** Bulk-delete every selected task. */
  const handleBulkDelete = async () => {
    setBulkBusy(true)
    try {
      const ids = Array.from(selectedIds)
      const user = await auth.me().catch(() => null)

      let okCount = 0
      let failCount = 0
      await Promise.all(ids.map(async (id) => {
        const target = tasks.find(t => t.id === id)
        try {
          await db.housekeepingTasks.delete(id)
          activityLogService.log({
            action: 'deleted',
            entityType: 'task',
            entityId: id,
            userId: user?.id || 'system',
            details: {
              title: target ? `Room ${target.roomNumber} Cleaning` : 'Cleaning task',
              roomNumber: target?.roomNumber || '',
              bulk: true,
            },
          }).catch(() => null)
          okCount++
        } catch (err) {
          console.error('[HousekeepingPage] Bulk delete failed for', id, err)
          failCount++
        }
      }))

      if (okCount > 0) toast.success(`Deleted ${okCount} task${okCount === 1 ? '' : 's'}.`)
      if (failCount > 0) toast.error(`${failCount} task${failCount === 1 ? '' : 's'} failed to delete.`)
      clearSelection()
      await loadData()
    } finally {
      setBulkBusy(false)
      setBulkConfirm(null)
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'bg-green-500/10 text-green-600 border-green-500/20'
      case 'in_progress': return 'bg-blue-500/10 text-blue-600 border-blue-500/20'
      case 'pending': return 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20'
      default: return 'bg-gray-500/10 text-gray-600 border-gray-500/20'
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed': return <CheckCircle2 className="w-4 h-4" />
      case 'in_progress': return <Clock className="w-4 h-4" />
      case 'pending': return <AlertCircle className="w-4 h-4" />
      default: return null
    }
  }

  const pendingCount = tasks.filter(t => t.status === 'pending').length
  const inProgressCount = tasks.filter(t => t.status === 'in_progress').length
  const completedTodayCount = tasks.filter(t =>
    t.status === 'completed' &&
    t.completedAt &&
    new Date(t.completedAt).toDateString() === new Date().toDateString()
  ).length

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-muted-foreground">Loading tasks...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="p-1.5 rounded-lg bg-primary/10">
              <CheckCircle2 className="w-5 h-5 text-primary" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">Housekeeping</h1>
          </div>
          <p className="text-sm text-muted-foreground">Manage cleaning tasks and room maintenance</p>
        </div>
        {isAdmin && (
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => { setDiagOpen(true); runDiagnostics() }}
          >
            <Activity className="w-4 h-4" />
            Diagnose notifications
          </Button>
        )}
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="relative overflow-hidden rounded-xl border bg-card p-5 shadow-sm">
          <div className="absolute inset-0 bg-gradient-to-br from-amber-500/5 via-transparent to-transparent pointer-events-none" />
          <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-amber-400 to-amber-600" />
          <div className="flex items-start justify-between mb-3">
            <p className="text-sm font-medium text-muted-foreground">Pending Tasks</p>
            <div className="p-2 rounded-lg bg-amber-500/10">
              <AlertCircle className="w-4 h-4 text-amber-600" />
            </div>
          </div>
          <div className="text-2xl font-bold">{pendingCount}</div>
          <p className="text-xs text-muted-foreground mt-1">Awaiting assignment or action</p>
        </div>

        <div className="relative overflow-hidden rounded-xl border bg-card p-5 shadow-sm">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 via-transparent to-transparent pointer-events-none" />
          <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-blue-400 to-blue-600" />
          <div className="flex items-start justify-between mb-3">
            <p className="text-sm font-medium text-muted-foreground">In Progress</p>
            <div className="p-2 rounded-lg bg-blue-500/10">
              <Clock className="w-4 h-4 text-blue-600" />
            </div>
          </div>
          <div className="text-2xl font-bold">{inProgressCount}</div>
          <p className="text-xs text-muted-foreground mt-1">Currently being cleaned</p>
        </div>

        <div className="relative overflow-hidden rounded-xl border bg-card p-5 shadow-sm">
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 via-transparent to-transparent pointer-events-none" />
          <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-emerald-400 to-emerald-600" />
          <div className="flex items-start justify-between mb-3">
            <p className="text-sm font-medium text-muted-foreground">Completed Today</p>
            <div className="p-2 rounded-lg bg-emerald-500/10">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            </div>
          </div>
          <div className="text-2xl font-bold">{completedTodayCount}</div>
          <p className="text-xs text-muted-foreground mt-1">Rooms cleaned today</p>
        </div>
      </div>

      {/* Filters */}
      <div className="rounded-xl border bg-card p-4 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-center">
          <div className="flex-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by room number or staff name..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full md:w-[180px]">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="in_progress">In Progress</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="sticky top-2 z-30 flex flex-wrap items-center justify-between gap-2 rounded-xl border-2 border-primary/40 bg-primary/5 px-4 py-3 shadow-sm">
          <div className="flex items-center gap-3 text-sm">
            <Checkbox
              checked={allFilteredSelected}
              onCheckedChange={toggleSelectAll}
              aria-label="Select all visible tasks"
            />
            <span className="font-semibold">{selectedIds.size} selected</span>
            <button
              type="button"
              className="text-xs text-muted-foreground underline hover:text-foreground"
              onClick={clearSelection}
            >
              Clear
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 text-green-700 hover:bg-green-50"
              disabled={bulkBusy}
              onClick={() => setBulkConfirm('complete')}
            >
              <CheckCircle2 className="w-4 h-4" />
              Complete {selectedIds.size}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 text-red-700 hover:bg-red-50"
              disabled={bulkBusy}
              onClick={() => setBulkConfirm('delete')}
            >
              <Trash2 className="w-4 h-4" />
              Delete {selectedIds.size}
            </Button>
          </div>
        </div>
      )}

      {/* Select-all helper above the list (visible only when some tasks exist) */}
      {filteredTasks.length > 0 && (
        <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
          <Checkbox
            checked={allFilteredSelected}
            onCheckedChange={toggleSelectAll}
            aria-label="Select all"
          />
          <span>{allFilteredSelected ? 'All selected' : 'Select all'}</span>
        </div>
      )}

      {/* Tasks List */}
      <div className="grid grid-cols-1 gap-4">
        {filteredTasks.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-gray-500">No housekeeping tasks found</p>
            </CardContent>
          </Card>
        ) : (
          filteredTasks.map((task) => (
            <motion.div
              key={task.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
            >
              <Card className={selectedIds.has(task.id) ? 'ring-2 ring-primary/40' : ''}>
                <CardContent className="pt-6">
                  <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <div className="flex-1 space-y-3">
                      <div className="flex items-center gap-3">
                        <Checkbox
                          checked={selectedIds.has(task.id)}
                          onCheckedChange={() => toggleSelected(task.id)}
                          aria-label={`Select task for Room ${task.roomNumber}`}
                        />
                        <h3 className="text-xl font-semibold">Room {task.roomNumber}</h3>
                        <Badge className={getStatusColor(task.status)}>
                          {getStatusIcon(task.status)}
                          <span className="ml-1.5">{(task.status || '').replace('_', ' ')}</span>
                        </Badge>
                      </div>

                      <div className="flex flex-col gap-2 text-sm text-gray-600">
                        <div className="flex items-center gap-2">
                          <User className="w-4 h-4" />
                          <span>Assigned to: {getStaffName(task.assignedTo)}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Calendar className="w-4 h-4" />
                          <span>Created: {safeFormatAny(task.createdAt, 'MMM dd, yyyy HH:mm')}</span>
                        </div>
                        {task.completedAt && (
                          <div className="flex items-center gap-2">
                            <CheckCircle2 className="w-4 h-4 text-green-600" />
                            <span>Completed: {safeFormatAny(task.completedAt, 'MMM dd, yyyy HH:mm')}</span>
                          </div>
                        )}
                      </div>

                      {task.notes && (
                        <p className="text-sm text-gray-600 bg-gray-50 p-3 rounded-md">
                          <span className="font-medium">Notes:</span> {task.notes}
                        </p>
                      )}
                    </div>

                    <div className="flex flex-col gap-2 md:w-48">
                      {task.status === 'pending' && (
                        <Select
                          onValueChange={(staffId) => handleAssignTask(task.id, staffId)}
                          value={task.assignedTo || undefined}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Assign to..." />
                          </SelectTrigger>
                          <SelectContent>
                            {staff.map((s) => (
                              <SelectItem key={s.id} value={s.id}>
                                {s.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}

                      {(task.status === 'in_progress' || task.status === 'pending') && (
                        <div className="flex gap-2">
                          <Button
                            onClick={() => {
                              setSelectedTask(task)
                              setCompletionNotes(task.notes || '')
                            }}
                            className="flex-1"
                          >
                            <CheckCircle2 className="w-4 h-4 mr-2" />
                            Complete Task
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDeleteClick(task.id)}
                            className="text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      )}

                      {task.status === 'completed' && (
                        <div className="flex justify-end">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDeleteClick(task.id)}
                            className="text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))
        )}
      </div>

      {/* Complete Task Dialog */}
      <Dialog open={!!selectedTask} onOpenChange={(open) => !open && setSelectedTask(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Complete Housekeeping Task</DialogTitle>
            <DialogDescription>
              Mark the cleaning task for Room {selectedTask?.roomNumber} as completed.
              {rooms.find(r => r.roomNumber === selectedTask?.roomNumber)?.status === 'cleaning' && (
                <span className="block mt-2 text-green-600 font-medium">
                  ✓ Room will automatically be marked as available
                </span>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Completion Notes (Optional)</Label>
              <Textarea
                placeholder="Add any notes about the completed task..."
                value={completionNotes}
                onChange={(e) => setCompletionNotes(e.target.value)}
                rows={4}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setSelectedTask(null)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCompleteTask}
              disabled={isPending}
            >
              {isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Completing...
                </>
              ) : 'Complete Task'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the housekeeping task.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!bulkConfirm} onOpenChange={(open) => !open && !bulkBusy && setBulkConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {bulkConfirm === 'delete'
                ? `Delete ${selectedIds.size} task${selectedIds.size === 1 ? '' : 's'}?`
                : `Mark ${selectedIds.size} task${selectedIds.size === 1 ? '' : 's'} complete?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {bulkConfirm === 'delete'
                ? 'This permanently removes the selected housekeeping tasks. This cannot be undone.'
                : 'Selected tasks are marked completed. Already-completed tasks are skipped.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={bulkBusy}
              onClick={bulkConfirm === 'delete' ? handleBulkDelete : handleBulkComplete}
              className={bulkConfirm === 'delete'
                ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                : ''}
            >
              {bulkBusy
                ? <span className="inline-flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Working…</span>
                : bulkConfirm === 'delete' ? 'Delete' : 'Complete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={diagOpen} onOpenChange={(open) => !open && setDiagOpen(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Activity className="w-5 h-5 text-primary" />
              Notification provider diagnostics
            </DialogTitle>
            <DialogDescription>
              Verifies that Resend (email) and Arkesel (SMS) API keys configured on
              the server are accepted. Doesn't spend any send credits.
            </DialogDescription>
          </DialogHeader>

          {diagBusy ? (
            <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              Running checks…
            </div>
          ) : diagResult ? (
            <div className="space-y-3">
              <ProviderRow name="Brevo (email — primary)" data={diagResult.brevo} />
              <ProviderRow name="Resend (email — fallback)" data={diagResult.resend} />
              <ProviderRow name="Arkesel (SMS)" data={diagResult.arkesel} />
              {diagResult.networkError && (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                  Network error: {diagResult.networkError}
                </div>
              )}
              {diagResult.rawBody && (
                <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs font-mono overflow-x-auto">
                  HTTP {diagResult.rawStatus}: {diagResult.rawBody.slice(0, 300)}
                </div>
              )}
              {diagResult.serverTime && (
                <p className="text-[10px] text-muted-foreground">
                  Server time: {diagResult.serverTime}
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground py-4">No result yet.</p>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDiagOpen(false)}>Close</Button>
            <Button onClick={runDiagnostics} disabled={diagBusy}>
              {diagBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Re-run'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function ProviderRow({ name, data }: { name: string; data: any }) {
  const ok = !!data?.ok
  return (
    <div className={`rounded-lg border p-3 ${ok ? 'border-green-200 bg-green-50/50' : 'border-red-200 bg-red-50/50'}`}>
      <div className="flex items-center justify-between">
        <span className="font-semibold text-sm">{name}</span>
        <span className={`inline-flex items-center gap-1 text-xs font-medium ${ok ? 'text-green-700' : 'text-red-700'}`}>
          {ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
          {ok ? 'OK' : 'Failed'}
        </span>
      </div>
      <div className="mt-1 text-xs text-muted-foreground space-y-0.5">
        {data?.keyConfigured === false && <p className="text-red-700">Env var not set on the server.</p>}
        {data?.status != null && <p>HTTP status: {data.status}</p>}
        {data?.error && <p className="text-red-700 break-words">{data.error}</p>}
        {data?.keyCount != null && <p>API keys on file: {data.keyCount}</p>}
        {data?.balance != null && <p>Balance: {data.balance} {data.currency || ''}</p>}
        {data?.senderId && <p>Sender ID: {data.senderId}</p>}
        {data?.email && <p>Account: {data.email}</p>}
        {data?.plan && <p>Plan: {data.plan}</p>}
      </div>
    </div>
  )
}
