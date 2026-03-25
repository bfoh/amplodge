/**
 * Weekly Revenue Service
 * Handles per-staff weekly revenue tracking based on bookings they created.
 * Week boundaries: Monday 00:00 → Sunday 23:59 (ISO week, weekStartsOn: 1)
 */

import { blink } from '@/blink/client'
import { startOfWeek, endOfWeek, format, subWeeks } from 'date-fns'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WeeklyRevenueReport {
  id: string
  staffId: string       // Supabase auth user ID (matches booking.createdBy)
  staffName: string
  weekStart: string     // YYYY-MM-DD  (always a Monday)
  weekEnd: string       // YYYY-MM-DD  (always a Sunday)
  totalRevenue: number
  bookingCount: number
  bookingIds: string    // JSON-encoded string array of booking IDs
  status: 'draft' | 'submitted' | 'reviewed'
  notes: string         // Staff's own notes on the week
  adminNotes: string    // Admin feedback
  reviewedBy: string    // Admin user ID
  reviewedAt: string
  submittedAt: string
  createdAt: string
  updatedAt: string
}

export interface WeekBounds {
  weekStart: string   // YYYY-MM-DD
  weekEnd: string     // YYYY-MM-DD
  label: string       // e.g. "Mar 17 – Mar 23, 2026"
}

export interface BookingSummary {
  id: string
  guestName: string
  roomNumber: string
  checkIn: string
  checkOut: string
  totalPrice: number
  status: string
  createdAt: string
}

// ─── Week Utilities ───────────────────────────────────────────────────────────

export function getWeekBounds(date: Date = new Date()): WeekBounds {
  const start = startOfWeek(date, { weekStartsOn: 1 })
  const end = endOfWeek(date, { weekStartsOn: 1 })
  return {
    weekStart: format(start, 'yyyy-MM-dd'),
    weekEnd: format(end, 'yyyy-MM-dd'),
    label: `${format(start, 'MMM d')} – ${format(end, 'MMM d, yyyy')}`,
  }
}

/** Returns the last `count` week bounds, newest first (index 0 = current week). */
export function getPastWeeksBounds(count: number): WeekBounds[] {
  return Array.from({ length: count }, (_, i) => getWeekBounds(subWeeks(new Date(), i)))
}

// ─── Booking Data ─────────────────────────────────────────────────────────────

/**
 * Fetch all non-cancelled bookings created by a specific staff member
 * within a given week. Uses the booking's `createdAt` timestamp.
 */
export async function fetchBookingsForStaffWeek(
  staffId: string,
  weekStart: string,
  weekEnd: string
): Promise<{ bookings: BookingSummary[]; totalRevenue: number; bookingCount: number }> {
  const db = blink.db as any

  let allBookings: any = null, allRooms: any = null, allGuests: any = null
  try {
    ;[allBookings, allRooms, allGuests] = await Promise.all([
      db.bookings.list({ limit: 2000 }),
      db.rooms.list({ limit: 500 }),
      db.guests.list({ limit: 1000 }),
    ])
  } catch (e) {
    console.warn('[fetchBookingsForStaffWeek] DB error:', e)
    return { bookings: [], totalRevenue: 0, bookingCount: 0 }
  }

  const roomMap = new Map(((allRooms || []) as any[]).map((r: any) => [r.id, r]))
  const guestMap = new Map(((allGuests || []) as any[]).map((g: any) => [g.id, g]))

  const from = new Date(weekStart + 'T00:00:00')
  const to = new Date(weekEnd + 'T23:59:59')

  const matched: BookingSummary[] = ((allBookings || []) as any[])
    .filter((b: any) => {
      const creator = b.createdBy || b.created_by || ''
      if (creator !== staffId) return false
      if (b.status === 'cancelled') return false
      const ts = b.createdAt || b.created_at || ''
      if (!ts) return false
      const d = new Date(ts)
      return d >= from && d <= to
    })
    .map((b: any) => {
      const room = roomMap.get(b.roomId) as any
      const guest = guestMap.get(b.guestId) as any
      return {
        id: b.id,
        guestName: guest?.name || 'Guest',
        roomNumber: room?.roomNumber || '—',
        checkIn: b.checkIn,
        checkOut: b.checkOut,
        totalPrice: Number(b.totalPrice || 0),
        status: b.status,
        createdAt: b.createdAt || b.created_at || '',
      }
    })

  const totalRevenue = matched.reduce((s, b) => s + b.totalPrice, 0)
  return { bookings: matched, totalRevenue, bookingCount: matched.length }
}

// ─── Report CRUD ──────────────────────────────────────────────────────────────

/**
 * Get or create a weekly revenue report for a staff member.
 * For draft reports (including the current week), always recalculates from
 * live bookings so the numbers stay up-to-date in real time.
 */
export async function getOrCreateWeekReport(
  staffId: string,
  staffName: string,
  week: WeekBounds
): Promise<WeeklyRevenueReport> {
  const db = blink.db as any

  // Fetch all and filter client-side — blink SDK where-filter is unreliable for custom tables
  let allRows: WeeklyRevenueReport[] = []
  try {
    const rows = await db.hr_weekly_revenue.list({ limit: 500 })
    allRows = (rows || []) as WeeklyRevenueReport[]
  } catch (e) {
    console.warn('[getOrCreateWeekReport] list failed (table may not exist yet):', e)
  }
  const existing = allRows.find(
    (r) => {
      const sid = (r as any).staffId || (r as any).staff_id || ''
      const ws  = (r as any).weekStart || (r as any).week_start || ''
      return sid === staffId && ws === week.weekStart && r.status !== 'init'
    }
  )

  // Always recalculate for drafts so the current week stays live
  if (!existing || existing.status === 'draft') {
    const { bookings, totalRevenue, bookingCount } = await fetchBookingsForStaffWeek(
      staffId,
      week.weekStart,
      week.weekEnd
    )
    const bookingIds = JSON.stringify(bookings.map((b) => b.id))
    const now = new Date().toISOString()

    if (existing) {
      const updated: WeeklyRevenueReport = {
        ...existing,
        staffName, // keep name fresh
        totalRevenue,
        bookingCount,
        bookingIds,
        updatedAt: now,
      }
      try {
        await db.hr_weekly_revenue.update(existing.id, updated)
      } catch (e) {
        console.warn('[getOrCreateWeekReport] update failed:', e)
      }
      return updated
    }

    const record: WeeklyRevenueReport = {
      id: `rev_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      staffId,
      staffName,
      weekStart: week.weekStart,
      weekEnd: week.weekEnd,
      totalRevenue,
      bookingCount,
      bookingIds,
      status: 'draft',
      notes: '',
      adminNotes: '',
      reviewedBy: '',
      reviewedAt: '',
      submittedAt: '',
      createdAt: now,
      updatedAt: now,
    }
    try {
      await db.hr_weekly_revenue.create(record)
    } catch (e) {
      console.warn('[getOrCreateWeekReport] create failed (table may not exist yet):', e)
    }
    return record  // Return computed record even if DB write failed
  }

  return existing
}

/**
 * Staff submits their weekly report (locks it from further auto-recalculation).
 */
export async function submitWeekReport(reportId: string, notes: string): Promise<void> {
  const db = blink.db as any
  await db.hr_weekly_revenue.update(reportId, {
    status: 'submitted',
    notes,
    submittedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })
}

/**
 * Admin marks a report as reviewed with optional feedback notes.
 */
export async function reviewWeekReport(
  reportId: string,
  adminNotes: string,
  reviewedByName: string
): Promise<void> {
  const db = blink.db as any
  await db.hr_weekly_revenue.update(reportId, {
    status: 'reviewed',
    adminNotes,
    reviewedBy: reviewedByName,
    reviewedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })
}

/** Get all staff reports for a specific week (admin view). */
export async function getAllStaffReportsForWeek(weekStart: string): Promise<WeeklyRevenueReport[]> {
  const db = blink.db as any
  try {
    const rows = await db.hr_weekly_revenue.list({ limit: 500 })
    return ((rows || []) as WeeklyRevenueReport[])
      .filter((r) => {
        const ws = (r as any).weekStart || (r as any).week_start || ''
        return ws === weekStart && r.status !== 'init'
      })
      .sort((a, b) => b.totalRevenue - a.totalRevenue)
  } catch (e) {
    console.warn('[getAllStaffReportsForWeek] failed:', e)
    return []
  }
}

/** Get a staff member's own report history, newest first. */
export async function getStaffAllReports(staffId: string): Promise<WeeklyRevenueReport[]> {
  const db = blink.db as any
  try {
    const rows = await db.hr_weekly_revenue.list({ limit: 500 })
    return ((rows || []) as WeeklyRevenueReport[])
      .filter((r) => {
        const sid = (r as any).staffId || (r as any).staff_id || ''
        return sid === staffId && r.status !== 'init'
      })
      .sort((a, b) => {
        const wsA = (a as any).weekStart || (a as any).week_start || ''
        const wsB = (b as any).weekStart || (b as any).week_start || ''
        return wsB > wsA ? 1 : -1
      })
  } catch (e) {
    console.warn('[getStaffAllReports] failed:', e)
    return []
  }
}
