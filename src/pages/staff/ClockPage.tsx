/**
 * ClockPage — Staff clock-in/out via QR code scan (v3).
 *
 * Tamper-resistant flow:
 *  - Server-issued HMAC QR token (validated server-side only — a missing
 *    token shows a scan-QR state; a rejected one shows a rescan state)
 *  - Selfie capture + upload when attendance_settings.photo_required
 *  - Multi-sample GPS (best of 3 in 5 s) + mock-location signal
 *  - Server-side validation (token, geofence, accuracy, device binding, rate limits)
 *  - Real-time manager override flow for legitimately blocked staff (clock-in only)
 *
 * Route: /staff/clock?t=TOKEN
 */

import { useState, useEffect, useCallback } from 'react'
import type { ReactNode } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import {
  Loader2, LogIn, LogOut, CheckCircle2, AlertTriangle,
  MapPin, Clock, Home, Navigation, Smartphone, ShieldAlert,
  Camera, QrCode, WifiOff,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { format } from 'date-fns'
import { toast } from 'sonner'
import { useStaffRole } from '@/hooks/use-staff-role'
import { supabase } from '@/lib/supabase'
import {
  accraTodayStr,
  clockInServer,
  clockOutServer,
  getAttendanceSettings,
  getCurrentAttendanceState,
  getOverride,
  requestOverride,
  resolveLocationMultiSample,
  uploadAttendancePhoto,
  type AttendanceRecord,
  type ClockError,
  type LocationData,
  type OverrideReason,
} from '@/services/attendance-service'
import { getDeviceFingerprint } from '@/services/device-fingerprint'
import { SelfieCapture } from '@/components/attendance/SelfieCapture'

type Phase =
  | 'loading'
  | 'no_token'
  | 'idle'
  | 'clocked_in'
  | 'done'
  | 'camera'
  | 'uploading'
  | 'acquiring'
  | 'submitting'
  | 'success_in'
  | 'success_out'
  | 'blocked_token'
  | 'blocked_geofence'
  | 'blocked_accuracy'
  | 'blocked_device'
  | 'blocked_no_location'
  | 'blocked_photo'
  | 'blocked_rate'
  | 'blocked_network'
  | 'blocked_auth'
  | 'blocked_no_open'
  | 'override_form'
  | 'override_pending'
  | 'override_rejected'

type FlowKind = 'in' | 'out'

interface BlockInfo {
  distance?: number
  accuracy?: number
  message?: string
}

export function ClockPage() {
  const { userId, staffRecord, isLoading: roleLoading } = useStaffRole()
  const [searchParams] = useSearchParams()
  const token = searchParams.get('t') ?? ''

  const [phase, setPhase] = useState<Phase>('loading')
  const [openRecord, setOpenRecord] = useState<AttendanceRecord | null>(null)
  const [completedRecord, setCompletedRecord] = useState<AttendanceRecord | null>(null)
  const [now, setNow] = useState(new Date())
  const [device, setDevice] = useState<{ fp: string; label: string } | null>(null)
  const [photoRequired, setPhotoRequired] = useState(false)
  const [flowKind, setFlowKind] = useState<FlowKind>('in')
  const [photoPath, setPhotoPath] = useState<string | null>(null)
  const [location, setLocation] = useState<LocationData | null>(null)
  const [blockInfo, setBlockInfo] = useState<BlockInfo | null>(null)
  const [result, setResult] = useState<{ lateMinutes: number; hours?: number } | null>(null)
  const [overrideReason, setOverrideReason] = useState<OverrideReason>('gps_drift')
  const [overrideNote, setOverrideNote] = useState('')
  const [overrideId, setOverrideId] = useState<string | null>(null)
  const [overrideRejection, setOverrideRejection] = useState<string | null>(null)

  // Live clock tick (display only — the server is authoritative for all times)
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  // Resolve device fingerprint once on mount
  useEffect(() => {
    getDeviceFingerprint()
      .then(setDevice)
      .catch(() => setDevice({ fp: 'unknown', label: 'Unknown device' }))
  }, [])

  // Load attendance settings once (photo requirement gate)
  useEffect(() => {
    getAttendanceSettings().then((s) => {
      if (s) setPhotoRequired(s.photoRequired)
    })
  }, [])

  // Reload records and derive the base phase (open shift / done / idle)
  const refreshRecords = useCallback(async (): Promise<Phase> => {
    const { open, todayCompleted } = await getCurrentAttendanceState()
    setOpenRecord(open)
    setCompletedRecord(todayCompleted)
    return open ? 'clocked_in' : todayCompleted ? 'done' : 'idle'
  }, [])

  // Initial state resolution once auth has settled
  useEffect(() => {
    if (roleLoading) return
    if (!userId) {
      setPhase('blocked_auth')
      return
    }
    if (!token) {
      setPhase('no_token')
      return
    }
    refreshRecords().then(setPhase)
  }, [roleLoading, userId, token, refreshRecords])

  // ─── Failure mapping (shared by clock-in and clock-out) ─────────────────────

  const handleFailure = useCallback(
    async (error: ClockError, info: BlockInfo) => {
      setBlockInfo(info)
      switch (error) {
        case 'invalid_token':
          setPhase('blocked_token')
          break
        case 'outside_geofence':
          setPhase('blocked_geofence')
          break
        case 'low_gps_accuracy':
          setPhase('blocked_accuracy')
          break
        case 'device_mismatch':
          setPhase('blocked_device')
          break
        case 'no_location':
          setBlockInfo({ message: 'The server needs your location to clock you. Allow location access and try again.' })
          setPhase('blocked_no_location')
          break
        case 'rate_limited':
          setPhase('blocked_rate')
          break
        case 'photo_required':
          setBlockInfo({ message: 'The lodge requires a selfie when clocking. Take a quick photo to continue.' })
          setPhase('blocked_photo')
          break
        case 'no_open_record':
          setPhase('blocked_no_open')
          break
        case 'network':
          setBlockInfo({ message: 'No connection — clocking requires internet. Check your data or Wi-Fi and try again.' })
          setPhase('blocked_network')
          break
        case 'not_authenticated':
          setPhase('blocked_auth')
          break
        case 'already_clocked_in':
          toast.info('You are already clocked in.')
          setPhase(await refreshRecords())
          break
        default: // not_admin | unknown — not expected here; treat as a retryable fault
          setBlockInfo({ message: 'Something went wrong. Please try again.' })
          setPhase('blocked_network')
      }
    },
    [refreshRecords]
  )

  // ─── Clock flows ────────────────────────────────────────────────────────────

  /** GPS acquisition + server submission. Photo (if any) is already uploaded. */
  const runClock = useCallback(
    async (kind: FlowKind, path: string | null, overrideRequestId?: string) => {
      if (!device) return
      setBlockInfo(null)
      setPhase('acquiring')

      const gps = await resolveLocationMultiSample(3, 5000)
      if (gps === 'denied') {
        setBlockInfo({
          message:
            'Location permission denied. Turn on Location on your phone and allow it for your browser in Settings, then try again.',
        })
        setPhase('blocked_no_location')
        return
      }
      if (gps === null) {
        setBlockInfo({ message: "We couldn't read your GPS. Move outside or near a window and try again." })
        setPhase('blocked_no_location')
        return
      }
      setLocation(gps.best)
      setPhase('submitting')

      if (kind === 'in') {
        const res = await clockInServer({
          token,
          location: gps.best,
          samples: gps.samples,
          mockDetected: gps.mockDetected,
          device,
          photoPath: path,
          overrideRequestId,
        })
        if (res.ok === true) {
          setResult({ lateMinutes: res.lateMinutes })
          await refreshRecords()
          setPhase('success_in')
          toast.success('Clocked in. Have a great shift!')
          return
        }
        await handleFailure(res.error, { distance: res.distance, accuracy: res.accuracy })
      } else {
        const res = await clockOutServer({
          token,
          location: gps.best,
          samples: gps.samples,
          mockDetected: gps.mockDetected,
          photoPath: path,
        })
        if (res.ok === true) {
          setResult({ lateMinutes: 0, hours: res.hours })
          await refreshRecords()
          setPhase('success_out')
          toast.success(`Clocked out — you worked ${res.hours}h.`)
          return
        }
        await handleFailure(res.error, { distance: res.distance })
      }
    },
    [device, token, refreshRecords, handleFailure]
  )

  /** Entry point for the big buttons: camera first when photos are required. */
  const startFlow = useCallback(
    (kind: FlowKind) => {
      if (!token) {
        setPhase('no_token')
        return
      }
      if (!device) {
        toast.error('Still identifying this device — try again in a moment.')
        return
      }
      setFlowKind(kind)
      setPhotoPath(null)
      setResult(null)
      setBlockInfo(null)
      if (photoRequired) setPhase('camera')
      else runClock(kind, null)
    },
    [token, device, photoRequired, runClock]
  )

  /** Selfie confirmed → upload, then continue into GPS + submit. */
  const onPhoto = useCallback(
    async (blob: Blob) => {
      setPhase('uploading')
      const res = await uploadAttendancePhoto(blob, flowKind)
      if ('error' in res) {
        setBlockInfo({ message: `Photo upload failed (${res.error}). Retake the photo and try again.` })
        setPhase('blocked_photo')
        return
      }
      setPhotoPath(res.path)
      await runClock(flowKind, res.path)
    },
    [flowKind, runClock]
  )

  /** Retry after a blocked state without recapturing the photo. */
  const retryClock = useCallback(() => {
    runClock(flowKind, photoPath)
  }, [runClock, flowKind, photoPath])

  /** Leave a success / terminal state for the freshly-derived base phase. */
  const leaveSuccess = useCallback(async () => {
    setPhase(await refreshRecords())
  }, [refreshRecords])

  // ─── Override flow (clock-in only) ──────────────────────────────────────────

  const submitOverride = useCallback(async () => {
    if (!device) return
    const res = await requestOverride({
      reason: overrideReason,
      reasonNote: overrideNote.trim() || undefined,
      location,
      device,
    })
    if ('error' in res) {
      toast.error(`Could not send override: ${res.error}`)
      return
    }
    setOverrideId(res.id)
    setPhase('override_pending')
    toast.info('Override sent to your manager.')
  }, [device, overrideReason, overrideNote, location])

  // Watch the override request while pending (realtime + 4 s polling fallback)
  useEffect(() => {
    if (phase !== 'override_pending' || !overrideId) return
    let active = true

    const stop = () => {
      active = false
      if (poll) clearInterval(poll)
      supabase.removeChannel(channel)
    }

    const handleUpdate = (status: string, adminNote: string | null) => {
      if (!active) return
      if (status === 'approved') {
        stop()
        setOverrideId(null)
        setOverrideNote('')
        // Auto-retry clock-in carrying the approved override id
        runClock('in', photoPath, overrideId)
      } else if (status === 'rejected' || status === 'expired') {
        stop()
        setOverrideId(null)
        setOverrideRejection(adminNote ?? (status === 'expired' ? 'The override request expired.' : null))
        setPhase('override_rejected')
      }
    }

    const channel = supabase
      .channel(`override-${overrideId}`)
      .on(
        'postgres_changes' as any,
        { event: 'UPDATE', schema: 'public', table: 'attendance_override_requests', filter: `id=eq.${overrideId}` },
        (payload: any) => handleUpdate(payload.new?.status, payload.new?.admin_note ?? null)
      )
      .subscribe()

    const poll = setInterval(async () => {
      if (!active) return
      const ovr = await getOverride(overrideId)
      if (ovr) handleUpdate(ovr.status, (ovr as any).admin_note ?? null)
    }, 4000)

    return () => stop()
  }, [phase, overrideId, photoPath, runClock])

  // ─── Derived state ──────────────────────────────────────────────────────────

  const greeting = () => {
    const h = now.getHours()
    if (h < 12) return 'Good morning'
    if (h < 17) return 'Good afternoon'
    return 'Good evening'
  }

  if (roleLoading || phase === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    )
  }

  // ─── Action area per phase ──────────────────────────────────────────────────

  const renderAction = (): ReactNode => {
    switch (phase) {
      case 'no_token':
        return (
          <div className="text-center space-y-4 py-6">
            <QrCode className="w-14 h-14 text-primary mx-auto" />
            <p className="text-lg font-semibold">Scan the QR code displayed at the lodge</p>
            <p className="text-sm text-muted-foreground">
              The QR code is shown at the front desk. Open this page by scanning it.
            </p>
          </div>
        )

      case 'idle':
        return (
          <div className="space-y-3">
            <Button
              size="lg"
              className="w-full h-16 text-lg font-semibold gap-3 rounded-xl shadow-lg"
              onClick={() => startFlow('in')}
              disabled={!device}
            >
              <LogIn className="w-5 h-5" />
              Clock In
            </Button>
            <p className="text-center text-xs text-muted-foreground">Tap to start your shift</p>
          </div>
        )

      case 'clocked_in':
        return (
          <Button
            size="lg"
            variant="destructive"
            className="w-full h-16 text-lg font-semibold gap-3 rounded-xl shadow-lg"
            onClick={() => startFlow('out')}
            disabled={!device}
          >
            <LogOut className="w-5 h-5" />
            Clock Out
          </Button>
        )

      case 'done':
        return (
          <div className="text-center space-y-2 py-4">
            <div className="flex items-center justify-center gap-2 text-green-600">
              <CheckCircle2 className="w-6 h-6" />
              <span className="text-lg font-semibold">Shift complete!</span>
            </div>
            <p className="text-sm text-muted-foreground">You worked {completedRecord?.hoursWorked ?? 0}h today.</p>
          </div>
        )

      case 'camera':
        return (
          <SelfieCapture
            title={flowKind === 'in' ? 'Clock-in selfie' : 'Clock-out selfie'}
            onCapture={onPhoto}
            onCancel={() => setPhase(flowKind === 'in' ? 'idle' : 'clocked_in')}
          />
        )

      case 'uploading':
        return <WorkingCard icon={<Loader2 className="w-6 h-6 text-primary animate-spin" />} label="Uploading photo…" />

      case 'acquiring':
        return <WorkingCard icon={<Navigation className="w-6 h-6 text-primary animate-pulse" />} label="Acquiring your location…" />

      case 'submitting':
        return <WorkingCard icon={<Loader2 className="w-6 h-6 text-primary animate-spin" />} label="Verifying…" />

      case 'success_in':
        return (
          <div className="text-center space-y-3 py-4">
            <CheckCircle2 className="w-10 h-10 text-green-600 mx-auto" />
            <p className="text-lg font-semibold">Clocked in</p>
            {result && result.lateMinutes > 0 ? (
              <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">Late by {result.lateMinutes} min</Badge>
            ) : (
              <Badge className="bg-green-100 text-green-700 hover:bg-green-100">On time</Badge>
            )}
            <p className="text-sm text-muted-foreground">Have a productive shift!</p>
            <Button className="w-full h-12" onClick={leaveSuccess}>
              Done
            </Button>
          </div>
        )

      case 'success_out':
        return (
          <div className="text-center space-y-3 py-4">
            <CheckCircle2 className="w-10 h-10 text-green-600 mx-auto" />
            <p className="text-lg font-semibold">Clocked out</p>
            <p className="text-sm text-muted-foreground">
              You worked {result?.hours ?? completedRecord?.hoursWorked ?? 0}h. Have a good rest!
            </p>
            <Button className="w-full h-12" onClick={leaveSuccess}>
              Done
            </Button>
          </div>
        )

      case 'blocked_token':
        return (
          <BlockedCard
            icon={<AlertTriangle className="w-6 h-6 text-amber-600" />}
            title="QR code rotated"
            body="This QR code is no longer valid — the code at the lodge rotates regularly. Scan the current one displayed at the front desk."
          />
        )

      case 'blocked_geofence':
        return (
          <BlockedCard
            icon={<MapPin className="w-6 h-6 text-amber-600" />}
            title="Outside the lodge"
            body={
              <>
                {blockInfo?.distance != null ? `You are ${Math.round(blockInfo.distance)} m from the lodge. ` : ''}
                {flowKind === 'in'
                  ? 'You must be at the lodge to clock in. If the GPS is wrong, you can ask your manager for an override.'
                  : 'You must be at the lodge to clock out. If you have already left, contact your manager to correct your time.'}
              </>
            }
          >
            <div className="space-y-2">
              {flowKind === 'in' && (
                <Button
                  className="w-full h-12"
                  onClick={() => {
                    setOverrideReason('gps_drift')
                    setPhase('override_form')
                  }}
                >
                  Request manager override
                </Button>
              )}
              <Button variant="outline" className="w-full h-12" onClick={retryClock}>
                Try again
              </Button>
            </div>
          </BlockedCard>
        )

      case 'blocked_accuracy':
        return (
          <BlockedCard
            icon={<Navigation className="w-6 h-6 text-amber-600" />}
            title="GPS too imprecise"
            body={
              <>
                {blockInfo?.accuracy != null ? `Your phone reported ±${Math.round(blockInfo.accuracy)} m accuracy. ` : ''}
                Move outdoors, away from thick walls and roofs, and try again.
              </>
            }
          >
            <Button className="w-full h-12" onClick={retryClock}>
              Try again
            </Button>
          </BlockedCard>
        )

      case 'blocked_device':
        return (
          <BlockedCard
            icon={<Smartphone className="w-6 h-6 text-amber-600" />}
            title="Unknown device"
            body={
              flowKind === 'in'
                ? "This phone isn't registered to your account. New phone? Your manager can approve it with an override."
                : "This phone isn't registered to your account. Please use your usual phone or contact your manager."
            }
          >
            <div className="space-y-2">
              {flowKind === 'in' && (
                <Button
                  className="w-full h-12"
                  onClick={() => {
                    setOverrideReason('new_device')
                    setPhase('override_form')
                  }}
                >
                  Request manager override
                </Button>
              )}
              <Button variant="outline" className="w-full h-12" onClick={retryClock}>
                Try again
              </Button>
            </div>
          </BlockedCard>
        )

      case 'blocked_no_location':
        return (
          <BlockedCard
            icon={<MapPin className="w-6 h-6 text-amber-600" />}
            title="Location unavailable"
            body={blockInfo?.message ?? "We couldn't read your GPS. Move outside and try again."}
          >
            <Button className="w-full h-12" onClick={retryClock}>
              Try again
            </Button>
          </BlockedCard>
        )

      case 'blocked_photo':
        return (
          <BlockedCard
            icon={<Camera className="w-6 h-6 text-amber-600" />}
            title="Photo needed"
            body={blockInfo?.message ?? 'A selfie photo is required to clock. Take a quick photo to continue.'}
          >
            <Button
              className="w-full h-12 gap-2"
              onClick={() => {
                setPhotoPath(null)
                setPhase('camera')
              }}
            >
              <Camera className="w-4 h-4" />
              Take photo
            </Button>
          </BlockedCard>
        )

      case 'blocked_rate':
        return (
          <BlockedCard
            icon={<AlertTriangle className="w-6 h-6 text-amber-600" />}
            title="Too many attempts"
            body="Too many clocking attempts. Wait 10 minutes, then try again."
          >
            <Button variant="outline" className="w-full h-12" onClick={leaveSuccess}>
              Back
            </Button>
          </BlockedCard>
        )

      case 'blocked_network':
        return (
          <BlockedCard
            icon={<WifiOff className="w-6 h-6 text-amber-600" />}
            title="No connection"
            body={blockInfo?.message ?? 'Clocking requires internet. Check your connection and try again.'}
          >
            <Button className="w-full h-12" onClick={retryClock}>
              Try again
            </Button>
          </BlockedCard>
        )

      case 'blocked_auth':
        return (
          <BlockedCard
            icon={<ShieldAlert className="w-6 h-6 text-amber-600" />}
            title="Session expired"
            body="Please log in again to clock in or out."
          >
            <Button asChild className="w-full h-12">
              <Link to="/staff/login">Log in again</Link>
            </Button>
          </BlockedCard>
        )

      case 'blocked_no_open':
        return (
          <BlockedCard
            icon={<AlertTriangle className="w-6 h-6 text-amber-600" />}
            title="Nothing to clock out of"
            body="You have no open shift. If you already clocked in elsewhere, go back and check, or contact your manager."
          >
            <Button variant="outline" className="w-full h-12" onClick={leaveSuccess}>
              Back
            </Button>
          </BlockedCard>
        )

      case 'override_form':
        return (
          <div className="space-y-3 border rounded-xl p-4 bg-card">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-amber-600" />
              <p className="font-semibold">Request manager override</p>
            </div>
            <Select value={overrideReason} onValueChange={(v) => setOverrideReason(v as OverrideReason)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="gps_drift">GPS problem at the lodge</SelectItem>
                <SelectItem value="new_device">New phone / device</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
            <Textarea
              placeholder="Optional note for your manager…"
              value={overrideNote}
              onChange={(e) => setOverrideNote(e.target.value)}
              rows={3}
            />
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1 h-12" onClick={() => setPhase('idle')}>
                Cancel
              </Button>
              <Button className="flex-1 h-12" onClick={submitOverride}>
                Send
              </Button>
            </div>
          </div>
        )

      case 'override_pending':
        return (
          <div className="text-center space-y-3 py-4">
            <Loader2 className="w-8 h-8 text-primary animate-spin mx-auto" />
            <p className="font-semibold">Waiting for manager approval…</p>
            <p className="text-xs text-muted-foreground">
              Stay on this screen. You'll be clocked in automatically once approved.
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setOverrideId(null)
                setPhase('idle')
              }}
            >
              Cancel
            </Button>
          </div>
        )

      case 'override_rejected':
        return (
          <div className="space-y-3">
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-800">
              <p className="font-semibold mb-1">Override rejected</p>
              {overrideRejection && <p className="text-xs">{overrideRejection}</p>}
            </div>
            <Button variant="outline" className="w-full h-12" onClick={() => setPhase('idle')}>
              Back
            </Button>
          </div>
        )

      default:
        return null
    }
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Top bar */}
      <div className="bg-primary text-primary-foreground px-5 py-4 flex items-center gap-3 shadow-md">
        <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center flex-shrink-0">
          <Clock className="w-4 h-4" />
        </div>
        <span className="font-bold text-base flex-1">AMP Lodge</span>
        <Link to="/staff/dashboard" className="flex items-center gap-1.5 text-xs text-white/80 hover:text-white">
          <Home className="w-3.5 h-3.5" />
          Dashboard
        </Link>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-6 py-10">
        <div className="w-full max-w-sm space-y-8">
          {/* Greeting + live clock */}
          <div className="text-center">
            <p className="text-sm text-muted-foreground">{greeting()},</p>
            <h1 className="text-2xl font-bold mt-0.5 mb-5">{staffRecord?.name || 'Staff'}</h1>
            <p className="text-5xl font-mono font-bold text-primary tracking-tight">{format(now, 'HH:mm:ss')}</p>
            <p className="text-sm text-muted-foreground mt-2">{format(now, 'EEEE, d MMMM yyyy')}</p>
          </div>

          {/* Open-shift summary */}
          {phase === 'clocked_in' && openRecord && (
            <div className="rounded-xl px-5 py-4 text-sm space-y-2 border bg-muted/40">
              {openRecord.date !== accraTodayStr() && (
                <p className="text-xs text-amber-700 font-medium">Overnight shift from {openRecord.date}</p>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground">Clocked in at</span>
                <span className="font-semibold">{openRecord.clockIn.slice(0, 5)}</span>
              </div>
            </div>
          )}

          {renderAction()}
        </div>
      </div>
    </div>
  )
}

function WorkingCard({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-4">
      {icon}
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  )
}

function BlockedCard({
  icon,
  title,
  body,
  children,
}: {
  icon: ReactNode
  title: string
  body: ReactNode
  children?: ReactNode
}) {
  return (
    <div className="border rounded-xl p-5 space-y-3 bg-amber-50/40">
      <div className="flex items-center gap-2">
        {icon}
        <p className="font-semibold">{title}</p>
      </div>
      <div className="text-sm text-muted-foreground">{body}</div>
      {children}
    </div>
  )
}
