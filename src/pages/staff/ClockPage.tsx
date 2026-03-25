/**
 * ClockPage — Staff clock-in/out via QR code scan.
 * Mobile-first, full-screen, no sidebar.
 * Route: /staff/clock?t=TOKEN
 */

import { useState, useEffect, useCallback } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { Loader2, LogIn, LogOut, CheckCircle2, AlertTriangle, MapPin, Clock, Home } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { format } from 'date-fns'
import { toast } from 'sonner'
import { useStaffRole } from '@/hooks/use-staff-role'
import {
  isValidToken,
  getCurrentLocation,
  isWithinHotel,
  getTodayRecord,
  clockIn,
  clockOut,
  type AttendanceRecord,
} from '@/services/attendance-service'

export function ClockPage() {
  const { userId, staffRecord, loading: roleLoading } = useStaffRole()
  const [searchParams] = useSearchParams()
  const token = searchParams.get('t')

  const [todayRecord, setTodayRecord] = useState<AttendanceRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [acting, setActing] = useState(false)
  const [now, setNow] = useState(new Date())
  const [tokenWarning, setTokenWarning] = useState(false)
  const [gpsWarning, setGpsWarning] = useState(false)
  const [done, setDone] = useState<'in' | 'out' | null>(null)

  // Live clock tick
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  // Validate token from URL (Phase 2)
  useEffect(() => {
    if (token && !isValidToken(token)) setTokenWarning(true)
  }, [token])

  // Load today's record once auth is ready
  const load = useCallback(async (uid: string) => {
    setLoading(true)
    try {
      const rec = await getTodayRecord(uid)
      setTodayRecord(rec)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!roleLoading && userId) load(userId)
  }, [roleLoading, userId, load])

  // ─── Actions ───────────────────────────────────────────────────────────────

  const handleClockIn = async () => {
    if (!userId || !staffRecord) return
    setActing(true)
    try {
      // GPS soft-check (Phase 2)
      const coords = await getCurrentLocation()
      let outsideHotel = false
      if (coords && !isWithinHotel(coords.lat, coords.lng)) {
        setGpsWarning(true)
        outsideHotel = true
      }
      const rec = await clockIn(userId, staffRecord.name, outsideHotel ? { notes: 'GPS: clocked in outside hotel premises' } : undefined)
      setTodayRecord(rec)
      setDone('in')
      toast.success('Clocked in! Have a great shift.')
    } catch {
      toast.error('Failed to clock in. Please try again.')
    } finally {
      setActing(false)
    }
  }

  const handleClockOut = async () => {
    if (!userId) return
    setActing(true)
    try {
      const updated = await clockOut(userId)
      if (updated) {
        setTodayRecord(updated)
        setDone('out')
        toast.success('Clocked out. Have a good rest!')
      } else {
        toast.error('No clock-in found for today.')
      }
    } catch {
      toast.error('Failed to clock out. Please try again.')
    } finally {
      setActing(false)
    }
  }

  // ─── Derived state ─────────────────────────────────────────────────────────

  const hasClockIn = Boolean(todayRecord?.clockIn)
  const hasClockOut = Boolean(todayRecord?.clockOut)
  const shiftDone = done === 'out' || hasClockOut

  const greeting = () => {
    const h = now.getHours()
    if (h < 12) return 'Good morning'
    if (h < 17) return 'Good afternoon'
    return 'Good evening'
  }

  // ─── Loading state ─────────────────────────────────────────────────────────

  if (roleLoading || loading) {
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
        <Link
          to="/staff/dashboard"
          className="flex items-center gap-1.5 text-xs text-white/80 hover:text-white transition-colors"
        >
          <Home className="w-3.5 h-3.5" />
          Dashboard
        </Link>
      </div>

      {/* Warning banners */}
      {tokenWarning && (
        <div className="bg-amber-50 border-b border-amber-200 px-5 py-3 flex items-start gap-2 text-sm text-amber-800">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>This QR code may be expired. Scan the latest code at the hotel entrance for full security. You can still clock in below.</span>
        </div>
      )}
      {gpsWarning && (
        <div className="bg-amber-50 border-b border-amber-200 px-5 py-3 flex items-start gap-2 text-sm text-amber-800">
          <MapPin className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>You appear to be outside the hotel. Your clock-in has been logged and flagged for admin review.</span>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-10">
        <div className="w-full max-w-sm space-y-8">

          {/* Greeting + live clock */}
          <div className="text-center">
            <p className="text-sm text-muted-foreground">{greeting()},</p>
            <h1 className="text-2xl font-bold mt-0.5 mb-5">
              {staffRecord?.name || 'Staff'}
            </h1>
            <p className="text-5xl font-mono font-bold text-primary tracking-tight">
              {format(now, 'HH:mm:ss')}
            </p>
            <p className="text-sm text-muted-foreground mt-2">
              {format(now, 'EEEE, d MMMM yyyy')}
            </p>
          </div>

          {/* Today's record summary */}
          {todayRecord && (
            <div className="bg-muted/40 rounded-xl px-5 py-4 text-sm space-y-2 border">
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
                  <span className="text-muted-foreground">Hours worked</span>
                  <span className="font-semibold text-primary">{todayRecord.hoursWorked}h</span>
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
              <p className="text-sm text-muted-foreground">
                You worked {todayRecord?.hoursWorked ?? 0}h today. Have a good rest!
              </p>
            </div>
          ) : hasClockIn ? (
            <div className="space-y-3">
              <Button
                size="lg"
                variant="destructive"
                className="w-full h-16 text-lg font-semibold gap-3 rounded-xl shadow-lg"
                onClick={handleClockOut}
                disabled={acting}
              >
                {acting
                  ? <Loader2 className="w-5 h-5 animate-spin" />
                  : <LogOut className="w-5 h-5" />}
                Clock Out
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                Clocked in at {todayRecord?.clockIn} · tap to end your shift
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <Button
                size="lg"
                className="w-full h-16 text-lg font-semibold gap-3 rounded-xl shadow-lg"
                onClick={handleClockIn}
                disabled={acting}
              >
                {acting
                  ? <Loader2 className="w-5 h-5 animate-spin" />
                  : <LogIn className="w-5 h-5" />}
                Clock In
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                Tap to start your shift
              </p>
            </div>
          )}

          {done === 'in' && !shiftDone && (
            <p className="text-center text-sm text-muted-foreground">
              ✓ Clocked in at {todayRecord?.clockIn}. Have a productive shift!
            </p>
          )}

        </div>
      </div>
    </div>
  )
}
