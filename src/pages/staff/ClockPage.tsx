/**
 * ClockPage — Staff clock-in/out via QR code scan.
 * Mobile-first, full-screen, no sidebar.
 * Route: /staff/clock?t=TOKEN
 */

import { useState, useEffect, useCallback } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { Loader2, LogIn, LogOut, CheckCircle2, AlertTriangle, MapPin, Clock, Home, Navigation } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { format } from 'date-fns'
import { toast } from 'sonner'
import { useStaffRole } from '@/hooks/use-staff-role'
import {
  isValidToken,
  resolveLocation,
  getTodayRecord,
  clockIn,
  clockOut,
  parseLocationFromNotes,
  getNotesLabel,
  type AttendanceRecord,
  type LocationData,
} from '@/services/attendance-service'

type GpsStep = 'idle' | 'acquiring' | 'done' | 'denied' | 'unavailable'

export function ClockPage() {
  const { userId, staffRecord, loading: roleLoading } = useStaffRole()
  const [searchParams] = useSearchParams()
  const token = searchParams.get('t')

  const [todayRecord, setTodayRecord] = useState<AttendanceRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [acting, setActing] = useState(false)
  const [now, setNow] = useState(new Date())
  const [tokenWarning, setTokenWarning] = useState(false)
  const [gpsStep, setGpsStep] = useState<GpsStep>('idle')
  const [locationData, setLocationData] = useState<LocationData | null>(null)
  const [done, setDone] = useState<'in' | 'out' | null>(null)

  // Live clock tick
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  // Validate token from URL
  useEffect(() => {
    if (token && !isValidToken(token)) setTokenWarning(true)
  }, [token])

  // Load today's record once auth is ready
  const load = useCallback(async (uid: string) => {
    setLoading(true)
    try {
      const rec = await getTodayRecord(uid)
      setTodayRecord(rec)
      // Restore any previously-acquired location from the stored record
      if (rec?.notes) {
        const loc = parseLocationFromNotes(rec.notes)
        if (loc) setLocationData(loc)
      }
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
    setGpsStep('acquiring')
    try {
      // Acquire high-accuracy GPS position (up to 15 s)
      const loc = await resolveLocation()

      if (loc === 'denied') {
        setGpsStep('denied')
        // Still allow clock-in; flag for admin review
        const rec = await clockIn(userId, staffRecord.name, {
          notes: 'GPS: location access denied',
        })
        setTodayRecord(rec)
        setDone('in')
        toast.success('Clocked in. Location access was denied — flagged for review.')
      } else if (loc === null) {
        setGpsStep('unavailable')
        const rec = await clockIn(userId, staffRecord.name, {
          notes: 'GPS: location unavailable',
        })
        setTodayRecord(rec)
        setDone('in')
        toast.success('Clocked in. Could not determine your location — flagged for review.')
      } else {
        setGpsStep('done')
        setLocationData(loc)
        const rec = await clockIn(userId, staffRecord.name, { location: loc })
        setTodayRecord(rec)
        setDone('in')
        if (loc.inside) {
          toast.success(`Clocked in at the hotel (${Math.round(loc.distance)} m). Have a great shift!`)
        } else {
          toast.warning(`Clocked in ${Math.round(loc.distance)} m from the hotel. Flagged for admin review.`)
        }
      }
    } catch {
      setGpsStep('idle')
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
        toast.success(`Clocked out. You worked ${updated.hoursWorked}h — have a good rest!`)
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

  const todayDateStr = new Date().toISOString().split('T')[0]
  const isOvernightRecord = todayRecord?.date && todayRecord.date !== todayDateStr

  const greeting = () => {
    const h = now.getHours()
    if (h < 12) return 'Good morning'
    if (h < 17) return 'Good afternoon'
    return 'Good evening'
  }

  // Location for the active record (from stored notes or freshly acquired)
  const activeLocation = todayRecord ? parseLocationFromNotes(todayRecord.notes) : locationData

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
      {gpsStep === 'denied' && (
        <div className="bg-red-50 border-b border-red-200 px-5 py-3 flex items-start gap-2 text-sm text-red-800">
          <MapPin className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>Location access was denied. Your clock-in has been logged and flagged for admin review. Please enable location in your browser settings.</span>
        </div>
      )}
      {gpsStep === 'unavailable' && (
        <div className="bg-amber-50 border-b border-amber-200 px-5 py-3 flex items-start gap-2 text-sm text-amber-800">
          <MapPin className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>Could not determine your location (GPS timed out). Your clock-in has been logged and flagged for admin review.</span>
        </div>
      )}
      {gpsStep === 'done' && locationData && !locationData.inside && (
        <div className="bg-amber-50 border-b border-amber-200 px-5 py-3 flex items-start gap-2 text-sm text-amber-800">
          <MapPin className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>
            You are <strong>{Math.round(locationData.distance)} m</strong> from the hotel.
            Your clock-in has been logged and flagged for admin review.
          </span>
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

          {/* Shift record summary */}
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
                  <span className="text-muted-foreground">Hours worked</span>
                  <span className="font-semibold text-primary">{todayRecord.hoursWorked}h</span>
                </div>
              )}
              {/* Location status row */}
              {activeLocation && (
                <div className="flex justify-between items-center border-t pt-2 mt-1">
                  <span className="text-muted-foreground">Location</span>
                  <span className={`text-xs font-medium flex items-center gap-1 ${activeLocation.inside ? 'text-green-600' : 'text-amber-600'}`}>
                    <MapPin className="w-3 h-3 flex-shrink-0" />
                    {activeLocation.inside
                      ? `Hotel (${Math.round(activeLocation.distance)} m)`
                      : `${Math.round(activeLocation.distance)} m away`}
                  </span>
                </div>
              )}
              {/* Legacy denied/unavailable notes */}
              {!activeLocation && todayRecord.notes?.includes('denied') && (
                <div className="flex justify-between items-center border-t pt-2 mt-1">
                  <span className="text-muted-foreground">Location</span>
                  <span className="text-xs text-red-600 flex items-center gap-1">
                    <MapPin className="w-3 h-3" /> Access denied
                  </span>
                </div>
              )}
              {!activeLocation && todayRecord.notes?.includes('unavailable') && (
                <div className="flex justify-between items-center border-t pt-2 mt-1">
                  <span className="text-muted-foreground">Location</span>
                  <span className="text-xs text-amber-600 flex items-center gap-1">
                    <MapPin className="w-3 h-3" /> Unavailable
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
              <p className="text-sm text-muted-foreground">
                You worked {todayRecord?.hoursWorked ?? 0}h. Have a good rest!
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
                Clocked in at {todayRecord?.clockIn}
                {isOvernightRecord ? ` on ${todayRecord?.date}` : ''} · tap to end your shift
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
              {/* GPS acquisition progress */}
              {acting && gpsStep === 'acquiring' && (
                <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground animate-pulse">
                  <Navigation className="w-3.5 h-3.5 text-primary" />
                  <span>Acquiring your location…</span>
                </div>
              )}
              {!acting && (
                <p className="text-center text-xs text-muted-foreground">
                  Tap to start your shift
                </p>
              )}
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
