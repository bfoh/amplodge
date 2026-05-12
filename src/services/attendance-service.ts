/**
 * Attendance Service
 * Handles staff clock-in/out, rotating QR tokens, GPS verification,
 * and attendance record management.
 */

import { db, auth } from '@/lib/db'

// ─── Rotating QR Token ────────────────────────────────────────────────────────

const WINDOW_MINUTES = 10

/** Generate the base64-encoded token for the current time window. */
export function generateToken(): string {
  const w = Math.floor(Date.now() / (WINDOW_MINUTES * 60 * 1000))
  return btoa(w.toString())
}

/** Full clock-in URL to embed in the QR code. */
export function generateClockUrl(): string {
  return `${window.location.origin}/staff/clock?t=${generateToken()}`
}

/**
 * Validate a QR token.
 * Accepts current window and the previous window (20-min grace period
 * so staff aren't blocked if the QR rotates while they're scanning).
 */
export function isValidToken(token: string): boolean {
  try {
    const current = Math.floor(Date.now() / (WINDOW_MINUTES * 60 * 1000))
    const tokenWindow = parseInt(atob(token), 10)
    return tokenWindow === current || tokenWindow === current - 1
  } catch {
    return false
  }
}

/** Seconds remaining until the current token window expires. */
export function secondsUntilNextToken(): number {
  const windowMs = WINDOW_MINUTES * 60 * 1000
  return Math.ceil((windowMs - (Date.now() % windowMs)) / 1000)
}

// ─── GPS Verification ─────────────────────────────────────────────────────────

// AMP Lodge, Abuakwa DKC junction, Kumasi-Sunyani Rd, Kumasi, Ghana
const HOTEL_LAT = 6.7127
const HOTEL_LNG = -1.6250

/**
 * Geofence radius in metres.
 * 500 m gives comfortable margin for:
 *   - Staff at the gate / car park / security post
 *   - Typical mobile GPS drift (10–50 m indoors, up to 100 m in buildings)
 *   - Network-assisted positioning on older devices
 */
const MAX_DISTANCE_METERS = 500

function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.asin(Math.sqrt(a))
}

/** Returns the straight-line distance in metres between the given coordinates and the hotel. */
export function distanceFromHotel(lat: number, lng: number): number {
  return haversineDistance(lat, lng, HOTEL_LAT, HOTEL_LNG)
}

/** True if the given coordinates are within the hotel geofence. */
export function isWithinHotel(lat: number, lng: number): boolean {
  return distanceFromHotel(lat, lng) <= MAX_DISTANCE_METERS
}

// ─── Location Data ────────────────────────────────────────────────────────────

/**
 * Rich location snapshot captured at clock-in time.
 * Stored inside the `notes` field as a machine-readable comment so no schema
 * change is needed — existing records stay readable and the comment is ignored
 * by any human reading the plain text.
 */
export interface LocationData {
  lat: number       // WGS-84 latitude
  lng: number       // WGS-84 longitude
  accuracy: number  // GPS accuracy radius reported by the device (metres)
  distance: number  // straight-line distance from hotel (metres)
  inside: boolean   // whether within geofence at time of clock-in
}

/**
 * Encode a LocationData snapshot into the notes string.
 * Format:  <!-- LOC:{...} -->Human readable label
 * The comment prefix is stripped when displaying to users; it exists only for
 * machine parsing so coordinates survive in the notes field without a schema change.
 */
function buildLocationNote(loc: LocationData): string {
  const payload = JSON.stringify({
    lat: parseFloat(loc.lat.toFixed(7)),
    lng: parseFloat(loc.lng.toFixed(7)),
    acc: Math.round(loc.accuracy),
    dist: Math.round(loc.distance),
    in: loc.inside,
  })
  const label = loc.inside
    ? `Within hotel (${Math.round(loc.distance)} m)`
    : `Outside hotel (${Math.round(loc.distance)} m away)`
  return `<!-- LOC:${payload} -->${label}`
}

/**
 * Parse a LocationData snapshot from a notes string.
 * Returns null for old-format records that pre-date this encoding.
 */
export function parseLocationFromNotes(notes: string | undefined | null): LocationData | null {
  if (!notes) return null
  const match = notes.match(/<!-- LOC:(.*?) -->/)
  if (!match?.[1]) return null
  try {
    const d = JSON.parse(match[1])
    return {
      lat: d.lat,
      lng: d.lng,
      accuracy: d.acc ?? 0,
      distance: d.dist ?? 0,
      inside: !!d.in,
    }
  } catch {
    return null
  }
}

/**
 * Return the human-readable portion of a notes string,
 * stripping any embedded <!-- LOC:... --> comment.
 */
export function getNotesLabel(notes: string | undefined | null): string {
  if (!notes) return ''
  return notes.replace(/<!-- LOC:.*? -->/, '').trim()
}

/**
 * Acquire the device's current GPS position using high-accuracy mode.
 *
 * Design choices:
 *   - enableHighAccuracy: true  → requests the device's best fix (GPS chip,
 *     not just cell-tower/Wi-Fi triangulation).  Takes longer but gives a
 *     much more reliable position — critical for attendance fraud prevention.
 *   - timeout: 15 000 ms        → extra headroom for devices that need time
 *     to acquire a satellite fix (cold-start indoors can take 10–15 s).
 *   - maximumAge: 30 000 ms     → accept a cached fix up to 30 s old.
 *     Using 60 s risks returning a position from when the staff member was
 *     still at home or in a vehicle.
 *
 * Returns:
 *   { lat, lng, accuracy } on success
 *   'denied'               if the user blocked location permission
 *   null                   if the API is unavailable or timed out
 */
export async function getCurrentLocation(): Promise<{ lat: number; lng: number; accuracy: number } | 'denied' | null> {
  if (!navigator.geolocation) return null
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
      }),
      (err) => resolve(err.code === 1 /* PERMISSION_DENIED */ ? 'denied' : null),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
    )
  })
}

/**
 * Convenience wrapper: acquire GPS, compute distance from hotel, return a full
 * LocationData snapshot (or 'denied' / null on failure).
 * This is the single call ClockPage should make — it combines GPS acquisition,
 * distance calculation, and geofence check in one step.
 */
export async function resolveLocation(): Promise<LocationData | 'denied' | null> {
  const raw = await getCurrentLocation()
  if (raw === 'denied') return 'denied'
  if (!raw) return null
  const distance = distanceFromHotel(raw.lat, raw.lng)
  return {
    lat: raw.lat,
    lng: raw.lng,
    accuracy: raw.accuracy,
    distance,
    inside: distance <= MAX_DISTANCE_METERS,
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AttendanceRecord {
  id: string
  staffId: string
  staffName: string
  date: string       // YYYY-MM-DD
  clockIn: string    // HH:MM:SS
  clockOut: string   // HH:MM:SS or ''
  hoursWorked: number
  status: 'present' | 'absent' | 'late' | 'init'
  notes: string      // may embed <!-- LOC:{...} --> prefix — use getNotesLabel() to display
  createdAt: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayStr(): string {
  return new Date().toISOString().split('T')[0]
}

function timeStr(): string {
  const now = new Date()
  return [
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ].join(':')
}

// ─── Service Functions ────────────────────────────────────────────────────────

/**
 * Get the current active attendance record for a staff member.
 *
 * Returns the most recent open record (no clock-out) from today OR yesterday
 * so that overnight/night-shift staff can still clock out the next morning.
 * Falls back to today's completed record if no open record exists.
 */
export async function getTodayRecord(staffId: string): Promise<AttendanceRecord | null> {
  try {
    const rows = await db.hr_attendance.list({ limit: 500 })
    const today = todayStr()
    const yesterdayDate = new Date()
    yesterdayDate.setDate(yesterdayDate.getDate() - 1)
    const yesterday = yesterdayDate.toISOString().split('T')[0]

    const staffRows = ((rows || []) as AttendanceRecord[]).filter((r) => {
      const sid = (r as any).staffId || (r as any).staff_id || ''
      const d = (r as any).date || ''
      return sid === staffId && (d === today || d === yesterday) && r.status !== 'init'
    })

    // Prefer an open record (no clock-out) — handles night-shift clock-out next morning
    const open = staffRows
      .filter((r) => !r.clockOut)
      .sort((a, b) => {
        const dComp = ((b as any).date || '').localeCompare((a as any).date || '')
        if (dComp !== 0) return dComp
        return ((b as any).clockIn || '').localeCompare((a as any).clockIn || '')
      })
    if (open.length > 0) return open[0]

    // No open record — return today's completed record if any
    return staffRows.find((r) => (r as any).date === today) ?? null
  } catch {
    return null
  }
}

/**
 * Clock a staff member in. Creates a new attendance record for today.
 *
 * Pass `opts.location` (from `resolveLocation()`) to record a rich GPS snapshot.
 * If location is omitted, falls back to `opts.notes` for backward compatibility.
 */
export async function clockIn(
  staffId: string,
  staffName: string,
  opts?: { notes?: string; late?: boolean; location?: LocationData }
): Promise<AttendanceRecord> {
  const notesValue = opts?.location
    ? buildLocationNote(opts.location)
    : (opts?.notes ?? '')

  const record: AttendanceRecord = {
    id: `att_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    staffId,
    staffName,
    date: todayStr(),
    clockIn: timeStr(),
    clockOut: '',
    hoursWorked: 0,
    status: opts?.late ? 'late' : 'present',
    notes: notesValue,
    createdAt: new Date().toISOString(),
  }
  await db.hr_attendance.create(record)
  return record
}

/** Clock a staff member out. Updates the active attendance record with clock-out time. */
export async function clockOut(
  staffId: string,
  opts?: { notes?: string }
): Promise<AttendanceRecord | null> {
  const existing = await getTodayRecord(staffId)
  if (!existing) return null

  const [inH, inM, inS = 0] = existing.clockIn.split(':').map(Number)
  const now = new Date()
  const outH = now.getHours()
  const outM = now.getMinutes()
  const outS = now.getSeconds()

  // Detect overnight shift: the clock-in record's date is earlier than today.
  // Add 24 hours (86400 s) to the out-time so the subtraction gives the correct
  // total duration instead of a negative number that gets clamped to 0.
  const isNextDay = (existing as any).date !== todayStr()
  const inTotalSec = inH * 3600 + inM * 60 + inS
  const outTotalSec = outH * 3600 + outM * 60 + outS + (isNextDay ? 86400 : 0)
  const hoursWorked = Math.max(0, (outTotalSec - inTotalSec) / 3600)

  const updated: AttendanceRecord = {
    ...existing,
    clockOut: timeStr(),
    hoursWorked: parseFloat(hoursWorked.toFixed(2)),
    notes: opts?.notes ?? existing.notes,
  }
  await db.hr_attendance.update(existing.id, updated)
  return updated
}

/**
 * Get all attendance records relevant for the admin live view:
 * - All of today's records
 * - Any open (no clock-out) records from yesterday (overnight/night-shift staff
 *   who clocked in the previous evening and haven't clocked out yet).
 */
export async function getLiveAttendance(): Promise<AttendanceRecord[]> {
  try {
    const rows = await db.hr_attendance.list({ limit: 500 })
    const today = todayStr()
    const yesterdayDate = new Date()
    yesterdayDate.setDate(yesterdayDate.getDate() - 1)
    const yesterday = yesterdayDate.toISOString().split('T')[0]

    return ((rows || []) as AttendanceRecord[])
      .filter((r) => {
        const d = (r as any).date || ''
        if (r.status === 'init') return false
        if (d === today) return true
        if (d === yesterday && !r.clockOut) return true  // overnight staff still on shift
        return false
      })
      .sort((a, b) => ((a as any).clockIn || '') < ((b as any).clockIn || '') ? -1 : 1)
  } catch {
    return []
  }
}

/** Get attendance records for the last N days (admin full history). */
export async function getRecentAttendance(days = 30): Promise<AttendanceRecord[]> {
  try {
    const rows = await db.hr_attendance.list({ limit: 1000 })
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - days)
    const cutoffStr = cutoff.toISOString().split('T')[0]
    return ((rows || []) as AttendanceRecord[])
      .filter((r) => {
        const d = (r as any).date || ''
        return d >= cutoffStr && r.status !== 'init'
      })
      .sort((a, b) => ((a as any).date || '') > ((b as any).date || '') ? -1 : 1)
  } catch {
    return []
  }
}

/**
 * Convert records to a CSV string.
 * Includes decoded location columns (Lat, Lng, Distance, GPS Accuracy) so the
 * exported spreadsheet has full audit-ready location data.
 */
export function exportToCsv(records: AttendanceRecord[]): string {
  const header = 'Staff Name,Date,Clock In,Clock Out,Hours Worked,Status,Location Status,Distance (m),Latitude,Longitude,GPS Accuracy (m),Notes'
  const rows = records.map((r) => {
    const loc = parseLocationFromNotes(r.notes)
    const label = getNotesLabel(r.notes) || r.notes || ''
    return [
      `"${r.staffName}"`,
      r.date,
      r.clockIn || '',
      r.clockOut || '',
      r.hoursWorked ?? 0,
      r.status,
      loc ? (loc.inside ? 'Within hotel' : 'Outside hotel') : (label || ''),
      loc ? Math.round(loc.distance) : '',
      loc ? loc.lat.toFixed(7) : '',
      loc ? loc.lng.toFixed(7) : '',
      loc ? Math.round(loc.accuracy) : '',
      `"${label.replace(/"/g, '""')}"`,
    ].join(',')
  })
  return [header, ...rows].join('\n')
}

/** Trigger a browser download of the records as a CSV file. */
export function downloadCsv(records: AttendanceRecord[], filename = 'attendance.csv'): void {
  const csv = exportToCsv(records)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ─── Server-RPC-backed flow (v2) ──────────────────────────────────────────────
// Hardened clock-in path. Goes through Supabase RPCs so token, geofence, and
// device-binding checks are server-authoritative. Old client-side helpers above
// are kept for backward compatibility (display of historical records, QR
// generation, manual logging).

import { supabase } from '@/lib/supabase'

export type ClockError =
  | 'invalid_token'
  | 'no_location'
  | 'outside_geofence'
  | 'device_mismatch'
  | 'no_open_record'
  | 'network'
  | 'unknown'

export interface ClockSuccess {
  ok: true
  recordId: string
  flags: string[]
  distance: number | null
}

export interface ClockFailure {
  ok: false
  error: ClockError
  distance?: number
  accuracy?: number
}

export interface GpsSample {
  lat: number
  lng: number
  acc: number
  t: number
}

/**
 * Hard-block radius. Must match server `_amp_hotel()` radius in
 * `supabase/migrations/20260512_attendance_security_v2.sql`.
 */
export const MAX_DISTANCE_METERS_V2 = 150

/**
 * Try up to `count` GPS reads within `timeoutMs`. Returns the best (lowest
 * accuracy value) reading plus all samples for audit. Aborts early if the
 * first reading is precise enough (< 20 m).
 */
export async function resolveLocationMultiSample(
  count = 3,
  timeoutMs = 5000
): Promise<{ best: LocationData; samples: GpsSample[] } | 'denied' | null> {
  if (!navigator.geolocation) return null
  const samples: GpsSample[] = []
  const start = Date.now()

  const readOnce = (): Promise<GpsSample | 'denied' | null> =>
    new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          acc: pos.coords.accuracy,
          t: Date.now(),
        }),
        (err) => resolve(err.code === 1 ? 'denied' : null),
        { enableHighAccuracy: true, timeout: Math.max(1500, Math.floor(timeoutMs / count)), maximumAge: 0 }
      )
    })

  for (let i = 0; i < count; i++) {
    if (Date.now() - start > timeoutMs) break
    const r = await readOnce()
    if (r === 'denied') return 'denied'
    if (r) {
      samples.push(r)
      if (r.acc < 20) break // good enough, stop early
    }
  }
  if (samples.length === 0) return null

  const best = samples.reduce((a, b) => (b.acc < a.acc ? b : a))
  const distance = distanceFromHotel(best.lat, best.lng)
  return {
    best: {
      lat: best.lat,
      lng: best.lng,
      accuracy: best.acc,
      distance,
      inside: distance <= MAX_DISTANCE_METERS_V2,
    },
    samples,
  }
}

/** Server-authoritative clock-in. Calls the `clock_in_attendance` RPC. */
export async function clockInServer(opts: {
  token: string
  staffId: string
  staffName: string
  location: LocationData | null
  samples: GpsSample[]
  device: { fp: string; label: string }
  overrideRequestId?: string
}): Promise<ClockSuccess | ClockFailure> {
  try {
    const { data, error } = await supabase.rpc('clock_in_attendance', {
      p_token: opts.token,
      p_staff_id: opts.staffId,
      p_staff_name: opts.staffName,
      p_lat: opts.location?.lat ?? null,
      p_lng: opts.location?.lng ?? null,
      p_accuracy: opts.location?.accuracy ?? null,
      p_samples: opts.samples,
      p_device_fp: opts.device.fp,
      p_device_label: opts.device.label,
      p_override_request_id: opts.overrideRequestId ?? null,
    })
    if (error) return { ok: false, error: 'network' }
    const d = data as any
    if (!d?.ok) {
      return {
        ok: false,
        error: (d?.error as ClockError) ?? 'unknown',
        distance: d?.distance,
        accuracy: d?.accuracy,
      }
    }
    return {
      ok: true,
      recordId: d.record_id,
      flags: d.flags ?? [],
      distance: d.distance ?? null,
    }
  } catch {
    return { ok: false, error: 'network' }
  }
}

export async function clockOutServer(opts: {
  token: string
  staffId: string
}): Promise<{ ok: true; recordId: string; hours: number } | { ok: false; error: ClockError }> {
  try {
    const { data, error } = await supabase.rpc('clock_out_attendance', {
      p_token: opts.token,
      p_staff_id: opts.staffId,
    })
    if (error) return { ok: false, error: 'network' }
    const d = data as any
    if (!d?.ok) return { ok: false, error: (d?.error as ClockError) ?? 'unknown' }
    return { ok: true, recordId: d.record_id, hours: d.hours }
  } catch {
    return { ok: false, error: 'network' }
  }
}

export type OverrideReason = 'gps_drift' | 'new_device' | 'other'

export interface OverrideRequest {
  id: string
  staffId: string
  staffName: string
  reason: OverrideReason
  reasonNote: string | null
  distance: number | null
  accuracy: number | null
  deviceLabel: string | null
  status: 'pending' | 'approved' | 'rejected' | 'consumed' | 'expired'
  requestedAt: string
}

export async function requestOverride(opts: {
  staffId: string
  staffName: string
  reason: OverrideReason
  reasonNote?: string
  location: LocationData | null
  device: { fp: string; label: string }
}): Promise<{ id: string } | { error: string }> {
  try {
    const { data, error } = await supabase.rpc('request_attendance_override', {
      p_staff_id: opts.staffId,
      p_staff_name: opts.staffName,
      p_reason: opts.reason,
      p_reason_note: opts.reasonNote ?? null,
      p_lat: opts.location?.lat ?? null,
      p_lng: opts.location?.lng ?? null,
      p_accuracy: opts.location?.accuracy ?? null,
      p_distance: opts.location?.distance ?? null,
      p_device_fp: opts.device.fp,
      p_device_label: opts.device.label,
    })
    const d = data as any
    if (error || !d?.ok) return { error: error?.message ?? d?.error ?? 'unknown' }
    return { id: d.id }
  } catch (e) {
    return { error: (e as Error).message }
  }
}

function rowToOverride(r: any): OverrideRequest {
  return {
    id: r.id,
    staffId: r.staff_id,
    staffName: r.staff_name,
    reason: r.reason,
    reasonNote: r.reason_note,
    distance: r.gps_distance ?? null,
    accuracy: r.gps_accuracy ?? null,
    deviceLabel: r.device_label ?? null,
    status: r.status,
    requestedAt: r.requested_at,
  }
}

export async function listPendingOverrides(): Promise<OverrideRequest[]> {
  const { data } = await supabase
    .from('attendance_override_requests')
    .select('*')
    .eq('status', 'pending')
    .order('requested_at', { ascending: false })
  return (data ?? []).map(rowToOverride)
}

export async function getOverride(id: string): Promise<OverrideRequest | null> {
  const { data } = await supabase
    .from('attendance_override_requests')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  return data ? rowToOverride(data) : null
}

export async function approveOverride(id: string, adminId: string, note?: string): Promise<void> {
  const { data, error } = await supabase.rpc('approve_attendance_override', {
    p_request_id: id, p_admin_id: adminId, p_note: note ?? null,
  })
  const d = data as any
  if (error || !d?.ok) throw new Error(error?.message ?? d?.error ?? 'approve_failed')
}

export async function rejectOverride(id: string, adminId: string, note?: string): Promise<void> {
  const { data, error } = await supabase.rpc('reject_attendance_override', {
    p_request_id: id, p_admin_id: adminId, p_note: note ?? null,
  })
  const d = data as any
  if (error || !d?.ok) throw new Error(error?.message ?? d?.error ?? 'reject_failed')
}

export async function resetDeviceBinding(staffId: string, adminId: string): Promise<void> {
  const { data, error } = await supabase.rpc('reset_device_binding', {
    p_staff_id: staffId, p_admin_id: adminId,
  })
  const d = data as any
  if (error || !d?.ok) throw new Error(error?.message ?? 'reset_failed')
}

// ─── Reporting ────────────────────────────────────────────────────────────────

export interface AttendanceReportTotals {
  hours: number
  present_days: number
  late: number
  absent: number
  overrides: number
  outside_geofence: number
}

export interface AttendanceReportStaff {
  staff_id: string
  name: string
  days: number
  hours: number
  late: number
  avg_per_day: number | null
}

export interface AttendanceReportDay {
  date: string
  count: number
  hours: number
}

export interface AttendanceReport {
  totals: AttendanceReportTotals
  per_staff: AttendanceReportStaff[]
  daily: AttendanceReportDay[]
}

export async function getAttendanceReport(
  startDate: string,
  endDate: string
): Promise<AttendanceReport> {
  const { data, error } = await supabase.rpc('get_attendance_report', {
    p_start: startDate, p_end: endDate,
  })
  if (error) throw error
  return data as AttendanceReport
}
