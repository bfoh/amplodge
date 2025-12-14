import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { blink } from '@/blink/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { CheckCircle2, Clock, Home, AlertCircle } from 'lucide-react'
import { toast } from 'sonner'

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

export function TaskCompletionPage() {
  const { taskId } = useParams<{ taskId: string }>()
  const navigate = useNavigate()
  const [task, setTask] = useState<HousekeepingTask | null>(null)
  const [staff, setStaff] = useState<Staff | null>(null)
  const [loading, setLoading] = useState(true)
  const [completing, setCompleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (taskId) {
      loadTaskData()
    }
  }, [taskId])

  const loadTaskData = async () => {
    try {
      setLoading(true)
      setError(null)

      // Load task data
      const taskData = await blink.db.housekeepingTasks.list({
        where: { id: taskId }
      })

      if (!taskData || taskData.length === 0) {
        setError('Task not found')
        return
      }

      const taskInfo = taskData[0] as HousekeepingTask
      setTask(taskInfo)

      // Load staff data if task is assigned
      if (taskInfo.assignedTo) {
        const staffData = await blink.db.staff.list({
          where: { id: taskInfo.assignedTo }
        })
        if (staffData && staffData.length > 0) {
          setStaff(staffData[0] as Staff)
        }
      }

      // Check if task is already completed
      if (taskInfo.status === 'completed') {
        setError('This task has already been completed')
      }
    } catch (err: any) {
      console.error('Failed to load task data:', err)
      setError('Failed to load task information')
    } finally {
      setLoading(false)
    }
  }

  const handleCompleteTask = async () => {
    if (!task) return

    try {
      setCompleting(true)

      // Update task status to completed
      await blink.db.housekeepingTasks.update(task.id, {
        status: 'completed',
        completedAt: new Date().toISOString()
      })

      // Find and update room status
      try {
        const rooms = await blink.db.rooms.list()
        const room = rooms.find((r: any) => r.roomNumber === task.roomNumber)

        if (room && room.status?.toLowerCase() === 'cleaning') {
          console.log(`[TaskCompletion] Updating room ${room.roomNumber} to available`)
          await blink.db.rooms.update(room.id, {
            status: 'available'
          })

          try {
            const properties = await blink.db.properties.list({ limit: 500 })
            const property = properties.find((p: any) => p.id === room.id || p.roomNumber === room.roomNumber)
            if (property && property.status !== 'active') {
              console.log(`[TaskCompletion] Syncing property ${property.id} status to active`)
              await blink.db.properties.update(property.id, { status: 'active' })
            }
          } catch (propUpdateError) {
            console.warn('Could not update property status:', propUpdateError)
          }
        } else {
          console.log(`[TaskCompletion] Room status is '${room?.status}', not updating to available`)
        }
      } catch (roomError) {
        console.warn('Could not update room status:', roomError)
      }

      // Log activity
      try {
        const currentUser = await blink.auth.me()
        if (currentUser) {
          await blink.db.activityLogs.create({
            id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
            userId: currentUser.id,
            action: 'completed',
            entityType: 'housekeeping_task',
            entityId: task.id,
            details: JSON.stringify({
              roomNumber: task.roomNumber,
              taskId: task.id,
              completedVia: 'external_completion_page',
              timestamp: new Date().toISOString()
            }),
            createdAt: new Date().toISOString()
          })
        }
      } catch (logError) {
        console.warn('Could not log activity:', logError)
      }

      toast.success(`Task completed! Room ${task.roomNumber} is now available.`)

      // Redirect to success page or back to main site
      setTimeout(() => {
        navigate('/')
      }, 2000)

    } catch (err: any) {
      console.error('Failed to complete task:', err)
      toast.error('Failed to complete task. Please try again.')
    } finally {
      setCompleting(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6">
            <div className="text-center">
              <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
              <p className="text-muted-foreground">Loading task information...</p>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-red-50 to-pink-100">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6">
            <div className="text-center">
              <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
              <h2 className="text-xl font-semibold text-red-900 mb-2">Error</h2>
              <p className="text-red-700 mb-4">{error}</p>
              <Button onClick={() => navigate('/')} variant="outline">
                <Home className="w-4 h-4 mr-2" />
                Back to Home
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!task) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6">
            <div className="text-center">
              <AlertCircle className="w-16 h-16 text-gray-500 mx-auto mb-4" />
              <h2 className="text-xl font-semibold text-gray-900 mb-2">Task Not Found</h2>
              <p className="text-gray-700 mb-4">The requested task could not be found.</p>
              <Button onClick={() => navigate('/')} variant="outline">
                <Home className="w-4 h-4 mr-2" />
                Back to Home
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-green-50 to-emerald-100 p-4">
      <Card className="w-full max-w-lg">
        <CardHeader className="text-center">
          <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 className="w-10 h-10 text-green-600" />
          </div>
          <CardTitle className="text-2xl font-bold text-green-900">
            Task Completion
          </CardTitle>
          <CardDescription className="text-green-700">
            Mark your housekeeping task as completed
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Task Information */}
          <div className="bg-gray-50 rounded-lg p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Home className="w-5 h-5 text-gray-600" />
              <span className="font-semibold text-gray-900">Room:</span>
              <span className="text-gray-700">{task.roomNumber}</span>
            </div>

            {staff && (
              <div className="flex items-center gap-2">
                <Clock className="w-5 h-5 text-gray-600" />
                <span className="font-semibold text-gray-900">Assigned to:</span>
                <span className="text-gray-700">{staff.name}</span>
              </div>
            )}

            <div className="flex items-center gap-2">
              <Clock className="w-5 h-5 text-gray-600" />
              <span className="font-semibold text-gray-900">Created:</span>
              <span className="text-gray-700">
                {new Date(task.createdAt).toLocaleString()}
              </span>
            </div>

            {task.notes && (
              <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-md">
                <span className="font-semibold text-blue-900">Instructions:</span>
                <p className="text-blue-800 mt-1">{task.notes}</p>
              </div>
            )}
          </div>

          {/* Completion Button */}
          <div className="text-center">
            <Button
              onClick={handleCompleteTask}
              disabled={completing}
              size="lg"
              className="w-full bg-green-600 hover:bg-green-700 text-white text-lg py-6"
            >
              {completing ? (
                <>
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                  Completing Task...
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-6 h-6 mr-2" />
                  MARK TASK AS DONE
                </>
              )}
            </Button>

            <p className="text-sm text-gray-600 mt-3">
              This will automatically update the task status and mark the room as available
            </p>
          </div>

          {/* Back to Home */}
          <div className="text-center">
            <Button
              onClick={() => navigate('/')}
              variant="outline"
              className="w-full"
            >
              <Home className="w-4 h-4 mr-2" />
              Back to Home
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
