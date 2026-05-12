/**
 * Admin panel for live override requests from staff who are blocked from
 * clocking in (GPS drift, new device, etc).
 *
 * Auto-hides when there are no pending requests. Realtime-driven via the
 * `attendance_override_requests` table subscription already wired through
 * `useSubscription`.
 */

import { useCallback, useEffect, useState } from 'react'
import { ShieldAlert, MapPin, Smartphone, Check, X, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { useSubscription } from '@/hooks/use-subscription'
import {
  listPendingOverrides,
  approveOverride,
  rejectOverride,
  type OverrideRequest,
} from '@/services/attendance-service'

export function OverridePanel({ adminId }: { adminId: string }) {
  const [pending, setPending] = useState<OverrideRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [acting, setActing] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setPending(await listPendingOverrides())
    } finally {
      setLoading(false)
    }
  }, [])

  const updatedAt = useSubscription('attendance_override_requests')

  useEffect(() => { refresh() }, [refresh, updatedAt])

  const handleApprove = async (id: string) => {
    setActing(id)
    try {
      await approveOverride(id, adminId)
      toast.success('Override approved.')
      await refresh()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setActing(null)
    }
  }

  const handleReject = async (id: string) => {
    setActing(id)
    try {
      await rejectOverride(id, adminId)
      toast.success('Override rejected.')
      await refresh()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setActing(null)
    }
  }

  if (loading) return null
  if (pending.length === 0) return null

  return (
    <div className="border-2 border-amber-300 bg-amber-50/60 rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 bg-amber-100/60 border-b border-amber-200">
        <ShieldAlert className="w-5 h-5 text-amber-700" />
        <span className="font-semibold text-amber-900">
          Override Requests — {pending.length} pending
        </span>
      </div>
      <div className="divide-y divide-amber-200">
        {pending.map(r => (
          <div key={r.id} className="px-4 py-3 flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap text-sm">
                <span className="font-semibold">{r.staffName}</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-amber-200/60 text-amber-900">
                  {reasonLabel(r.reason)}
                </span>
                {r.distance != null && (
                  <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                    <MapPin className="w-3 h-3" /> {Math.round(r.distance)} m
                  </span>
                )}
                {r.deviceLabel && (
                  <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                    <Smartphone className="w-3 h-3" /> {r.deviceLabel}
                  </span>
                )}
              </div>
              {r.reasonNote && (
                <p className="text-xs text-muted-foreground mt-1 italic">"{r.reasonNote}"</p>
              )}
            </div>
            <div className="flex gap-1">
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1 text-green-700 hover:bg-green-50"
                disabled={acting === r.id}
                onClick={() => handleApprove(r.id)}
              >
                {acting === r.id
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <Check className="w-3.5 h-3.5" />}
                Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1 text-red-700 hover:bg-red-50"
                disabled={acting === r.id}
                onClick={() => handleReject(r.id)}
              >
                <X className="w-3.5 h-3.5" />
                Reject
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function reasonLabel(r: string): string {
  switch (r) {
    case 'gps_drift': return 'GPS issue'
    case 'new_device': return 'New device'
    default: return 'Other'
  }
}
