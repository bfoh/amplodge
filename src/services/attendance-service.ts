/**
 * Attendance Service (v3)
 *
 * Client contract for the tamper-resistant attendance system. Every mutation
 * goes through security-definer RPCs that derive identity from auth.uid() —
 * this module never passes staff identity, admin identity, or timestamps as
 * authoritative parameters. Direct PostgREST writes to hr_attendance are
 * denied by RLS (see supabase/migrations/20260721_attendance_v3.sql).
 *
 * Kept for backward compatibility: legacy <!-- LOC:... --> notes parsing
 * (historical rows), haversine helpers, CSV export.
 */

import { supabase } from '@/lib/supabase'

// ─── GPS Verification ─────────────────────────────────────────────────────────

// AMP Lodge, Abuakwa DKC junction, Kumasi-Sunyani Rd, Kumasi, Ghana.
// Display-only defaults — the server-side attendance_settings row is
// authoritative and may be tuned by admins without a deploy.
const HOTEL_LAT = 6.7127
const HOTEL_LNG = -1.6250

/** Hard-block radius in metres (must match server seed; display hint only). */
export const MAX_DISTANCE_METERS_V2 = 150

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

/** Straight-line distance in metres between the given coordinates and the hotel. */
export function distanceFromHotel(lat: number, lng: number): number {
  return haversineDistance(lat, lng, HOTEL_LAT, HOTEL_LNG)
}

// ─── Location Data ────────────────────────────────────────────────────────────

export interface LocationData {
  lat: number       // WGS-84 latitude
  lng: number       // WGS-84 longitude
  accuracy: number  // GPS accuracy radius reported by the device (metres)
  distance: number  // straight-line distance from hotel (metres)
  inside: boolean   // whether within geofence at time of capture
}

export interface GpsSample {
  lat: number
  lng: number
  acc: number
  t: number
}

/**
 * Try up to `count` GPS reads within `timeoutMs`. Returns the best (lowest
 * accuracy) reading plus all samples (the server analyses sample scatter to
 * catch spoofed feeds) and the device's mock-location signal where supported.
 */
export async function resolveLocationMultiSample(
  count = 3,
  timeoutMs = 5000
): Promise<{ best: LocationData; samples: GpsSample[]; mockDetected: boolean } | 'denied' | null> {
  if (!navigator.geolocation) return null
  const samples: GpsSample[] = []
  let mockDetected = false
  const start = Date.now()

  const readOnce = (): Promise<GpsSample | 'denied' | null> =>
    new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          // Android Chrome exposes coords.mocked when a mock location app
          // supplied this fix. Not available everywhere — treated as a
          // signal, never sole proof (server flags, admin reviews).
          if ((pos.coords as any).mocked === true) mockDetected = true
          resolve({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            acc: pos.coords.accuracy,
            t: Date.now(),
          })
        },
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
    mockDetected,
  }
}

// ─── Legacy notes helpers (historical rows store GPS as <!-- LOC:... -->) ────

/** Parse a LocationData snapshot from a legacy notes string. */
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

/** Human-readable portion of a notes string, stripping any LOC comment. */
export function getNotesLabel(notes: string | undefined | null): string {
  if (!notes) return ''
  return notes.replace(/<!-- LOC:.*? -->/, '').trim()
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type ClockError =
  | 'invalid_token'
  | 'no_location'
  | 'outside_geofence'
  | 'low_gps_accuracy'
  | 'device_mismatch'
  | 'no_open_record'
  | 'rate_limited'
  | 'photo_required'
  | 'not_authenticated'
  | 'already_clocked_in'
  | 'not_admin'
  | 'permission_denied'
  | 'network'
  | 'unknown'

export interface ClockSuccess {
  ok: true
  recordId: string
  flags: string[]
  distance: number | null
  lateMinutes: number
  status: 'present' | 'late'
}

export interface ClockFailure {
  ok: false
  error: ClockError
  distance?: number
  accuracy?: number
  recordId?: string
}

export interface AttendanceRecord {
  id: string
  staffId: string
  staffName: string
  date: string                    // YYYY-MM-DD (Africa/Accra)
  clockIn: string                 // HH:MM:SS
  clockOut: string                // HH:MM:SS or ''
  clockInAt: string | null        // ISO timestamptz (source of truth)
  clockOutAt: string | null
  hoursWorked: number
  status: 'present' | 'absent' | 'late' | 'init'
  lateMinutes: number
  scheduledStart: string | null
  flags: string[]
  gpsDistance: number | null
  clockInPhotoPath: string | null
  clockOutPhotoPath: string | null
  notes: string                   // may embed legacy <!-- LOC:{...} -->
  createdAt: string
}

export interface LiveAttendanceRow {
  id: string
  staffId: string
  staffName: string
  date: string
  clockIn: string
  clockOut: string
  clockInAt: string | null
  hoursWorked: number
  status: string
  lateMinutes: number
  scheduledStart: string | null
  flags: string[]
  gpsDistance: number | null
  gpsAccuracy: number | null
  clockInPhotoPath: string | null
  clockOutPhotoPath: string | null
  reviewedAt: string | null
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
  adminNote: string | null
}

export interface Shift {
  id: string
  staffId: string
  weekday: number        // 0 = Sunday
  startTime: string      // HH:MM:SS
  endTime: string
  graceMinutes: number
}

export interface AttendanceSettings {
  geofenceLat: number
  geofenceLng: number
  geofenceRadiusM: number
  maxAccuracyM: number
  photoRequired: boolean
  longShiftHours: number
  qrWindowSeconds: number
  graceMinutesDefault: number
  requireOnsiteNetwork: boolean
  onsiteCidrs: string[]
}

// ─── QR token (server-issued, HMAC-signed) ────────────────────────────────────

/**
 * Fetch a fresh signed clock token. Admin-only (the QR panel runs on an
 * admin screen at the premises). Tokens rotate every `qr_window_seconds`
 * and cannot be forged or predicted without the DB-resident HMAC secret.
 *
 * On failure, `detail` carries the raw PostgREST/transport message so field
 * displays can show the real cause (missing grant, expired session, proxy
 * outage) instead of a generic "retrying" forever.
 */
export async function getClockToken(): Promise<
  { token: string; expiresIn: number } | { error: ClockError; detail?: string }
> {
  try {
    // Per-scan single-use nonce (migration 20260724). Same {token, expires_in}
    // shape as the retired get_clock_token, so the kiosk/hook are unchanged.
    const { data, error } = await supabase.rpc('mint_clock_nonce')
    if (error) {
      const msg = error.message ?? String(error)
      if (error.code === '42501' || msg.includes('permission denied')) {
        // EXECUTE grant missing for the authenticated role (migration Part 10
        // not fully applied) — the fix is SQL-side, retrying won't heal it.
        return { error: 'permission_denied', detail: msg }
      }
      if (error.code === 'PGRST301' || msg.toLowerCase().includes('jwt')) {
        return { error: 'not_authenticated', detail: msg }
      }
      return { error: 'network', detail: msg }
    }
    const d = data as any
    if (!d?.ok) return { error: (d?.error as ClockError) ?? 'unknown', detail: d?.error }
    return { token: d.token as string, expiresIn: d.expires_in as number }
  } catch (e) {
    return { error: 'network', detail: (e as Error)?.message ?? 'fetch failed' }
  }
}

/** Full clock-in URL to embed in the QR code. */
export function buildClockUrl(token: string): string {
  return `${window.location.origin}/staff/clock?t=${encodeURIComponent(token)}`
}

// ─── Photo capture & storage ──────────────────────────────────────────────────

export const ATTENDANCE_PHOTO_BUCKET = 'attendance-photos'

/**
 * Upload a clock-event selfie into the caller's own storage folder.
 * The server verifies the path prefix against auth.uid() and checks the
 * object exists, so paths cannot be forged for other staff.
 */
export async function uploadAttendancePhoto(
  blob: Blob,
  kind: 'in' | 'out'
): Promise<{ path: string } | { error: string }> {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: 'not_authenticated' }
    const path = `${user.id}/${Date.now()}_${kind}.jpg`
    const { error } = await supabase.storage
      .from(ATTENDANCE_PHOTO_BUCKET)
      .upload(path, blob, { contentType: 'image/jpeg', upsert: false })
    if (error) return { error: error.message }
    return { path }
  } catch (e) {
    return { error: (e as Error).message }
  }
}

/**
 * Short-lived signed URL for viewing a photo. Storage RLS allows the owning
 * staff member and admins (owner/admin role) only.
 */
export async function getAttendancePhotoUrl(path: string, expiresIn = 60): Promise<string | null> {
  try {
    const { data, error } = await supabase.storage
      .from(ATTENDANCE_PHOTO_BUCKET)
      .createSignedUrl(path, expiresIn)
    if (error || !data?.signedUrl) return null
    return data.signedUrl
  } catch {
    return null
  }
}

// ─── Clock in / out (server-authoritative) ────────────────────────────────────

export async function clockInServer(opts: {
  token: string
  location: LocationData | null
  samples: GpsSample[]
  mockDetected: boolean
  device: { fp: string; label: string }
  photoPath: string | null
  overrideRequestId?: string
}): Promise<ClockSuccess | ClockFailure> {
  try {
    const { data, error } = await supabase.rpc('clock_in_attendance', {
      p_token: opts.token,
      p_lat: opts.location?.lat ?? null,
      p_lng: opts.location?.lng ?? null,
      p_accuracy: opts.location?.accuracy ?? null,
      p_samples: opts.samples,
      p_mock_detected: opts.mockDetected,
      p_device_fp: opts.device.fp,
      p_device_label: opts.device.label,
      p_photo_path: opts.photoPath,
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
        recordId: d?.record_id,
      }
    }
    return {
      ok: true,
      recordId: d.record_id,
      flags: d.flags ?? [],
      distance: d.distance ?? null,
      lateMinutes: d.late_minutes ?? 0,
      status: d.status ?? 'present',
    }
  } catch {
    return { ok: false, error: 'network' }
  }
}

export async function clockOutServer(opts: {
  token: string
  location: LocationData | null
  samples: GpsSample[]
  mockDetected: boolean
  photoPath: string | null
}): Promise<{ ok: true; recordId: string; hours: number } | { ok: false; error: ClockError; distance?: number }> {
  try {
    const { data, error } = await supabase.rpc('clock_out_attendance', {
      p_token: opts.token,
      p_lat: opts.location?.lat ?? null,
      p_lng: opts.location?.lng ?? null,
      p_accuracy: opts.location?.accuracy ?? null,
      p_samples: opts.samples,
      p_mock_detected: opts.mockDetected,
      p_photo_path: opts.photoPath,
    })
    if (error) return { ok: false, error: 'network' }
    const d = data as any
    if (!d?.ok) return { ok: false, error: (d?.error as ClockError) ?? 'unknown', distance: d?.distance }
    return { ok: true, recordId: d.record_id, hours: d.hours }
  } catch {
    return { ok: false, error: 'network' }
  }
}

// ─── Current state (staff's own records via RPC, RLS-backed) ─────────────────

function rowToRecord(r: any): AttendanceRecord {
  return {
    id: r.id,
    staffId: r.staff_id ?? r.staffId ?? '',
    staffName: r.staff_name ?? r.staffName ?? '',
    date: r.date ?? '',
    clockIn: r.clock_in ?? r.clockIn ?? '',
    clockOut: r.clock_out ?? r.clockOut ?? '',
    clockInAt: r.clock_in_at ?? r.clockInAt ?? null,
    clockOutAt: r.clock_out_at ?? r.clockOutAt ?? null,
    hoursWorked: Number(r.hours_worked ?? r.hoursWorked ?? 0),
    status: r.status ?? 'present',
    lateMinutes: Number(r.late_minutes ?? r.lateMinutes ?? 0),
    scheduledStart: r.scheduled_start ?? r.scheduledStart ?? null,
    flags: r.flags ?? [],
    gpsDistance: r.gps_distance ?? r.gpsDistance ?? null,
    clockInPhotoPath: r.clock_in_photo_path ?? r.clockInPhotoPath ?? null,
    clockOutPhotoPath: r.clock_out_photo_path ?? r.clockOutPhotoPath ?? null,
    notes: r.notes ?? '',
    createdAt: r.created_at ?? r.createdAt ?? '',
  }
}

/** The caller's recent attendance records (newest first). */
export async function getMyAttendance(days = 14): Promise<AttendanceRecord[]> {
  try {
    const { data, error } = await supabase.rpc('get_my_attendance', { p_days: days })
    if (error || !(data as any)?.ok) return []
    return ((data as any).records ?? []).map(rowToRecord)
  } catch {
    return []
  }
}

/**
 * Current clock state for the clock page: the open record (clocked in, not
 * yet out — including yesterday's overnight), else today's completed record.
 */
export async function getCurrentAttendanceState(): Promise<{
  open: AttendanceRecord | null
  todayCompleted: AttendanceRecord | null
}> {
  const rows = await getMyAttendance(2)
  const today = accraTodayStr()
  const open = rows.find((r) => !r.clockOut && r.status !== 'init') ?? null
  const todayCompleted = rows.find((r) => r.date === today && r.clockOut) ?? null
  return { open, todayCompleted }
}

/** Today's date in Africa/Accra (YYYY-MM-DD) — matches server-side dating. */
export function accraTodayStr(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Accra',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

// ─── Override requests ────────────────────────────────────────────────────────

export async function requestOverride(opts: {
  reason: OverrideReason
  reasonNote?: string
  location: LocationData | null
  device: { fp: string; label: string }
}): Promise<{ id: string } | { error: string }> {
  try {
    const { data, error } = await supabase.rpc('request_attendance_override', {
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
    adminNote: r.admin_note ?? null,
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

/** Approve an override. Admin role is verified server-side from auth.uid(). */
export async function approveOverride(id: string, note?: string): Promise<void> {
  const { data, error } = await supabase.rpc('approve_attendance_override', {
    p_request_id: id, p_note: note ?? null,
  })
  const d = data as any
  if (error || !d?.ok) throw new Error(error?.message ?? d?.error ?? 'approve_failed')
}

/** Reject an override. Admin role is verified server-side from auth.uid(). */
export async function rejectOverride(id: string, note?: string): Promise<void> {
  const { data, error } = await supabase.rpc('reject_attendance_override', {
    p_request_id: id, p_note: note ?? null,
  })
  const d = data as any
  if (error || !d?.ok) throw new Error(error?.message ?? d?.error ?? 'reject_failed')
}

export async function resetDeviceBinding(staffId: string): Promise<void> {
  const { data, error } = await supabase.rpc('reset_device_binding', {
    p_staff_id: staffId,
  })
  const d = data as any
  if (error || !d?.ok) throw new Error(error?.message ?? d?.error ?? 'reset_failed')
}

// ─── Admin record actions (audited server-side) ───────────────────────────────

/** Void a record (replaces hard delete). The row is kept for audit. */
export async function voidRecord(recordId: string, reason: string): Promise<void> {
  const { data, error } = await supabase.rpc('void_attendance_record', {
    p_record_id: recordId, p_reason: reason,
  })
  const d = data as any
  if (error || !d?.ok) throw new Error(error?.message ?? d?.error ?? 'void_failed')
}

/** Correct clock times. Mandatory reason; every change is journaled. */
export async function adjustRecord(opts: {
  recordId: string
  clockInAt?: string | null   // ISO timestamptz; omit to leave unchanged
  clockOutAt?: string | null
  reason: string
}): Promise<void> {
  const { data, error } = await supabase.rpc('adjust_attendance_record', {
    p_record_id: opts.recordId,
    p_clock_in_at: opts.clockInAt ?? null,
    p_clock_out_at: opts.clockOutAt ?? null,
    p_reason: opts.reason,
  })
  const d = data as any
  if (error || !d?.ok) throw new Error(error?.message ?? d?.error ?? 'adjust_failed')
}

/** Manual entry for a staff member (forgotten phone, outage). Audited. */
export async function manualEntry(opts: {
  staffId: string
  date: string        // YYYY-MM-DD
  clockIn: string     // HH:MM
  clockOut?: string   // HH:MM or ''
  reason: string
}): Promise<{ recordId: string }> {
  const { data, error } = await supabase.rpc('admin_manual_attendance', {
    p_staff_id: opts.staffId,
    p_date: opts.date,
    p_clock_in: opts.clockIn,
    p_clock_out: opts.clockOut || null,
    p_reason: opts.reason,
  })
  const d = data as any
  if (error || !d?.ok) throw new Error(error?.message ?? d?.error ?? 'manual_entry_failed')
  return { recordId: d.record_id }
}

/** Mark a flagged record as reviewed by an admin. */
export async function markReviewed(recordId: string): Promise<void> {
  const { data, error } = await supabase.rpc('mark_attendance_reviewed', {
    p_record_id: recordId,
  })
  const d = data as any
  if (error || !d?.ok) throw new Error(error?.message ?? d?.error ?? 'review_failed')
}

// ─── Live view & reporting (admin) ────────────────────────────────────────────

function rowToLive(r: any): LiveAttendanceRow {
  return {
    id: r.id,
    staffId: r.staff_id,
    staffName: r.staff_name,
    date: r.date,
    clockIn: r.clock_in ?? '',
    clockOut: r.clock_out ?? '',
    clockInAt: r.clock_in_at ?? null,
    hoursWorked: Number(r.hours_worked ?? 0),
    status: r.status,
    lateMinutes: Number(r.late_minutes ?? 0),
    scheduledStart: r.scheduled_start ?? null,
    flags: r.flags ?? [],
    gpsDistance: r.gps_distance ?? null,
    gpsAccuracy: r.gps_accuracy ?? null,
    clockInPhotoPath: r.clock_in_photo_path ?? null,
    clockOutPhotoPath: r.clock_out_photo_path ?? null,
    reviewedAt: r.reviewed_at ?? null,
  }
}

/** Today's + open overnight records for the admin live view. Admin-only RPC. */
export async function getLiveAttendance(): Promise<LiveAttendanceRow[]> {
  try {
    const { data, error } = await supabase.rpc('get_live_attendance')
    if (error || !(data as any)?.ok) return []
    return ((data as any).records ?? []).map(rowToLive)
  } catch {
    return []
  }
}

export interface AttendanceReportTotals {
  hours: number
  scheduled_hours: number
  present_days: number
  late: number
  late_minutes: number
  absent: number
  overrides: number
  outside_geofence: number
  flagged: number
}

export interface AttendanceReportStaff {
  staff_id: string
  name: string
  days: number
  hours: number
  scheduled_hours: number
  regular_hours: number
  overtime_hours: number
  late: number
  late_minutes: number
  absent: number
  overrides: number
  outside_geofence: number
  flagged: number
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
  const d = data as any
  if (!d?.ok) throw new Error(d?.error ?? 'report_failed')
  return d as AttendanceReport
}

// ─── Shifts (admin-managed) ───────────────────────────────────────────────────

function rowToShift(r: any): Shift {
  return {
    id: r.id,
    staffId: r.staff_id,
    weekday: Number(r.weekday),
    startTime: r.start_time,
    endTime: r.end_time,
    graceMinutes: Number(r.grace_minutes ?? 10),
  }
}

/** All shifts, or one staff member's. Admin-only RPC. */
export async function listShifts(staffId?: string): Promise<Shift[]> {
  try {
    const { data, error } = await supabase.rpc('get_shifts', { p_staff_id: staffId ?? null })
    if (error || !(data as any)?.ok) return []
    return ((data as any).shifts ?? []).map(rowToShift)
  } catch {
    return []
  }
}

export async function upsertShift(opts: {
  staffId: string
  weekday: number
  startTime: string   // HH:MM
  endTime: string     // HH:MM (earlier than start = overnight)
  graceMinutes?: number
}): Promise<void> {
  const { data, error } = await supabase.rpc('upsert_shift', {
    p_staff_id: opts.staffId,
    p_weekday: opts.weekday,
    p_start: opts.startTime,
    p_end: opts.endTime,
    p_grace: opts.graceMinutes ?? 10,
  })
  const d = data as any
  if (error || !d?.ok) throw new Error(error?.message ?? d?.error ?? 'shift_failed')
}

export async function deleteShift(shiftId: string): Promise<void> {
  const { data, error } = await supabase.rpc('delete_shift', { p_shift_id: shiftId })
  const d = data as any
  if (error || !d?.ok) throw new Error(error?.message ?? d?.error ?? 'delete_shift_failed')
}

// ─── Settings ─────────────────────────────────────────────────────────────────

/** Attendance settings — readable by any authenticated staff (RLS). */
export async function getAttendanceSettings(): Promise<AttendanceSettings | null> {
  try {
    const { data, error } = await supabase
      .from('attendance_settings')
      .select('*')
      .eq('id', 1)
      .maybeSingle()
    if (error || !data) return null
    return {
      geofenceLat: Number(data.geofence_lat),
      geofenceLng: Number(data.geofence_lng),
      geofenceRadiusM: Number(data.geofence_radius_m),
      maxAccuracyM: Number(data.max_accuracy_m),
      photoRequired: !!data.photo_required,
      longShiftHours: Number(data.long_shift_hours),
      qrWindowSeconds: Number(data.qr_window_seconds),
      graceMinutesDefault: Number(data.grace_minutes_default),
      requireOnsiteNetwork: !!data.require_onsite_network,
      onsiteCidrs: Array.isArray(data.onsite_cidrs) ? data.onsite_cidrs : [],
    }
  } catch {
    return null
  }
}

// ─── Kiosk credentials + on-site network (migration 20260725) ────────────────

export interface ClockKiosk {
  id: string
  label: string
  egressCidr: string | null
  active: boolean
  lastUsedAt: string | null
}

/**
 * Mint a nonce using a device-scoped kiosk credential (no user session).
 * Used by the entrance kiosk once it has been provisioned with {id, key}.
 * Same {token, expiresIn} shape as the admin mint.
 */
export async function mintClockNonceKiosk(
  kioskId: string,
  kioskKey: string,
): Promise<{ token: string; expiresIn: number } | { error: ClockError; detail?: string }> {
  try {
    const { data, error } = await supabase.rpc('mint_clock_nonce_kiosk', {
      p_kiosk_id: kioskId,
      p_kiosk_key: kioskKey,
    })
    if (error) return { error: 'network', detail: error.message ?? String(error) }
    const d = data as any
    if (!d?.ok) return { error: (d?.error as ClockError) ?? 'unknown', detail: d?.error }
    return { token: d.token as string, expiresIn: d.expires_in as number }
  } catch (e) {
    return { error: 'network', detail: (e as Error)?.message ?? 'fetch failed' }
  }
}

/** Admin: provision a kiosk. Returns the plaintext key ONCE — store it now. */
export async function createClockKiosk(
  label: string,
  egressCidr?: string | null,
): Promise<{ ok: boolean; kioskId?: string; kioskKey?: string; error?: string }> {
  const { data, error } = await supabase.rpc('create_clock_kiosk', {
    p_label: label,
    p_egress_cidr: egressCidr ?? null,
  })
  if (error) return { ok: false, error: error.message ?? 'request failed' }
  const d = data as any
  if (!d?.ok) return { ok: false, error: d?.error ?? 'unknown' }
  return { ok: true, kioskId: d.kiosk_id, kioskKey: d.kiosk_key }
}

/** Admin: revoke a kiosk credential (deactivates it). */
export async function revokeClockKiosk(kioskId: string): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await supabase.rpc('revoke_clock_kiosk', { p_kiosk_id: kioskId })
  if (error) return { ok: false, error: error.message ?? 'request failed' }
  const d = data as any
  return d?.ok ? { ok: true } : { ok: false, error: d?.error ?? 'unknown' }
}

/** Admin: list registered kiosks (RLS restricts to admins). */
export async function listClockKiosks(): Promise<ClockKiosk[]> {
  const { data, error } = await supabase
    .from('clock_kiosks')
    .select('id, label, egress_cidr, active, last_used_at')
    .order('created_at', { ascending: false })
  if (error || !data) return []
  return data.map((r: any) => ({
    id: r.id,
    label: r.label,
    egressCidr: r.egress_cidr ?? null,
    active: !!r.active,
    lastUsedAt: r.last_used_at ?? null,
  }))
}

/** Admin: enable/disable on-site network enforcement and set the CIDR allowlist. */
export async function setOnsiteNetwork(
  enabled: boolean,
  cidrs: string[],
): Promise<{ ok: boolean; error?: string; value?: string }> {
  const { data, error } = await supabase.rpc('set_onsite_network', {
    p_enabled: enabled,
    p_cidrs: cidrs,
  })
  if (error) return { ok: false, error: error.message ?? 'request failed' }
  const d = data as any
  return d?.ok ? { ok: true } : { ok: false, error: d?.error ?? 'unknown', value: d?.value }
}

/** Admin: rotate the proxy shared secret. Returns it ONCE — paste into Netlify env AMP_PROXY_SECRET. */
export async function rotateProxySecret(): Promise<{ ok: boolean; secret?: string; error?: string }> {
  const { data, error } = await supabase.rpc('rotate_proxy_secret')
  if (error) return { ok: false, error: error.message ?? 'request failed' }
  const d = data as any
  if (!d?.ok) return { ok: false, error: d?.error ?? 'unknown' }
  return { ok: true, secret: d.proxy_secret }
}

// ─── CSV export ───────────────────────────────────────────────────────────────

/**
 * Convert records to a CSV string. Handles both v3 columns and legacy
 * <!-- LOC --> notes so historical rows export cleanly.
 */
export function exportToCsv(records: AttendanceRecord[]): string {
  const header = 'Staff Name,Date,Clock In,Clock Out,Hours Worked,Status,Scheduled Start,Late Minutes,Flags,Location Status,Distance (m),GPS Accuracy (m),Notes'
  const rows = records.map((r) => {
    const loc = parseLocationFromNotes(r.notes)
    const label = getNotesLabel(r.notes) || r.notes || ''
    const distance = r.gpsDistance ?? loc?.distance ?? null
    const inside = r.gpsDistance != null
      ? r.gpsDistance <= MAX_DISTANCE_METERS_V2
      : loc?.inside
    return [
      `"${r.staffName}"`,
      r.date,
      r.clockIn || '',
      r.clockOut || '',
      r.hoursWorked ?? 0,
      r.status,
      r.scheduledStart ?? '',
      r.lateMinutes ?? 0,
      `"${(r.flags ?? []).join(' | ')}"`,
      inside == null ? (label || '') : inside ? 'Within hotel' : 'Outside hotel',
      distance != null ? Math.round(distance) : '',
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
