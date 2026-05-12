/**
 * ClockPage — Staff clock-in/out via QR code scan (v2).
 *
 * Hardened flow:
 *  - Multi-sample GPS (best of 3 in 5 s)
 *  - Server-side validation (token + geofence + device binding) via RPC
 *  - Real-time override request flow for legitimately blocked staff
 *
 * Route: /staff/clock?t=TOKEN
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import type { ReactNode } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import {
  Loader2, LogIn, LogOut, CheckCircle2, AlertTriangle,
  MapPin, Clock, Home, Navigation, Smartphone, ShieldAlert,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { format } from 'date-fns'
import { toast } from 'sonner'
import { useStaffRole } from '@/hooks/use-staff-role'
import { supabase } from '@/lib/supabase'
import {
  isValidToken,
  resolveLocationMultiSample,
  clockInServer,
  clockOutServer,
  requestOverride,
  getOverride,
  getTodayRecord,
  parseLocationFromNotes,
  MAX_DISTANCE_METERS_V2,
  type AttendanceRecord,
  type LocationData,
  type GpsSample,
  type OverrideReason,
} from '@/services/attendance-service'
import { getDeviceFingerprint } from '@/services/device-fingerprint'

type Phase =
  | 'loading'
  | 'idle'
  | 'acquiring'
  | 'submitting'
  | 'success_in'
  | 'success_out'
  | 'blocked_token'
  | 'blocked_geofence'
  | 'blocked_device'
  | 'blocked_no_location'
  | 'override_form'
  | 'override_pending'
  | 'override_rejected'

export function ClockPage() {
  const { userId, staffRecord, isLoading: roleLoading } = useStaffRole()
  const [searchParams] = useSearchParams()
  const token = searchParams.get('t') ?? ''

  const [phase, setPhase] = useState<Phase>('loading')
  const [todayRecord, setTodayRecord] = useState<AttendanceRecord | null>(null)
  const [now, setNow] = useState(new Date())
  const [tokenWarning, setTokenWarning] = useState(false)
  const [location, setLocation] = useState<LocationData | null>(null)
  const [device, setDevice] = useState<{ fp: string; label: string } | null>(null)
  const [lastError, setLastError] = useState<{ distance?: number; accuracy?: number } | null>(null)
  const [overrideReason, setOverrideReason] = useState<OverrideReason>('gps_drift')
  const [overrideNote, setOverrideNote] = useState('')
  const [overrideId, setOverrideId] = useState<string | null>(null)
  const [overrideRejection, setOverrideRejection] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Live clock tick
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  // Token sanity (server validates authoritatively; this is a UX hint)
  useEffect(() => {
    if (token && !isValidToken(token)) setTokenWarning(true)
  }, [token])

  // Resolve device fingerprint once on mount
  useEffect(() => {
    getDeviceFingerprint().then(setDevice).catch(() => setDevice({ fp: 'unknown', label: 'Unknown device' }))
  }, [])

  // Load today's record + transition to idle
  const loadRecord = useCallback(async (uid: string) => {
    const rec = await getTodayRecord(uid)
    setTodayRecord(rec)
    if (rec?.notes) {
      const loc = parseLocationFromNotes(rec.notes)
      if (loc) setLocation(loc)
    }
    setPhase('idle')
  }, [])

  useEffect(() => {
    if (!roleLoading && userId) loadRecord(userId)
  }, [roleLoading, userId, loadRecord])

  // ─── Clock-in ───────────────────────────────────────────────────────────────

  const doClockIn = useCallback(async (opts?: { overrideRequestId?: string }) => {
    if (!userId || !staffRecord || !device) return
    setPhase('acquiring')

    const gps = await resolveLocationMultiSample(3, 5000)
    let loc: LocationData | null = null
    let smp: GpsSample[] = []
    if (gps === 'denied' || gps === null) {
      // No location — server will reject unless override pre-approved
      loc = null
      smp = []
    } else {
      loc = gps.best
      smp = gps.samples
      setLocation(loc)
    }

    setPhase('submitting')
    const res = await clockInServer({
      token,
      staffId: userId,
      staffName: staffRecord.name,
      location: loc,
      samples: smp,
      device,
      overrideRequestId: opts?.overrideRequestId,
    })

    if (res.ok === true) {
      setPhase('success_in')
      await loadRecord(userId)
      if (res.distance != null && res.distance > MAX_DISTANCE_METERS_V2) {
        toast.warning(`Clocked in via override (${Math.round(res.distance)} m from hotel).`)
      } else {
        toast.success('Clocked in. Have a great shift!')
      }
      return
    }

    // Narrowed to ClockFailure
    const fail = res
    setLastError({ distance: fail.distance, accuracy: fail.accuracy })
    if (fail.error === 'invalid_token') setPhase('blocked_token')
    else if (fail.error === 'outside_geofence') setPhase('blocked_geofence')
    else if (fail.error === 'device_mismatch') setPhase('blocked_device')
    else if (fail.error === 'no_location') setPhase('blocked_no_location')
    else {
      setPhase('idle')
      toast.error('Network problem. Please try again.')
    }
  }, [userId, staffRecord, device, token, loadRecord])

  // ─── Clock-out ──────────────────────────────────────────────────────────────

  const doClockOut = useCallback(async () => {
    if (!userId) return
    setPhase('submitting')
    const res = await clockOutServer({ token, staffId: userId })
    if (res.ok === true) {
      setPhase('success_out')
      await loadRecord(userId)
      toast.success(`Clocked out. You worked ${res.hours}h — have a good rest!`)
      return
    }
    setPhase('idle')
    if (res.error === 'invalid_token') {
      toast.error('QR expired. Scan the latest QR at the entrance.')
    } else if (res.error === 'no_open_record') {
      toast.error('No active clock-in found.')
    } else {
      toast.error('Network problem. Please try again.')
    }
  }, [userId, token, loadRecord])

  // ─── Override flow ──────────────────────────────────────────────────────────

  const submitOverride = useCallback(async () => {
    if (!userId || !staffRecord || !device) return
    const res = await requestOverride({
      staffId: userId,
      staffName: staffRecord.name,
      reason: overrideReason,
      reasonNote: overrideNote.trim() || undefined,
      location,
      device,
    })
    if ('error' in res) {
      toast.error(`Could not submit override: ${res.error}`)
      return
    }
    setOverrideId(res.id)
    setPhase('override_pending')
    toast.info('Override sent to manager.')
  }, [userId, staffRecord, device, overrideReason, overrideNote, location])

  // Poll override status while pending (realtime + 4 s fallback)
  useEffect(() => {
    if (phase !== 'override_pending' || !overrideId) return

    let active = true

    const handleUpdate = (row: any) => {
      const status = row?.status
      if (!active) return
      if (status === 'approved') {
        active = false
        if (pollRef.current) clearInterval(pollRef.current)
        pollRef.current = null
        supabase.removeChannel(channel)
        // Retry clock-in carrying the override id
        doClockIn({ overrideRequestId: overrideId })
      } else if (status === 'rejected') {
        active = false
        if (pollRef.current) clearInterval(pollRef.current)
        pollRef.current = null
        supabase.removeChannel(channel)
        setOverrideRejection(row.admin_note ?? null)
        setPhase('override_rejected')
      }
    }

    const channel = supabase
      .channel(`override-${overrideId}`)
      .on(
        'postgres_changes' as any,
        { event: 'UPDATE', schema: 'public', table: 'attendance_override_requests', filter: `id=eq.${overrideId}` },
        (payload: any) => handleUpdate(payload.new)
      )
      .subscribe()

    pollRef.current = setInterval(async () => {
      if (!active) return
      const ovr = await getOverride(overrideId)
      if (ovr) handleUpdate(ovr)
    }, 4000)

    return () => {
      active = false
      if (pollRef.current) clearInterval(pollRef.current)
      pollRef.current = null
      supabase.removeChannel(channel)
    }
  }, [phase, overrideId, doClockIn])

  // ─── Derived state ──────────────────────────────────────────────────────────

  const hasClockIn = Boolean(todayRecord?.clockIn)
  const hasClockOut = Boolean(todayRecord?.clockOut)
  const shiftDone = phase === 'success_out' || hasClockOut

  const todayDateStr = new Date().toISOString().split('T')[0]
  const isOvernightRecord = todayRecord?.date && todayRecord.date !== todayDateStr

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

      {/* Token warning */}
      {tokenWarning && (
        <div className="bg-amber-50 border-b border-amber-200 px-5 py-3 flex items-start gap-2 text-sm text-amber-800">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>This QR code may be expired. Scan the latest one at the hotel entrance.</span>
        </div>
      )}

      <div className="flex-1 flex flex-col items-center justify-center px-6 py-10">
        <div className="w-full max-w-sm space-y-8">
          {/* Greeting + live clock */}
          <div className="text-center">
            <p className="text-sm text-muted-foreground">{greeting()},</p>
            <h1 className="text-2xl font-bold mt-0.5 mb-5">{staffRecord?.name || 'Staff'}</h1>
            <p className="text-5xl font-mono font-bold text-primary tracking-tight">{format(now, 'HH:mm:ss')}</p>
            <p className="text-sm text-muted-foreground mt-2">{format(now, 'EEEE, d MMMM yyyy')}</p>
          </div>

          {/* Shift summary */}
          {todayRecord && (
            <div className={`rounded-xl px-5 py-4 text-sm space-y-2 border ${isOvernightRecord ? 'bg-amber-50 border-amber-200' : 'bg-muted/40'}`}>
              {isOvernightRecord && (
                <p className="text-xs text-amber-700 font-medium">Overnight shift from {todayRecord.date}</p>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground">Clocked in</span>
                <span className="font-semibold">{todayRecord.clockIn}</span>
              </div>
              {todayRecord.clockOut && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Clocked out</span>
                  <span className="font-semibold">{todayRecord.clockOut}</span>
                </div>
              )}
              {todayRecord.hoursWorked > 0 && (
                <div className="flex justify-between border-t pt-2 mt-1">
                  <span className="text-muted-foreground">Hours</span>
                  <span className="font-semibold text-primary">{todayRecord.hoursWorked}h</span>
                </div>
              )}
              {location && (
                <div className="flex justify-between items-center border-t pt-2 mt-1">
                  <span className="text-muted-foreground">Location</span>
                  <span className={`text-xs font-medium flex items-center gap-1 ${location.inside ? 'text-green-600' : 'text-amber-600'}`}>
                    <MapPin className="w-3 h-3" />
                    {location.inside
                      ? `Hotel (${Math.round(location.distance)} m)`
                      : `${Math.round(location.distance)} m away`}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Action area */}
          {shiftDone ? (
            <div className="text-center space-y-2 py-4">
              <div className="flex items-center justify-center gap-2 text-green-600">
                <CheckCircle2 className="w-6 h-6" />
                <span className="text-lg font-semibold">Shift complete!</span>
              </div>
              <p className="text-sm text-muted-foreground">You worked {todayRecord?.hoursWorked ?? 0}h.</p>
            </div>
          ) : hasClockIn ? (
            <Button
              size="lg"
              variant="destructive"
              className="w-full h-16 text-lg font-semibold gap-3 rounded-xl shadow-lg"
              onClick={doClockOut}
              disabled={phase === 'submitting'}
            >
              {phase === 'submitting' ? <Loader2 className="w-5 h-5 animate-spin" /> : <LogOut className="w-5 h-5" />}
              Clock Out
            </Button>
          ) : phase === 'idle' || phase === 'override_rejected' ? (
            <div className="space-y-3">
              {phase === 'override_rejected' && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-800">
                  <p className="font-semibold mb-1">Override rejected</p>
                  {overrideRejection && <p className="text-xs">{overrideRejection}</p>}
                </div>
              )}
              <Button
                size="lg"
                className="w-full h-16 text-lg font-semibold gap-3 rounded-xl shadow-lg"
                onClick={() => doClockIn()}
              >
                <LogIn className="w-5 h-5" />
                Clock In
              </Button>
              <p className="text-center text-xs text-muted-foreground">Tap to start your shift</p>
            </div>
          ) : phase === 'acquiring' ? (
            <div className="flex flex-col items-center gap-3 py-4">
              <Navigation className="w-6 h-6 text-primary animate-pulse" />
              <p className="text-sm text-muted-foreground">Acquiring your location…</p>
            </div>
          ) : phase === 'submitting' ? (
            <div className="flex flex-col items-center gap-3 py-4">
              <Loader2 className="w-6 h-6 text-primary animate-spin" />
              <p className="text-sm text-muted-foreground">Verifying…</p>
            </div>
          ) : phase === 'success_in' ? (
            <div className="text-center space-y-2 py-4">
              <CheckCircle2 className="w-10 h-10 text-green-600 mx-auto" />
              <p className="text-lg font-semibold">Clocked in</p>
              <p className="text-sm text-muted-foreground">Have a productive shift!</p>
            </div>
          ) : phase === 'blocked_token' ? (
            <BlockedCard
              icon={<AlertTriangle className="w-6 h-6 text-amber-600" />}
              title="QR expired"
              body="Please scan the latest QR code at the hotel entrance."
            />
          ) : phase === 'blocked_geofence' ? (
            <BlockedCard
              icon={<MapPin className="w-6 h-6 text-amber-600" />}
              title="Outside hotel"
              body={`You appear to be ${lastError?.distance ? Math.round(lastError.distance) + ' m' : 'far'} from the hotel. If GPS is wrong, request a manager override.`}
              actionLabel="Request override"
              onAction={() => { setOverrideReason('gps_drift'); setPhase('override_form') }}
            />
          ) : phase === 'blocked_device' ? (
            <BlockedCard
              icon={<Smartphone className="w-6 h-6 text-amber-600" />}
              title="Unknown device"
              body="This device is not registered for your account. If you have a new phone, request a manager override."
              actionLabel="Request override"
              onAction={() => { setOverrideReason('new_device'); setPhase('override_form') }}
            />
          ) : phase === 'blocked_no_location' ? (
            <BlockedCard
              icon={<MapPin className="w-6 h-6 text-amber-600" />}
              title="Location unavailable"
              body="We couldn't read your GPS. Try again outside or request a manager override."
              actionLabel="Request override"
              onAction={() => { setOverrideReason('gps_drift'); setPhase('override_form') }}
            />
          ) : phase === 'override_form' ? (
            <div className="space-y-3 border rounded-xl p-4 bg-card">
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-amber-600" />
                <p className="font-semibold">Request manager override</p>
              </div>
              <Select value={overrideReason} onValueChange={(v) => setOverrideReason(v as OverrideReason)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="gps_drift">GPS inaccurate</SelectItem>
                  <SelectItem value="new_device">New device</SelectItem>
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
                <Button variant="outline" className="flex-1" onClick={() => setPhase('idle')}>Cancel</Button>
                <Button className="flex-1" onClick={submitOverride}>Send</Button>
              </div>
            </div>
          ) : phase === 'override_pending' ? (
            <div className="text-center space-y-3 py-4">
              <Loader2 className="w-8 h-8 text-primary animate-spin mx-auto" />
              <p className="font-semibold">Waiting for manager approval…</p>
              <p className="text-xs text-muted-foreground">
                Stay on this screen. You'll be clocked in automatically once approved.
              </p>
              <Button variant="ghost" size="sm" onClick={() => { setOverrideId(null); setPhase('idle') }}>
                Cancel
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function BlockedCard({
  icon, title, body, actionLabel, onAction,
}: {
  icon: ReactNode
  title: string
  body: string
  actionLabel?: string
  onAction?: () => void
}) {
  return (
    <div className="border rounded-xl p-5 space-y-3 bg-amber-50/40">
      <div className="flex items-center gap-2">
        {icon}
        <p className="font-semibold">{title}</p>
      </div>
      <p className="text-sm text-muted-foreground">{body}</p>
      {actionLabel && onAction && (
        <Button className="w-full" onClick={onAction}>{actionLabel}</Button>
      )}
    </div>
  )
}
