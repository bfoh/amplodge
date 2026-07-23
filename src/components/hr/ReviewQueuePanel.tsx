/**
 * Review queue — flagged attendance records from the last 14 days that no
 * admin has reviewed yet (and that haven't been voided). Each item exposes
 * the evidence (clock-in selfie, GPS fix, distance) and two actions:
 * "Mark reviewed" (dismiss) and "Void…" (keep row, exclude from totals).
 *
 * Auto-hides when the queue is empty. Realtime-driven via the hr_attendance
 * table subscription.
 */

import { useCallback, useEffect, useState } from 'react'
import { Flag, MapPin, Check, Loader2, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { toast } from 'sonner'
import { db } from '@/lib/db'
import { useSubscription } from '@/hooks/use-subscription'
import {
  getAttendancePhotoUrl,
  markReviewed,
  voidRecord,
} from '@/services/attendance-service'
import { activityLogService } from '@/services/activity-log-service'

// Row shape as returned by db.hr_attendance.list (snake_case → camelCase).
interface QueueRow {
  id: string
  staffId: string
  staffName: string
  date: string
  clockIn: string
  flags?: string[] | null
  gpsLat?: number | null
  gpsLng?: number | null
  gpsDistance?: number | null
  reviewedAt?: string | null
  voidedAt?: string | null
  clockInPhotoPath?: string | null
}

const DAY_MS = 24 * 60 * 60 * 1000

export function ReviewQueuePanel({ adminId }: { adminId: string }) {
  const [rows, setRows] = useState<QueueRow[]>([])
  const [loading, setLoading] = useState(true)
  const [acting, setActing] = useState<string | null>(null)
  const [voidTarget, setVoidTarget] = useState<QueueRow | null>(null)
  const [voidReason, setVoidReason] = useState('')

  const refresh = useCallback(async () => {
    try {
      const all: QueueRow[] = (await db.hr_attendance.list({ orderBy: { createdAt: 'desc' } })) || []
      const cutoff = Date.now() - 14 * DAY_MS
      setRows(
        all
          .filter(r =>
            (r.flags?.length ?? 0) > 0 &&
            !r.reviewedAt &&
            !r.voidedAt &&
            new Date(r.date).getTime() >= cutoff
          )
          .slice(0, 50)
      )
    } finally {
      setLoading(false)
    }
  }, [])

  const updatedAt = useSubscription('hr_attendance')

  useEffect(() => { refresh() }, [refresh, updatedAt])

  const handleReviewed = async (r: QueueRow) => {
    setActing(r.id)
    try {
      await markReviewed(r.id)
      toast.success(`Marked ${r.staffName}'s record as reviewed.`)
      activityLogService.logAttendanceAction(
        'record_reviewed', r.id,
        { staffName: r.staffName, date: r.date, flags: r.flags ?? [] },
        adminId
      ).catch(() => {})
      await refresh()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setActing(null)
    }
  }

  const handleVoid = async () => {
    if (!voidTarget) return
    if (!voidReason.trim()) {
      toast.error('A reason is required to void a record')
      return
    }
    setActing(voidTarget.id)
    try {
      await voidRecord(voidTarget.id, voidReason.trim())
      toast.success('Record voided.')
      activityLogService.logAttendanceAction(
        'record_voided', voidTarget.id,
        { staffName: voidTarget.staffName, date: voidTarget.date, reason: voidReason.trim() },
        adminId
      ).catch(() => {})
      setVoidTarget(null)
      setVoidReason('')
      await refresh()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setActing(null)
    }
  }

  if (loading) return null
  if (rows.length === 0) return null

  return (
    <div className="border-2 border-red-200 bg-red-50/40 rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 bg-red-100/60 border-b border-red-200">
        <ShieldAlert className="w-5 h-5 text-red-700" />
        <span className="font-semibold text-red-900">
          Review Queue — {rows.length} flagged record{rows.length === 1 ? '' : 's'}
        </span>
      </div>
      <div className="divide-y divide-red-100">
        {rows.map(r => (
          <div key={r.id} className="px-4 py-3 flex items-start gap-3">
            <ReviewPhotoThumb path={r.clockInPhotoPath ?? null} alt={`${r.staffName} clock-in`} />
            <div className="flex-1 min-w-0 space-y-1">
              <div className="flex items-center gap-2 flex-wrap text-sm">
                <span className="font-semibold">{r.staffName}</span>
                <span className="text-xs text-muted-foreground">{r.date} · in {r.clockIn || '—'}</span>
                {(r.flags ?? []).map(f => (
                  <span
                    key={f}
                    className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-800 border border-red-200 whitespace-nowrap inline-flex items-center gap-1"
                  >
                    <Flag className="w-2.5 h-2.5" />
                    {f.replace(/_/g, ' ')}
                  </span>
                ))}
              </div>
              <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
                {r.gpsLat != null && r.gpsLng != null && (
                  <a
                    href={`https://www.google.com/maps?q=${r.gpsLat},${r.gpsLng}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-blue-600 hover:underline"
                  >
                    <MapPin className="w-3 h-3" /> View on map
                  </a>
                )}
                {r.gpsDistance != null && (
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="w-3 h-3" /> {Math.round(r.gpsDistance)} m from hotel
                  </span>
                )}
              </div>
            </div>
            <div className="flex gap-1 flex-shrink-0">
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1 text-green-700 hover:bg-green-50"
                disabled={acting === r.id}
                onClick={() => handleReviewed(r)}
              >
                {acting === r.id
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <Check className="w-3.5 h-3.5" />}
                Mark reviewed
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1 text-red-700 hover:bg-red-50"
                disabled={acting === r.id}
                onClick={() => { setVoidTarget(r); setVoidReason('') }}
              >
                Void…
              </Button>
            </div>
          </div>
        ))}
      </div>

      {/* Void dialog — mandatory reason */}
      <Dialog open={!!voidTarget} onOpenChange={(open) => { if (!open) setVoidTarget(null) }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Void Attendance Record</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2">
            <p className="text-sm text-muted-foreground">
              {voidTarget?.staffName} — {voidTarget?.date}. The record is kept for audit but
              excluded from totals and reports.
            </p>
            <div className="grid gap-2">
              <Label>Reason <span className="text-destructive">*</span></Label>
              <Textarea
                value={voidReason}
                onChange={e => setVoidReason(e.target.value)}
                rows={3}
                placeholder="Why is this record being voided?"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVoidTarget(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={handleVoid}
              disabled={acting === voidTarget?.id || !voidReason.trim()}
            >
              {acting === voidTarget?.id && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Void record
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/**
 * Clock-in selfie thumbnail with click-to-enlarge lightbox. The signed URL
 * (60s) is fetched lazily per row; failures render a plain placeholder.
 */
function ReviewPhotoThumb({ path, alt }: { path: string | null; alt: string }) {
  const [url, setUrl] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (!path) return
    getAttendancePhotoUrl(path, 60).then(u => { if (!cancelled) setUrl(u) })
    return () => { cancelled = true }
  }, [path])

  if (!path || !url) {
    return <span className="w-10 h-10 rounded-lg bg-muted border flex-shrink-0" aria-hidden />
  }
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex-shrink-0 rounded-lg overflow-hidden border hover:opacity-80 transition-opacity"
        title="View clock-in photo"
      >
        <img src={url} alt={alt} className="w-10 h-10 object-cover" loading="lazy" />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{alt}</DialogTitle></DialogHeader>
          <img src={url} alt={alt} className="w-full rounded-lg" />
        </DialogContent>
      </Dialog>
    </>
  )
}
