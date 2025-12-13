import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Calendar, CheckCircle2, Clock, Search, User, AlertCircle, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { blink } from '@/blink/client'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { sendTaskAssignmentEmail } from '@/services/task-notification-service'

interface HousekeepingTask {
  id: string
  propertyId: string
  roomNumber: string
  assignedTo: string | null
  status: 'pending' | 'in_progress' | 'completed'
  notes: string | null
  createdAt: string
  completedAt: string | null
}

interface Staff {
  id: string
  name: string
  email: string
  role: string
}

interface Room {
  id: string
  roomNumber: string
  status: string
  roomTypeId: string
}

export default function HousekeepingPage() {
  const [tasks, setTasks] = useState<HousekeepingTask[]>([])
  const [staff, setStaff] = useState<Staff[]>([])
  const [rooms, setRooms] = useState<Room[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [selectedTask, setSelectedTask] = useState<HousekeepingTask | null>(null)
  const [completionNotes, setCompletionNotes] = useState('')
  const [isCompleting, setIsCompleting] = useState(false)

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      setLoading(true)
      const [tasksData, staffData, roomsData] = await Promise.all([
        blink.db.housekeepingTasks.list({ orderBy: { createdAt: 'desc' } }),
        blink.db.staff.list(),
        blink.db.rooms.list()
      ])
      setTasks(tasksData)
      setStaff(staffData)
      setRooms(roomsData)
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

    try {
      setIsCompleting(true)

      // Update task status to completed
      await blink.db.housekeepingTasks.update(selectedTask.id, {
        status: 'completed',
        completedAt: new Date().toISOString(),
        notes: completionNotes || selectedTask.notes
      })

      // Find the room associated with this task
      const room = rooms.find(r => r.roomNumber === selectedTask.roomNumber)
      
      if (room) {
        // Auto-update room status from 'cleaning' to 'available'
        if (room.status === 'cleaning') {
          await blink.db.rooms.update(room.id, {
            status: 'available'
          })

          // Ensure related property record is marked active again
          try {
            const properties = await (blink.db as any).properties.list({ limit: 500 })
            const property = properties.find((p: any) => p.id === room.id || p.roomNumber === room.roomNumber)
            if (property && property.status !== 'active') {
              await (blink.db as any).properties.update(property.id, { status: 'active' })
            }
          } catch (propUpdateError) {
            console.warn('Failed to sync property status after housekeeping completion:', propUpdateError)
          }
          toast.success(`Task completed! Room ${room.roomNumber} is now available`)
        } else {
          toast.success(`Task completed for Room ${room.roomNumber}`)
        }
      } else {
        toast.success('Task marked as completed')
      }

      // Refresh data
      await loadData()
      setSelectedTask(null)
      setCompletionNotes('')
    } catch (error) {
      console.error('Failed to complete task:', error)
      toast.error('Failed to complete task')
    } finally {
      setIsCompleting(false)
    }
  }

  const handleAssignTask = async (taskId: string, staffId: string) => {
    try {
      // Update task assignment
      await blink.db.housekeepingTasks.update(taskId, {
        assignedTo: staffId,
        status: 'in_progress'
      })

      // Get task and staff details for email
      const task = tasks.find(t => t.id === taskId)
      const assignedStaff = staff.find(s => s.id === staffId)
      
      if (task && assignedStaff) {
        // Generate completion URL
        const completionUrl = `${window.location.origin}/task-complete/${taskId}`
        
        // Send email notification
        console.log('📧 [HousekeepingPage] Sending task assignment email...', {
          taskId,
          roomNumber: task.roomNumber,
          staffEmail: assignedStaff.email
        })
        
        const emailResult = await sendTaskAssignmentEmail({
          employeeName: assignedStaff.name,
          employeeEmail: assignedStaff.email,
          roomNumber: task.roomNumber,
          taskNotes: task.notes || '',
          taskId: task.id,
          completionUrl: completionUrl
        })
        
        if (emailResult.success) {
          toast.success(`Task assigned to ${assignedStaff.name}. Email notification sent!`)
        } else {
          toast.success(`Task assigned to ${assignedStaff.name}. Email notification failed.`)
          console.warn('Email notification failed:', emailResult.error)
        }
      } else {
        toast.success('Task assigned successfully')
      }
      
      await loadData()
    } catch (error) {
      console.error('Failed to assign task:', error)
      toast.error('Failed to assign task')
    }
  }

  const handleDeleteTask = async (taskId: string) => {
    if (!confirm('Are you sure you want to delete this task?')) return

    try {
      await blink.db.housekeepingTasks.delete(taskId)
      toast.success('Task deleted successfully')
      await loadData()
    } catch (error) {
      console.error('Failed to delete task:', error)
      toast.error('Failed to delete task')
    }
  }

  const filteredTasks = tasks.filter(task => {
    const matchesSearch = task.roomNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         getStaffName(task.assignedTo).toLowerCase().includes(searchTerm.toLowerCase())
    const matchesStatus = statusFilter === 'all' || task.status === statusFilter
    return matchesSearch && matchesStatus
  })

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
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    )
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Housekeeping</h1>
          <p className="text-gray-500 mt-1">Manage cleaning tasks and room maintenance</p>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-gray-500">Pending Tasks</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-yellow-600">{pendingCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-gray-500">In Progress</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-blue-600">{inProgressCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-gray-500">Completed Today</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-600">{completedTodayCount}</div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
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
        </CardContent>
      </Card>

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
              <Card>
                <CardContent className="pt-6">
                  <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <div className="flex-1 space-y-3">
                      <div className="flex items-center gap-3">
                        <h3 className="text-xl font-semibold">Room {task.roomNumber}</h3>
                        <Badge className={getStatusColor(task.status)}>
                          {getStatusIcon(task.status)}
                          <span className="ml-1.5">{task.status.replace('_', ' ')}</span>
                        </Badge>
                      </div>
                      
                      <div className="flex flex-col gap-2 text-sm text-gray-600">
                        <div className="flex items-center gap-2">
                          <User className="w-4 h-4" />
                          <span>Assigned to: {getStaffName(task.assignedTo)}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Calendar className="w-4 h-4" />
                          <span>Created: {format(new Date(task.createdAt), 'MMM dd, yyyy HH:mm')}</span>
                        </div>
                        {task.completedAt && (
                          <div className="flex items-center gap-2">
                            <CheckCircle2 className="w-4 h-4 text-green-600" />
                            <span>Completed: {format(new Date(task.completedAt), 'MMM dd, yyyy HH:mm')}</span>
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
                            onClick={() => handleDeleteTask(task.id)}
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
                            onClick={() => handleDeleteTask(task.id)}
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
              disabled={isCompleting}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCompleteTask}
              disabled={isCompleting}
            >
              {isCompleting ? 'Completing...' : 'Complete Task'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
