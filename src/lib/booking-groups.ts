/**
 * Group booking service — single source of truth for "which bookings belong
 * to group X" and the group's shared metadata (billing contact, additional
 * charges, discount, invoice number).
 *
 * Backed by the `booking_groups` table + `bookings.group_id` FK column
 * (migration 20260801120000_booking_groups.sql). Every write here is
 * defensive against that migration not having run yet on the target
 * database — column/table lookups that hit a missing-column (42703) or
 * missing-relation (42P01) Postgres error fall back to parsing the legacy
 * `<!-- GROUP_DATA:{...} -->` comment that booking-engine.ts still writes
 * into `specialRequests` for backward compatibility. This means: deploy
 * this code and the migration independently, in either order, without an
 * outage window.
 *
 * All business logic that touches individual bookings (guest resolution,
 * room resolution, overlap checks, payment events, notifications) stays in
 * booking-engine.ts — this module only owns group-level bookkeeping and
 * calls into bookingEngine for the actual booking rows.
 */

import { db, auth } from '@/lib/db'
import { bookingEngine, type LocalBooking } from '@/services/booking-engine'
import type { BookingGroup, BillingContact, AdditionalCharge, GroupDiscount } from '@/types'

// ---------------------------------------------------------------------------
// Postgres error helpers
// ---------------------------------------------------------------------------

const UNDEFINED_COLUMN = '42703'
const UNDEFINED_TABLE = '42P01'

function isMissingSchema(err: any): boolean {
  const code = err?.code
  return code === UNDEFINED_COLUMN || code === UNDEFINED_TABLE
}

// ---------------------------------------------------------------------------
// Legacy GROUP_DATA fallback (pre-migration groups, or migration not yet applied)
// ---------------------------------------------------------------------------

function parseGroupData(booking: any): any | null {
  const specialReq = booking?.special_requests || booking?.specialRequests || ''
  const match = specialReq.match(/<!-- GROUP_DATA:(.*?) -->/)
  if (!match?.[1]) return null
  try {
    return JSON.parse(match[1])
  } catch {
    return null
  }
}

/** Scan up to 500 bookings for GROUP_DATA.groupId === groupId (legacy path). */
async function legacyGetGroupMembers(groupId: string): Promise<any[]> {
  const all = await db.bookings.list({ limit: 500 })
  return (all as any[]).filter((b) => parseGroupData(b)?.groupId === groupId)
}

function pickPrimary(members: any[]): any | undefined {
  const marked = members.find((m) => parseGroupData(m)?.isPrimaryBooking === true || m.isPrimaryBooking === true)
  if (marked) return marked
  // Deterministic fallback: earliest check-in, tie-break lowest room number.
  return [...members].sort((a, b) => {
    const checkInCmp = String(a.checkIn || '').localeCompare(String(b.checkIn || ''))
    if (checkInCmp !== 0) return checkInCmp
    return String(a.roomNumber || '').localeCompare(String(b.roomNumber || ''), undefined, { numeric: true })
  })[0]
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** All booking rows belonging to a group, newest-first is not guaranteed — sort by checkIn if order matters. */
export async function getGroupMembers(groupId: string): Promise<any[]> {
  try {
    const members = await db.bookings.list({ where: { groupId } })
    if (members.length > 0) return members
    // Column exists but nothing matched — either a pre-migration group
    // (comment-only, group_id never set) or a genuinely empty/bad id.
    return legacyGetGroupMembers(groupId)
  } catch (err) {
    if (!isMissingSchema(err)) throw err
    return legacyGetGroupMembers(groupId)
  }
}

/** Group-level metadata: billing contact, charges, discount, invoice number, status. */
export async function getGroupMeta(groupId: string): Promise<BookingGroup | null> {
  try {
    const row = await db.bookingGroups.get(groupId)
    if (row) return row as BookingGroup
  } catch (err) {
    if (!isMissingSchema(err)) throw err
  }

  // Fall back to synthesizing meta from the primary member's GROUP_DATA comment.
  const members = await getGroupMembers(groupId)
  if (members.length === 0) return null
  const primary = pickPrimary(members)
  const data = parseGroupData(primary) || {}
  return {
    id: groupId,
    groupReference: data.groupReference || primary.groupReference || '',
    billingContact: data.billingContact,
    additionalCharges: data.additionalCharges || [],
    discount: data.discount,
    primaryBookingId: primary.id,
    invoiceNumber: undefined,
    status: 'active',
    createdAt: primary.createdAt || '',
    updatedAt: primary.updatedAt || primary.createdAt || '',
  }
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** Best-effort: set bookings.group_id for a booking. No-op (silently) if the column doesn't exist yet. */
async function tagBookingWithGroupId(bookingId: string, groupId: string): Promise<void> {
  try {
    await db.bookings.update(bookingId, { groupId })
  } catch (err) {
    if (!isMissingSchema(err)) console.warn('[booking-groups] Failed to tag booking with group_id:', err)
  }
}

/** Best-effort: create the booking_groups row. Returns its id, or null if the table doesn't exist yet. */
async function createGroupRow(
  groupReference: string,
  billingContact: BillingContact | undefined,
  additionalCharges: AdditionalCharge[],
  discount: GroupDiscount | undefined,
  staff: { id?: string; name?: string }
): Promise<string | null> {
  try {
    const row = await db.bookingGroups.create({
      groupReference,
      billingContact,
      additionalCharges,
      discount,
      status: 'active',
      createdBy: staff.id,
      createdByName: staff.name,
    })
    return row.id
  } catch (err) {
    if (!isMissingSchema(err)) console.warn('[booking-groups] Failed to create booking_groups row:', err)
    return null
  }
}

export interface CreateGroupRoomInput {
  bookingData: Omit<LocalBooking, '_id' | 'createdAt' | 'updatedAt' | 'synced' | 'groupId' | 'groupReference' | 'isPrimaryBooking'>
}

/**
 * Create a new group booking: one booking_groups row (if the migration has
 * landed) + one bookings row per room, sequentially (guest-creation races
 * are avoided by not parallelizing, matching the existing single-booking
 * engine's approach). On a mid-loop failure, rolls back everything created
 * in this call — closing the "partial group, no rollback" gap in the
 * previous implementation.
 */
export async function createBookingGroup(
  rooms: CreateGroupRoomInput[],
  billingContact: BillingContact,
  additionalCharges: AdditionalCharge[] = [],
  discount: GroupDiscount | undefined = undefined
): Promise<LocalBooking[]> {
  if (rooms.length === 0) throw new Error('At least one room is required to create a group booking')

  const currentUser = await auth.me().catch(() => null)
  const staffName = (currentUser as any)?.user_metadata?.full_name || currentUser?.email || 'Staff'
  const shortRef = Math.random().toString(36).substring(2, 6).toUpperCase()
  const groupReference = `GRP-${new Date().getFullYear()}-${shortRef}`

  const groupRowId = await createGroupRow(groupReference, billingContact, additionalCharges, discount, {
    id: currentUser?.id,
    name: staffName,
  })
  // groupId is used both for the real FK column (when available) and for the
  // legacy GROUP_DATA comment — keeping them identical means a group created
  // before/after the migration lands is still addressable by one id either way.
  const groupId = groupRowId || crypto.randomUUID()

  const created: LocalBooking[] = []
  try {
    for (let i = 0; i < rooms.length; i++) {
      const bookingWithGroup = {
        ...rooms[i].bookingData,
        groupId,
        groupReference,
        isPrimaryBooking: i === 0,
        billingContact,
        ...(i === 0 ? { additionalCharges, discount } : {}),
      }
      const booking = await bookingEngine.createBooking(bookingWithGroup as any)
      created.push(booking)
      await tagBookingWithGroupId(booking.remoteId || booking._id, groupId)
      if (i === 0 && groupRowId) {
        try {
          await db.bookingGroups.update(groupRowId, { primaryBookingId: booking.remoteId || booking._id })
        } catch (err) {
          if (!isMissingSchema(err)) console.warn('[booking-groups] Failed to set primary_booking_id:', err)
        }
      }
    }
    return created
  } catch (error) {
    console.error('[booking-groups] Group creation failed mid-way — rolling back', created.length, 'already-created bookings')
    for (const b of created) {
      try {
        await db.bookings.delete(b.remoteId || b._id)
      } catch (cleanupErr) {
        console.error('[booking-groups] Rollback delete failed for', b.remoteId || b._id, cleanupErr)
      }
    }
    if (groupRowId) {
      try {
        await db.bookingGroups.delete(groupRowId)
      } catch (cleanupErr) {
        console.error('[booking-groups] Rollback of booking_groups row failed:', cleanupErr)
      }
    }
    throw error
  }
}

/** Add a room to an existing group. Delegates guest/room/payment logic to bookingEngine.addToGroup. */
export async function addGroupMember(
  groupId: string,
  bookingData: Omit<LocalBooking, '_id' | 'createdAt' | 'updatedAt' | 'synced'>
): Promise<LocalBooking> {
  const booking = await bookingEngine.addToGroup(groupId, bookingData)
  await tagBookingWithGroupId(booking.remoteId || booking._id, groupId)
  return booking
}

export interface RemoveGroupMemberResult {
  groupClosed: boolean
  remainingCount: number
  newPrimaryId?: string
}

/**
 * Remove one room from a group. If it's the last remaining room, the whole
 * group is closed (the booking is cancelled, not hard-deleted, and the
 * booking_groups row is marked cancelled) instead of throwing the old
 * dead-end "delete the entire group instead" error with no button to do so.
 */
export async function removeGroupMember(bookingId: string): Promise<RemoveGroupMemberResult> {
  const booking = await db.bookings.get(bookingId)
  if (!booking) throw new Error(`Booking not found: ${bookingId}`)
  if (booking.status === 'checked-in') {
    throw new Error('Cannot remove a room that is currently checked in. Please check out the guest first.')
  }

  const groupId = booking.groupId || parseGroupData(booking)?.groupId
  if (!groupId) throw new Error('This booking is not part of a group')

  const members = await getGroupMembers(groupId)
  const isLastMember = members.length <= 1

  if (isLastMember) {
    await bookingEngine.updateBookingStatus(bookingId, 'cancelled')
    try {
      const groupRow = await db.bookingGroups.get(groupId).catch(() => null)
      if (groupRow) await db.bookingGroups.update(groupId, { status: 'cancelled' })
    } catch (err) {
      if (!isMissingSchema(err)) console.warn('[booking-groups] Failed to mark group_groups row cancelled:', err)
    }
    return { groupClosed: true, remainingCount: 0 }
  }

  const result = await bookingEngine.removeFromGroup(bookingId)
  if (result.newPrimaryId) {
    try {
      const groupRow = await db.bookingGroups.get(groupId).catch(() => null)
      if (groupRow) await db.bookingGroups.update(groupId, { primaryBookingId: result.newPrimaryId })
    } catch (err) {
      if (!isMissingSchema(err)) console.warn('[booking-groups] Failed to mirror new primary_booking_id:', err)
    }
  }
  return { groupClosed: false, remainingCount: result.remainingCount, newPrimaryId: result.newPrimaryId }
}

/**
 * Cancel every room in a group. Blocked if any member is already checked in
 * (matches the per-member guard — check those out individually first).
 */
export async function cancelGroup(groupId: string): Promise<void> {
  const members = await getGroupMembers(groupId)
  if (members.length === 0) throw new Error('Group not found or has no rooms')

  const checkedIn = members.filter((m) => m.status === 'checked-in')
  if (checkedIn.length > 0) {
    throw new Error(
      `Cannot cancel: ${checkedIn.length} room${checkedIn.length > 1 ? 's are' : ' is'} currently checked in. Check out first.`
    )
  }

  for (const member of members) {
    if (member.status === 'cancelled' || member.status === 'checked-out') continue
    await bookingEngine.updateBookingStatus(member.id, 'cancelled')
  }

  try {
    const groupRow = await db.bookingGroups.get(groupId).catch(() => null)
    if (groupRow) await db.bookingGroups.update(groupId, { status: 'cancelled' })
  } catch (err) {
    if (!isMissingSchema(err)) console.warn('[booking-groups] Failed to mark booking_groups row cancelled:', err)
  }
}

export interface UpdateGroupMetaInput {
  billingContact?: BillingContact
  additionalCharges?: AdditionalCharge[]
  discount?: GroupDiscount
}

/**
 * Update a group's shared billing info. Writes the booking_groups row (when
 * present) and always mirrors the change into the primary booking's
 * GROUP_DATA comment too, so anything still reading only the legacy comment
 * (invoice generation, revenue reporting) stays in sync.
 */
export async function updateGroupMeta(groupId: string, updates: UpdateGroupMetaInput): Promise<void> {
  try {
    const groupRow = await db.bookingGroups.get(groupId).catch(() => null)
    if (groupRow) await db.bookingGroups.update(groupId, updates)
  } catch (err) {
    if (!isMissingSchema(err)) console.warn('[booking-groups] Failed to update booking_groups row:', err)
  }

  const members = await getGroupMembers(groupId)
  const primary = pickPrimary(members)
  if (!primary) return

  const existingSpecialReq = primary.special_requests || primary.specialRequests || ''
  const existingData = parseGroupData(primary) || {}
  const mergedData = {
    ...existingData,
    ...(updates.billingContact !== undefined ? { billingContact: updates.billingContact } : {}),
    ...(updates.additionalCharges !== undefined ? { additionalCharges: updates.additionalCharges } : {}),
    ...(updates.discount !== undefined ? { discount: updates.discount } : {}),
  }
  const cleanSpecialReq = existingSpecialReq.replace(/<!-- GROUP_DATA:.*? -->/g, '').trim()
  const newSpecialReq = `${cleanSpecialReq}\n\n<!-- GROUP_DATA:${JSON.stringify(mergedData)} -->`
  await db.bookings.update(primary.id, { specialRequests: newSpecialReq })
}
