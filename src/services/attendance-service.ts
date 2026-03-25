/**
 * Attendance Service
 * Handles staff clock-in/out, rotating QR tokens, GPS verification,
 * and attendance record management.
 */

import { blink } from '@/blink/client'

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
const MAX_DISTANCE_METERS = 300

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

/** True if the given coordinates are within the hotel radius. */
export function isWithinHotel(lat: number, lng: number): boolean {
  return haversineDistance(lat, lng, HOTEL_LAT, HOTEL_LNG) <= MAX_DISTANCE_METERS
}

/** Resolve the device's current GPS position.
 *  Returns coords on success, 'denied' if the user blocked permission, or null if unavailable/timeout. */
export async function getCurrentLocation(): Promise<{ lat: number; lng: number } | 'denied' | null> {
  if (!navigator.geolocation) return null
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => resolve(err.code === 1 /* PERMISSION_DENIED */ ? 'denied' : null),
      { timeout: 8000, maximumAge: 60000 }
    )
  })
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
  notes: string
  createdAt: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const db = blink.db as any

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

/** Get today's attendance record for a staff member (null if none). */
export async function getTodayRecord(staffId: string): Promise<AttendanceRecord | null> {
  try {
    const rows = await db.hr_attendance.list({ limit: 500 })
    const today = todayStr()
    return ((rows || []) as AttendanceRecord[]).find((r) => {
      const sid = (r as any).staffId || (r as any).staff_id || ''
      const d = (r as any).date || ''
      return sid === staffId && d === today && r.status !== 'init'
    }) ?? null
  } catch {
    return null
  }
}

/** Clock a staff member in. Creates a new attendance record for today. */
export async function clockIn(
  staffId: string,
  staffName: string,
  opts?: { notes?: string; late?: boolean }
): Promise<AttendanceRecord> {
  const record: AttendanceRecord = {
    id: `att_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    staffId,
    staffName,
    date: todayStr(),
    clockIn: timeStr(),
    clockOut: '',
    hoursWorked: 0,
    status: opts?.late ? 'late' : 'present',
    notes: opts?.notes ?? '',
    createdAt: new Date().toISOString(),
  }
  await db.hr_attendance.create(record)
  return record
}

/** Clock a staff member out. Updates today's attendance record with clock-out time. */
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
  const hoursWorked = Math.max(
    0,
    (outH * 3600 + outM * 60 + outS - inH * 3600 - inM * 60 - inS) / 3600
  )

  const updated: AttendanceRecord = {
    ...existing,
    clockOut: timeStr(),
    hoursWorked: parseFloat(hoursWorked.toFixed(2)),
    notes: opts?.notes ?? existing.notes,
  }
  await db.hr_attendance.update(existing.id, updated)
  return updated
}

/** Get all of today's attendance records (admin live view). */
export async function getLiveAttendance(): Promise<AttendanceRecord[]> {
  try {
    const rows = await db.hr_attendance.list({ limit: 500 })
    const today = todayStr()
    return ((rows || []) as AttendanceRecord[])
      .filter((r) => {
        const d = (r as any).date || ''
        return d === today && r.status !== 'init'
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

/** Convert records to a CSV string. */
export function exportToCsv(records: AttendanceRecord[]): string {
  const header = 'Staff Name,Date,Clock In,Clock Out,Hours Worked,Status,Notes'
  const rows = records.map((r) =>
    [
      `"${r.staffName}"`,
      r.date,
      r.clockIn || '',
      r.clockOut || '',
      r.hoursWorked ?? 0,
      r.status,
      `"${(r.notes || '').replace(/"/g, '""')}"`,
    ].join(',')
  )
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
