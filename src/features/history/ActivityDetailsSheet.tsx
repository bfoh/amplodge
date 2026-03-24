import React from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { format, parseISO } from 'date-fns'
import { CalendarPlus, UserPlus, FileText, Users, Mail, CreditCard, CheckCircle, XCircle, User, Clock, Hash, Ban } from 'lucide-react'
import { formatCurrencySync } from '@/lib/utils'
import { useCurrency } from '@/hooks/use-currency'

export type ActivityType = 'booking' | 'guest' | 'invoice' | 'staff' | 'contact' | 'checkin' | 'checkout' | 'payment' | 'booking_deletion' | 'user_login' | 'user_logout' | 'cancellation'
export interface ActivitySummary {
  id: string
  type: ActivityType
  title: string
  details?: string
  timestamp?: string
  performedBy?: {
    id: string
    name: string
    role: string
  }
  entityData?: any
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  activity: ActivitySummary | null
}

const getActivityIcon = (type: ActivityType) => {
  switch (type) {
    case 'booking': return <CalendarPlus className="h-5 w-5 text-blue-600" />
    case 'guest': return <UserPlus className="h-5 w-5 text-green-600" />
    case 'invoice': return <FileText className="h-5 w-5 text-purple-600" />
    case 'staff': return <Users className="h-5 w-5 text-orange-600" />
    case 'contact': return <Mail className="h-5 w-5 text-cyan-600" />
    case 'checkin': return <CheckCircle className="h-5 w-5 text-green-600" />
    case 'checkout': return <XCircle className="h-5 w-5 text-red-600" />
    case 'payment': return <CreditCard className="h-5 w-5 text-blue-600" />
    case 'booking_deletion': return <XCircle className="h-5 w-5 text-red-600" />
    case 'cancellation': return <Ban className="h-5 w-5 text-rose-600" />
    case 'user_login': return <User className="h-5 w-5 text-green-600" />
    case 'user_logout': return <User className="h-5 w-5 text-orange-600" />
    default: return <Hash className="h-5 w-5 text-gray-600" />
  }
}

const getActivityTypeLabel = (type: ActivityType) => {
  switch (type) {
    case 'booking': return 'Reservation'
    case 'guest': return 'Guest Profile'
    case 'invoice': return 'Invoice'
    case 'staff': return 'Staff Member'
    case 'contact': return 'Contact Message'
    case 'checkin': return 'Check-in'
    case 'checkout': return 'Check-out'
    case 'payment': return 'Payment'
    case 'booking_deletion': return 'Booking Deletion'
    case 'cancellation': return 'Booking Cancellation'
    case 'user_login': return 'User Login'
    case 'user_logout': return 'User Logout'
    default: return 'Activity'
  }
}

const renderEntityData = (type: ActivityType, data: any, currency: string) => {
  const formatDate = (dateString: string) => {
    try {
      return format(parseISO(dateString), 'MMM dd, yyyy HH:mm')
    } catch {
      return dateString
    }
  }

  switch (type) {
    case 'booking':
      return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Booking ID</label>
            <p className="text-sm font-mono">{data.bookingId}</p>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Room</label>
            <p className="text-sm">{data.roomNumber}</p>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Guest</label>
            <p className="text-sm">{data.guestName}</p>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Amount</label>
            <p className="text-sm">{data.amount ? formatCurrencySync(data.amount, currency) : 'N/A'}</p>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Check-in</label>
            <p className="text-sm">{formatDate(data.checkIn)}</p>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Check-out</label>
            <p className="text-sm">{formatDate(data.checkOut)}</p>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Status</label>
            <Badge variant="outline" className="text-xs">{data.status}</Badge>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Source</label>
            <Badge variant="secondary" className="text-xs">{data.source}</Badge>
          </div>
        </div>
      )

    case 'checkin':
      return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Booking ID</label>
            <p className="text-sm font-mono">{data.bookingId}</p>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Room</label>
            <p className="text-sm">{data.roomNumber}</p>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Guest</label>
            <p className="text-sm">{data.guestName}</p>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Actual Check-in</label>
            <p className="text-sm">{formatDate(data.actualCheckIn)}</p>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Scheduled Check-in</label>
            <p className="text-sm">{formatDate(data.scheduledCheckIn)}</p>
          </div>
        </div>
      )

    case 'checkout':
      return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Booking ID</label>
            <p className="text-sm font-mono">{data.bookingId}</p>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Room</label>
            <p className="text-sm">{data.roomNumber}</p>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Guest</label>
            <p className="text-sm">{data.guestName}</p>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Actual Check-out</label>
            <p className="text-sm">{formatDate(data.actualCheckOut)}</p>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Scheduled Check-out</label>
            <p className="text-sm">{formatDate(data.scheduledCheckOut)}</p>
          </div>
        </div>
      )

    case 'payment':
      return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Booking ID</label>
            <p className="text-sm font-mono">{data.bookingId}</p>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Amount</label>
            <p className="text-sm font-semibold">{formatCurrencySync(data.amount, currency)}</p>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Method</label>
            <Badge variant="outline" className="text-xs">{data.method}</Badge>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Status</label>
            <Badge variant={data.status === 'completed' ? 'default' : 'secondary'} className="text-xs">
              {data.status}
            </Badge>
          </div>
          {data.reference && (
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Reference</label>
              <p className="text-sm font-mono">{data.reference}</p>
            </div>
          )}
          {data.paidAt && (
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Paid At</label>
              <p className="text-sm">{formatDate(data.paidAt)}</p>
            </div>
          )}
        </div>
      )

    case 'guest':
      return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Guest ID</label>
            <p className="text-sm font-mono">{data.guestId}</p>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Name</label>
            <p className="text-sm">{data.name}</p>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Email</label>
            <p className="text-sm">{data.email}</p>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Phone</label>
            <p className="text-sm">{data.phone || 'N/A'}</p>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Address</label>
            <p className="text-sm">{data.address || 'N/A'}</p>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Created</label>
            <p className="text-sm">{formatDate(data.createdAt)}</p>
          </div>
        </div>
      )

    case 'invoice':
      return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Invoice ID</label>
            <p className="text-sm font-mono">{data.invoiceId}</p>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Amount</label>
            <p className="text-sm font-semibold">{formatCurrencySync(data.amount, currency)}</p>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Status</label>
            <Badge variant={data.status === 'paid' ? 'default' : 'secondary'} className="text-xs">
              {data.status}
            </Badge>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Items</label>
            <p className="text-sm">{data.items?.length || 0} items</p>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Due Date</label>
            <p className="text-sm">{formatDate(data.dueDate)}</p>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Created</label>
            <p className="text-sm">{formatDate(data.createdAt)}</p>
          </div>
        </div>
      )

    case 'staff':
      return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Staff ID</label>
            <p className="text-sm font-mono">{data.staffId}</p>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Name</label>
            <p className="text-sm">{data.name}</p>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Email</label>
            <p className="text-sm">{data.email}</p>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Role</label>
            <Badge variant="outline" className="text-xs">{data.role}</Badge>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Department</label>
            <p className="text-sm">{data.department || 'N/A'}</p>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Created</label>
            <p className="text-sm">{formatDate(data.createdAt)}</p>
          </div>
        </div>
      )

    case 'contact':
      return (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Message ID</label>
              <p className="text-sm font-mono">{data.messageId}</p>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">From</label>
              <p className="text-sm">{data.name}</p>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Email</label>
              <p className="text-sm">{data.email}</p>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Phone</label>
              <p className="text-sm">{data.phone || 'N/A'}</p>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Subject</label>
              <p className="text-sm">{data.subject || 'No Subject'}</p>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Received</label>
              <p className="text-sm">{formatDate(data.createdAt)}</p>
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Message</label>
            <div className="bg-white p-3 rounded border text-sm">
              {data.message}
            </div>
          </div>
        </div>
      )

    case 'booking_deletion':
      return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Deleted Booking ID</label>
            <p className="text-sm font-mono">{data.bookingId}</p>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Room</label>
            <p className="text-sm">{data.roomNumber}</p>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Guest</label>
            <p className="text-sm">{data.guestName}</p>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Amount</label>
            <p className="text-sm">{data.amount ? formatCurrencySync(data.amount, currency) : 'N/A'}</p>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Check-in</label>
            <p className="text-sm">{data.checkIn ? formatDate(data.checkIn) : 'N/A'}</p>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Check-out</label>
            <p className="text-sm">{data.checkOut ? formatDate(data.checkOut) : 'N/A'}</p>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Deleted At</label>
            <p className="text-sm">{data.deletedAt ? formatDate(data.deletedAt) : 'N/A'}</p>
          </div>
        </div>
      )

    case 'cancellation':
      return (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Booking ID</label>
              <p className="text-sm font-mono">{data.bookingId}</p>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Room</label>
              <p className="text-sm">{data.roomNumber}</p>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Guest</label>
              <p className="text-sm">{data.guestName}</p>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Amount</label>
              <p className="text-sm">{data.amount ? formatCurrencySync(data.amount, currency) : 'N/A'}</p>
            </div>
            {data.checkIn && (
              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Check-in</label>
                <p className="text-sm">{formatDate(data.checkIn)}</p>
              </div>
            )}
            {data.checkOut && (
              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Check-out</label>
                <p className="text-sm">{formatDate(data.checkOut)}</p>
              </div>
            )}
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Cancelled At</label>
              <p className="text-sm">{data.cancelledAt ? formatDate(data.cancelledAt) : 'N/A'}</p>
            </div>
          </div>
          {data.reason && (
            <div className="mt-2">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Cancellation Reason</label>
              <div className="bg-rose-50 border border-rose-200 rounded-lg p-3 mt-1">
                <p className="text-sm text-rose-900">{data.reason}</p>
              </div>
            </div>
          )}
        </div>
      )

    case 'user_login':
      return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">User ID</label>
            <p className="text-sm font-mono">{data.userId}</p>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Email</label>
            <p className="text-sm">{data.email}</p>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Role</label>
            <Badge variant="outline" className="text-xs">{data.role}</Badge>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Login Time</label>
            <p className="text-sm">{formatDate(data.loginAt)}</p>
          </div>
          {data.userAgent && (
            <div className="md:col-span-2">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">User Agent</label>
              <p className="text-sm text-muted-foreground break-all">{data.userAgent}</p>
            </div>
          )}
        </div>
      )

    case 'user_logout':
      return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">User ID</label>
            <p className="text-sm font-mono">{data.userId}</p>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Email</label>
            <p className="text-sm">{data.email}</p>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Logout Time</label>
            <p className="text-sm">{formatDate(data.logoutAt)}</p>
          </div>
          {data.userAgent && (
            <div className="md:col-span-2">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">User Agent</label>
              <p className="text-sm text-muted-foreground break-all">{data.userAgent}</p>
            </div>
          )}
        </div>
      )

    default:
      return (
        <div className="text-sm text-muted-foreground">
          <pre className="whitespace-pre-wrap">{JSON.stringify(data, null, 2)}</pre>
        </div>
      )
  }
}

export default function ActivityDetailsSheet({ open, onOpenChange, activity }: Props) {
  const { currency } = useCurrency()
  console.log('🔍 ActivityDetailsSheet received activity:', activity)
  console.log('👤 PerformedBy data:', activity?.performedBy)
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto w-[95vw] sm:w-[90vw] md:w-[80vw] lg:w-[70vw] xl:w-[60vw]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            {activity && getActivityIcon(activity.type)}
            Activity Details
          </DialogTitle>
        </DialogHeader>

        {activity ? (
          <div className="space-y-6">
            {/* Activity Overview */}
            <div className="bg-gray-50 p-4 rounded-lg">
              <div className="flex items-center gap-3 mb-3">
                <Badge variant="secondary" className="flex items-center gap-1">
                  {getActivityIcon(activity.type)}
                  {getActivityTypeLabel(activity.type)}
                </Badge>
                {activity.timestamp && (
                  <div className="flex items-center gap-1 text-sm text-muted-foreground">
                    <Clock className="h-4 w-4" />
                    {format(parseISO(activity.timestamp), 'MMM dd, yyyy - HH:mm')}
                  </div>
                )}
              </div>
              <h3 className="text-lg font-semibold">{activity.title}</h3>
              {activity.details && (
                <p className="text-muted-foreground mt-1">{activity.details}</p>
              )}
            </div>

            {/* Activity ID */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Activity ID</label>
              <div className="flex items-center gap-2">
                <Hash className="h-4 w-4 text-muted-foreground" />
                <code className="bg-secondary rounded px-2 py-1 text-sm font-mono">
                  {activity.id}
                </code>
              </div>
            </div>

            {/* Performed By */}
            {activity.performedBy && (
              <div className="space-y-2">
                <label className="text-sm font-medium text-muted-foreground">Performed By</label>
                <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-lg">
                  <User className="h-5 w-5 text-blue-600" />
                  <div>
                    <div className="font-medium">{activity.performedBy.name}</div>
                    <div className="text-sm text-muted-foreground">
                      {activity.performedBy.role} • ID: {activity.performedBy.id.slice(0, 8)}...
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Entity Data */}
            {activity.entityData && (
              <div className="space-y-2">
                <label className="text-sm font-medium text-muted-foreground">Additional Details</label>
                <div className="bg-gray-50 p-4 rounded-lg space-y-3">
                  {renderEntityData(activity.type, activity.entityData, currency)}
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex justify-end gap-2 pt-4 border-t">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            </div>
          </div>
        ) : (
          <div className="text-muted-foreground text-sm text-center py-8">
            No details available.
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

export { ActivityDetailsSheet }