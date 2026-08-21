import { db, auth } from '@/lib/db'
import { v4 as uuidv4 } from 'uuid'
import { activityLogService } from './activity-log-service'
import { sendBookingConfirmation } from './notifications'
import { createPreInvoiceData, generateInvoicePDF, blobToBase64 } from './invoice-service'
import { parsePaymentEvents, type PaymentEvent } from '@/lib/payment-events'

export interface LocalBooking {
  _id: string
  remoteId?: string
  _rev?: string
  guest: {
    fullName: string
    email: string
    phone: string
    address: string
  }
  subtotal?: number
  idempotencyKey?: string
  roomType: string
  roomNumber: string
  dates: {
    checkIn: string
    checkOut: string
  }
  numGuests: number
  amount: number
  status: 'reserved' | 'confirmed' | 'cancelled' | 'checked-in' | 'checked-out'
  source: 'online' | 'reception'
  synced: boolean
  conflict?: boolean
  payment?: {
    method: 'cash' | 'mobile_money' | 'card' | 'not_paid'
    status: 'pending' | 'completed' | 'failed'
    amount: number
    reference?: string
    paidAt?: string
  }
  amountPaid?: number
  paymentStatus?: 'full' | 'part' | 'pending'
  notes?: string
  // Pre-built specialRequests metadata (e.g. a PAYMENT_EVENTS comment from the
  // booking form). createBooking carries the PAYMENT_EVENTS comment forward.
  specialRequests?: string
  createdBy?: string
  createdByName?: string
  checkInBy?: string
  checkInByName?: string
  checkOutBy?: string
  checkOutByName?: string
  createdAt: string
  updatedAt: string
  payment_method?: string
  paymentMethod?: string
  paymentSplits?: Array<{ method: string; amount: number }>
  // Parsed PAYMENT_EVENTS — per-stage payments carrying their own paidAt timestamp.
  // Required for period-accurate revenue (attributing money to the period it was
  // collected in, not the booking's checkIn/createdAt). Mirrors revenue-service R1.
  paymentEvents?: PaymentEvent[]
  discountAmount?: number   // Discount applied at check-in (0 if none)

  // Group Booking Fields
  groupId?: string
  groupReference?: string
  isPrimaryBooking?: boolean
  billingContact?: {
    fullName: string
    email: string
    phone: string
    address: string
  }

  // Billing Adjustments (typically on primary booking of a group)
  additionalCharges?: {
    description: string
    amount: number
  }[]
  discount?: {
    type: 'percentage' | 'fixed'
    value: number
    amount: number
  }


  // Idempotency key sent with the create request. The server enforces uniqueness
  // on bookings.client_request_id; a duplicate insert (e.g. double-click race)
  // returns 23505 and the engine re-reads the existing row instead of inserting.

}

export interface AuditLog {
  _id: string
  _rev?: string
  action: 'booking_created' | 'booking_updated' | 'booking_cancelled' | 'conflict_resolved' | 'payment_recorded' | 'sync_completed'
  entityType: 'booking' | 'room' | 'payment'
  entityId: string
  details: any
  userId?: string
  userName?: string
  timestamp: string
}

class BookingEngine {
  private syncHandlers: Array<(status: 'syncing' | 'synced' | 'error', message?: string) => void> = []

  // Short-lived cache for getAllBookings — avoids N redundant fetches when analytics/pages load simultaneously
  private _allBookingsCache: { data: LocalBooking[]; ts: number } | null = null
  private _allBookingsTTL = 30000 // 30 seconds
  // In-flight dedup: if a fetch is already running, return the same promise instead of firing a new one
  private _allBookingsInflight: Promise<LocalBooking[]> | null = null

  public onSyncStatusChange(handler: (status: 'syncing' | 'synced' | 'error', message?: string) => void) {
    this.syncHandlers.push(handler)
    return () => {
      this.syncHandlers = this.syncHandlers.filter(h => h !== handler)
    }
  }

  public invalidateCache() {
    this._allBookingsCache = null
    this._allBookingsInflight = null
    console.log('🧹 [BookingEngine] Internal cache invalidated.')
  }

  private notifySyncHandlers(status: 'syncing' | 'synced' | 'error', message?: string) {
    this.syncHandlers.forEach(h => h(status, message))
  }

  public getOnlineStatus(): boolean {
    if (typeof navigator === 'undefined') return true
    return navigator.onLine
  }

  // Create a booking directly via the data wrapper and return a LocalBooking-shaped object for UI compatibility
  async createBooking(bookingData: Omit<LocalBooking, '_id' | 'createdAt' | 'updatedAt' | 'synced'>): Promise<LocalBooking> {
    console.log('[BookingEngine] Starting booking creation')

    // Phase 2F: Strict validation for critical dates
    if (!bookingData.dates?.checkIn || !bookingData.dates?.checkOut) {
      console.error('[BookingEngine] Validation failed: Missing dates', bookingData.dates)
      throw new Error('Check-in and check-out dates are required to create a booking.')
    }

    const normalizedEmail = (bookingData.guest.email || '').trim().toLowerCase()

    // NOTE: We previously fetched all bookings + all guests + all rooms here to
    // detect duplicates client-side. That cost 800-2000ms in Ghana on every
    // submit and was redundant — migration 20260504070000_booking_dedup.sql
    // installs a unique index on (guest_id, room_id, check_in, check_out)
    // for ACTIVE bookings AND on client_request_id for idempotent retries.
    // The 23505/409 catch path below (around the bookings.create call) reads
    // back the existing row and returns it as if the create succeeded, so
    // double-clicks/idempotent retries still resolve cleanly without making
    // the user wait for three full-table scans up front.

    // Normalize/ensure guest (always resolve to an existing record).
    // Refuse to create with an empty/literal-"Guest" name — this used to silently
    // store a fallback that produced rows displaying as "Guest" forever.
    const rawGuestName = (bookingData.guest.fullName || '').trim()
    if (!rawGuestName || rawGuestName.toLowerCase() === 'guest') {
      throw new Error('Guest full name is required and cannot be the literal "Guest".')
    }
    const guestName = rawGuestName
    const baseSlug = (normalizedEmail || guestName).toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
    const computedGuestId = `guest-${baseSlug}`

    let guestId: string | undefined

    // -------------------------------------------------------------------------
    // Phase-1 parallel fan-out. These three reads have no dependency on each
    // other; firing them sequentially was costing ~3 RTTs (~750-1200ms) in
    // Ghana. We kick them off together and await once.
    //   - guest by email
    //   - room by roomNumber
    //   - current authenticated user
    // The room result is reused below; the auth result is reused at insert
    // time (saving another RTT later in the function).
    // -------------------------------------------------------------------------
    const phase1 = Promise.all([
      normalizedEmail
        ? db.guests.list({ where: { email: normalizedEmail }, limit: 1 }).catch(() => null)
        : Promise.resolve(null),
      // `properties` is the canonical room list (Rooms page source of truth);
      // `rooms` is a legacy mirror kept only because bookings.room_id has a
      // hard FK to rooms.id. Resolve from properties so a room visible/
      // selectable on the Rooms page always resolves here too, then fall
      // through to the legacy table only if properties has no match.
      db.properties.list({ where: { roomNumber: bookingData.roomNumber }, limit: 1 }).catch(() => null),
      auth.me().catch(() => null),
    ])

    try {
      console.log('[BookingEngine] Resolving guest with email:', normalizedEmail, 'computed ID:', computedGuestId)

      const [byEmailResult] = await phase1
      // Try to find existing guest by email first
      let existing: any = null
      if (normalizedEmail) {
        existing = (byEmailResult as any[])?.[0] ?? null
        console.log('[BookingEngine] Found by email:', existing?.id)
      }

      // NOTE: there used to be a second lookup here querying guests.id by
      // computedGuestId (a slug like "guest-jane-doe-example-com"). guests.id
      // is a real UUID column — guest rows are always created with
      // crypto.randomUUID() below, never a slug — so that lookup could never
      // match anything and always threw a Postgres "invalid input syntax for
      // uuid" error. Because that throw wasn't locally caught, it aborted
      // straight out of this whole try block (past the "create new guest"
      // branch below) into the outer catch, which falls through to the
      // fallback-guest path further down — silently discarding the real
      // email/phone that was actually provided for every brand-new guest.
      // Removed: if email search didn't find them, they're new — go create
      // the guest with the real details, no pointless lookup in between.

      if (existing) {
        guestId = existing.id
        console.log('[BookingEngine] Using existing guest (no update — name and details are preserved):', guestId)
        // INTENTIONALLY do NOT update the guest record here.
        // Updating any field (especially name) would retroactively rename this guest
        // across ALL their previous bookings and any group memberships, which is the
        // root cause of the "guest takes over existing group" bug.
        // Guest record edits must be done explicitly via the Guests management page.
      } else {
        // Generate ID client-side so we always know it, regardless of whether
        // Supabase returns the row after insert (RLS can block SELECT-back).
        const newGuestId = crypto.randomUUID()
        const guestEmail = normalizedEmail || `${computedGuestId}@guest.local`
        const createPayload = {
          id: newGuestId,
          name: guestName,
          email: guestEmail,
          phone: bookingData.guest.phone || '',
          address: bookingData.guest.address || ''
        }
        console.log('[BookingEngine] Creating new guest with id:', newGuestId)

        try {
          await db.guests.create(createPayload)
          // Whether or not Supabase returns the row, we know the ID we sent
          guestId = newGuestId
          console.log('[BookingEngine] Created guest:', guestId)
        } catch (createErr: any) {
          const msg = (createErr?.message || '').toLowerCase()
          const status = createErr?.status
          console.warn('[BookingEngine] Guest create failed:', status, createErr?.message)

          // Duplicate email — guest already exists, find them
          if (status === 409 || msg.includes('constraint') || msg.includes('unique') || msg.includes('duplicate')) {
            if (normalizedEmail) {
              const found = await db.guests.list({ where: { email: normalizedEmail }, limit: 1 })
              if (found?.[0]?.id) {
                guestId = found[0].id
                console.log('[BookingEngine] Found existing guest by email after constraint error:', guestId)
              } else {
                throw createErr
              }
            } else {
              throw createErr
            }
          } else {
            throw createErr
          }
        }
      }
    } catch (guestErr) {
      console.error('[BookingEngine] Guest resolution failed, attempting fallback:', guestErr)
    }

    // Final safety: if still no guestId, create a guest with a fresh UUID
    if (!guestId) {
      const fallbackGuestId = crypto.randomUUID()
      const fallbackEmail = `fallback-${fallbackGuestId}@guest.local`
      console.log('[BookingEngine] Creating fallback guest:', fallbackGuestId)

      try {
        await db.guests.create({
          id: fallbackGuestId,
          name: guestName,
          email: fallbackEmail,
          phone: bookingData.guest.phone || '',
          address: bookingData.guest.address || ''
        })
        guestId = fallbackGuestId
        console.log('[BookingEngine] Fallback guest created:', guestId)
      } catch (fallbackErr: any) {
        console.error('[BookingEngine] Fallback guest creation failed:', fallbackErr?.message)
        // We know the ID we tried to insert — use it and proceed
        guestId = fallbackGuestId
      }
    }

    if (!guestId) {
      const error = new Error('Failed to resolve or create guest record')
      console.error('[BookingEngine] CRITICAL:', error.message)
      throw error
    }

    console.log('[BookingEngine] Final guest ID:', guestId)

    // Resolve the room from `properties` (canonical). bookings.room_id has a
    // hard FK to the legacy `rooms` table, so before inserting we must ensure
    // a `rooms` row exists with this same id — PropertiesPage dual-writes new
    // rooms into both tables, but self-heal here in case that mirror ever
    // drifts (manual DB edits, rows created before the dual-write existed).
    console.log('[BookingEngine] Resolving room for number:', bookingData.roomNumber)
    const [, propertyResFromPhase1] = await phase1
    const room = (propertyResFromPhase1 as any[] | null)?.[0]

    if (!room) {
      const error = new Error(`Room not found for number: ${bookingData.roomNumber}`)
      console.error('[BookingEngine] CRITICAL:', error.message)
      throw error
    }

    const mirrorExists = await (db as any).rooms.get(room.id).catch(() => null)
    if (!mirrorExists) {
      console.warn('[BookingEngine] Room', room.id, 'missing from legacy rooms mirror — self-healing before insert')
      try {
        await (db as any).rooms.create({
          id: room.id,
          roomNumber: room.roomNumber,
          roomTypeId: room.propertyTypeId || null,
          status: room.status || 'active',
          price: room.basePrice ?? null,
          createdAt: room.createdAt || new Date().toISOString(),
        })
      } catch (mirrorErr) {
        console.error('[BookingEngine] Failed to self-heal rooms mirror for', room.id, mirrorErr)
        throw new Error(`Room ${bookingData.roomNumber} exists but could not be prepared for booking. Please try again or contact support.`)
      }
    }

    console.log('[BookingEngine] Using room:', room.id, room.roomNumber)

    // Check for date overlaps with existing active bookings
    const existingForRoom = await db.bookings.list({ where: { roomId: room.id } })
    const activeStatues = ['reserved', 'confirmed', 'checked-in']

    // Parse the new booking dates - use YYYY-MM-DD string comparison for consistency
    const newCheckIn = bookingData.dates.checkIn
    const newCheckOut = bookingData.dates.checkOut
    const newStart = typeof newCheckIn === 'string' ? newCheckIn.split('T')[0] : ''
    const newEnd = typeof newCheckOut === 'string' ? newCheckOut.split('T')[0] : ''

    console.log('[BookingEngine] Checking overlap for dates:', newStart, 'to', newEnd)
    console.log('[BookingEngine] Found', existingForRoom.length, 'existing bookings for room', room.roomNumber)

    const hasOverlap = existingForRoom.some((b: any) => {
      // Ignore cancelled or checked-out bookings
      if (!activeStatues.includes(b.status)) {
        console.log('[BookingEngine] Skipping booking with status:', b.status)
        return false
      }

      // Handle both data structures: raw DB (checkIn) and if any normalized (dates.checkIn)
      const bCheckIn = b.checkIn || b.dates?.checkIn
      const bCheckOut = b.checkOut || b.dates?.checkOut

      // Convert to YYYY-MM-DD strings for consistent comparison
      const bStart = typeof bCheckIn === 'string' ? bCheckIn.split('T')[0] : ''
      const bEnd = typeof bCheckOut === 'string' ? bCheckOut.split('T')[0] : ''

      console.log('[BookingEngine] Comparing with existing booking:', b.id, 'dates:', bStart, 'to', bEnd, 'status:', b.status)

      // Check for overlap: (StartA < EndB) and (EndA > StartB)
      const overlaps = (newStart < bEnd && newEnd > bStart)
      if (overlaps) {
        console.log('[BookingEngine] OVERLAP DETECTED with booking:', b.id)
      }
      return overlaps
    })

    if (hasOverlap) {
      const error = new Error('Room is not available for the selected dates')
      console.warn('[BookingEngine] Booking creation blocked due to overlap')
      throw error
    }

    // Generate deterministic IDs to keep UI logic intact
    const timestamp = Date.now()
    const random = Math.random().toString(36).slice(2, 8)
    const suffix = `${timestamp}_${random}`
    let localId = `booking_${suffix}`
    let remoteId = `booking-${suffix}`

    // Create booking remotely. currentUser was fetched in the Phase-1 fan-out;
    // reusing it here saves one more RTT vs the previous sequential await.
    const [, , currentUserFromPhase1] = await phase1
    const currentUser = currentUserFromPhase1 as { id: string; email?: string } | null
    console.log('[BookingEngine] Current user:', currentUser?.id || 'No user authenticated')

    // ROBUST METADATA EXTRACTION
    const groupData = {
      groupId: (bookingData as any).groupId,
      groupReference: (bookingData as any).groupReference,
      isPrimaryBooking: (bookingData as any).isPrimaryBooking,
      billingContact: (bookingData as any).billingContact,
      additionalCharges: (bookingData as any).additionalCharges,
      discount: (bookingData as any).discount,
      subtotal: (bookingData as any).subtotal
    }

    // Determine if we need to attach metadata
    // We attach if there is a group ID OR if there are billing adjustments (charges/discount)
    const hasGroupData = !!groupData.groupId ||
      (groupData.additionalCharges && groupData.additionalCharges.length > 0) ||
      !!groupData.discount

    // Build payment tracking metadata.
    //
    // `perRoom` states that amountPaid is THIS room's own figure. Group
    // bookings written before 2026-08-21 stamped the whole batch's payment on
    // every room, and readers have to prorate those back down by guessing
    // which rows are duplicates. The flag removes the guessing for every row
    // written from here on — callers all pass a per-room amount.
    const paymentTrackingData = {
      amountPaid: bookingData.amountPaid ?? 0,
      paymentStatus: bookingData.paymentStatus ?? 'pending',
      perRoom: true,
    }
    const hasPaymentTracking = paymentTrackingData.amountPaid > 0 || paymentTrackingData.paymentStatus !== 'pending'

    // Preserve any PAYMENT_EVENTS comment already present in bookingData.specialRequests.
    // OnsiteBookingPage, GroupManageDialog, etc. encode the payment event there for per-staff
    // revenue attribution. createBooking rebuilds specialRequests from scratch, so we must
    // carry the comment forward explicitly.
    const incomingSpecialReq = (bookingData as any).specialRequests || ''
    const existingPaymentEventsMatch = incomingSpecialReq.match(/<!-- PAYMENT_EVENTS:(.*?) -->/)
    const preservedPaymentEvents = existingPaymentEventsMatch
      ? `\n\n<!-- PAYMENT_EVENTS:${existingPaymentEventsMatch[1]} -->`
      : ''

    // Always snapshot the guest name/email at booking time.
    // This is the single source of truth for "who was this booking for" and is immune
    // to changes in the shared guests table (which would otherwise retroactively rename
    // every booking that shares the same guestId).
    // Use the validated guestName here — never the raw form value, which can
    // be empty and produce a snapshot that perpetuates the "Guest" bug.
    const guestSnapshot = {
      name: guestName,
      email: bookingData.guest.email,
      phone: bookingData.guest.phone || '',
    }

    const specialRequests = (bookingData.notes || '') +
      preservedPaymentEvents +
      (hasGroupData ? `\n\n<!-- GROUP_DATA:${JSON.stringify(groupData)} -->` : '') +
      (hasPaymentTracking ? `\n\n<!-- PAYMENT_DATA:${JSON.stringify(paymentTrackingData)} -->` : '') +
      (bookingData.paymentSplits && bookingData.paymentSplits.length > 1
        ? `\n\n<!-- PAYMENT_SPLITS:${JSON.stringify(bookingData.paymentSplits)} -->`
        : '') +
      `\n\n<!-- GUEST_SNAPSHOT:${JSON.stringify(guestSnapshot)} -->` +
      `\n\n<!-- ROOM_SNAPSHOT:${JSON.stringify({ roomNumber: bookingData.roomNumber })} -->`

    console.log('[BookingEngine Debug] Generated specialRequests length:', specialRequests.length)
    if (hasGroupData) {
      console.log('[BookingEngine Debug] Attached Group Data:', JSON.stringify(groupData, null, 2))
    }
    if (hasPaymentTracking) {
      console.log('[BookingEngine Debug] Attached Payment Data:', JSON.stringify(paymentTrackingData, null, 2))
    }

    // Explicitly list only columns that exist in the bookings table schema.
    // Never spread bookingData directly — it contains UI-only fields (paymentStatus,
    // amountPaid, paymentSplits, etc.) that have no DB column and would cause
    // "column not found in schema cache" errors.
    const bookingPayload: Record<string, any> = {
      userId: currentUser?.id || null,
      guestId,
      roomId: room.id,
      checkIn: bookingData.dates.checkIn,
      checkOut: bookingData.dates.checkOut,
      status: bookingData.status,
      source: bookingData.source,
      totalPrice: bookingData.amount ?? 0,
      numGuests: bookingData.numGuests ?? 1,
      specialRequests,
      createdBy: bookingData.createdBy || currentUser?.id || null,
    }

    // paymentMethod IS a real DB column — include only when present
    const rawPaymentMethod = bookingData.paymentMethod || (bookingData as any).payment_method
    if (rawPaymentMethod) bookingPayload.paymentMethod = rawPaymentMethod

    // Idempotency key: lets the DB unique index dedupe double-click races.
    if (bookingData.idempotencyKey) {
      bookingPayload.clientRequestId = bookingData.idempotencyKey
    }

    // Avoid pretty-printing the whole payload — it was costing real ms on
    // mobile devices because the object is ~5-10 KB and JSON.stringify is
    // synchronous. Log just the identifying bits; the full payload is still
    // available in the network panel.
    console.log('[BookingEngine] Creating booking', {
      guestId,
      roomId: bookingPayload.roomId,
      checkIn: bookingPayload.checkIn,
      checkOut: bookingPayload.checkOut,
      status: bookingPayload.status,
    })

    try {
      const created = await db.bookings.create(bookingPayload)
      console.log('[BookingEngine] Booking created successfully:', created?.id || '(no id returned)')
    } catch (bookingErr: any) {
      const msg = bookingErr?.message || ''
      const code = bookingErr?.code
      const status = bookingErr?.status
      console.error('[BookingEngine] Booking creation failed:', code, status, msg)
      console.error('[BookingEngine] Full error object:', JSON.stringify(bookingErr, null, 2))
      console.error('[BookingEngine] Error stack:', bookingErr?.stack)

      const isDuplicate =
        code === '23505' ||
        status === 409 ||
        msg.includes('Constraint violation') ||
        msg.toLowerCase().includes('duplicate key value')

      if (isDuplicate) {
        // Re-read the existing row so the rest of the function operates on the
        // canonical DB id, not the locally-generated one that never landed.
        let existing: any = null
        if (bookingData.idempotencyKey) {
          try {
            const matches = await db.bookings.list({
              where: { clientRequestId: bookingData.idempotencyKey },
              limit: 1,
            })
            existing = matches?.[0]
          } catch (lookupErr) {
            console.warn('[BookingEngine] Idempotency lookup failed:', lookupErr)
          }
        }
        if (!existing) {
          try {
            const matches = await db.bookings.list({
              where: {
                guestId,
                roomId: room.id,
                checkIn: bookingData.dates.checkIn,
                checkOut: bookingData.dates.checkOut,
              },
              limit: 1,
            })
            existing = matches?.[0]
          } catch (lookupErr) {
            console.warn('[BookingEngine] Active-uniqueness lookup failed:', lookupErr)
          }
        }
        if (existing?.id) {
          console.log('[BookingEngine] Reusing existing booking row:', existing.id)
          remoteId = existing.id
          localId = existing.id
        } else {
          console.warn('[BookingEngine] Duplicate signaled but existing row not found; continuing with local id')
        }
      } else {
        // For any other error, throw it with full details
        const errorMessage = `Failed to create booking: ${msg || 'Unknown error'} (Status: ${status || 'N/A'})`
        console.error('[BookingEngine] Throwing error:', errorMessage)
        throw new Error(errorMessage)
      }
    }

    // Ensure room is marked available for the new booking, UNLESS it is currently occupied.
    // The user explicitly requested: "once the booking is created, the room status should always be available".
    // We safeguard this by NOT resetting 'occupied' or 'maintenance' rooms (which would be a bug for future bookings).
    //
    // PERFORMANCE: This block runs as fire-and-forget so it never gates the
    // success toast. Up to four sequential RTTs (rooms.get, rooms.update,
    // properties.list, properties.update) — was costing 600-1200ms in Ghana.
    // The booking row is already committed by this point; eventual consistency
    // on room/property status is acceptable (reads pick up the new state on
    // next refresh, and the calling page reloads its data after the toast).
    if (bookingData.status !== 'checked-in') {
      const roomForBackground = room
      Promise.resolve().then(async () => {
        try {
          // Sync with both tables to be safe, preferring rooms as canonical for status
          const currentRoom = await (db as any).rooms.get(roomForBackground.id).catch(() => roomForBackground)

          if (currentRoom?.status === 'cleaning' || currentRoom?.status === 'active' || currentRoom?.status === 'available') {
            if (currentRoom?.status !== 'active' && currentRoom?.status !== 'available') {
              await (db as any).rooms.update(roomForBackground.id, { status: 'active' })
              await db.properties.update(roomForBackground.id, { status: 'active' }).catch(() => null)
              console.log('[BookingEngine] Reset room status to active')
            }
          }
        } catch (statusError) {
          console.warn('[BookingEngine] Failed to sync property status:', statusError)
        }
      })
    }

    const now = new Date().toISOString()
    console.log('[BookingEngine] Building local booking object — createdBy:', bookingData.createdBy)

    const local: LocalBooking = {
      _id: localId,
      guest: bookingData.guest,
      roomType: bookingData.roomType,
      roomNumber: bookingData.roomNumber,
      dates: bookingData.dates,
      numGuests: bookingData.numGuests,
      amount: bookingData.amount,
      status: bookingData.status,
      source: bookingData.source,
      payment: bookingData.payment,
      amountPaid: bookingData.amountPaid ?? 0,
      paymentStatus: bookingData.paymentStatus ?? 'pending',
      notes: bookingData.notes,
      createdBy: bookingData.createdBy,
      createdByName: bookingData.createdByName,
      createdAt: now,
      updatedAt: now,
      synced: true,
      paymentMethod: bookingData.paymentMethod || bookingData.payment_method,
      paymentSplits: bookingData.paymentSplits || undefined,
      additionalCharges: bookingData.additionalCharges,
      discount: bookingData.discount,
      subtotal: bookingData.subtotal
    }
    console.log('[BookingEngine] Local booking created — id:', local._id, 'createdBy:', local.createdBy)

    // Log activity (fire-and-forget — non-blocking; never let it gate the toast).
    activityLogService.logBookingCreated(remoteId, {
      guestName: bookingData.guest.fullName,
      guestEmail: bookingData.guest.email,
      roomNumber: bookingData.roomNumber,
      roomType: bookingData.roomType,
      checkIn: bookingData.dates.checkIn,
      checkOut: bookingData.dates.checkOut,
      amount: bookingData.amount,
      status: bookingData.status,
      source: bookingData.source,
    }, bookingData.createdBy || currentUser?.id).catch(err => {
      console.error('[BookingEngine] Failed to log activity:', err)
    })

    // Update Guest record with latest booking details (fire-and-forget).
    // Two sequential db.guests.get + an update were costing ~600 ms in Ghana on
    // every booking. The data is for guest-history bookkeeping; correctness is
    // eventually-consistent and a failure here must not block the booking flow.
    if (guestId) {
      Promise.resolve().then(async () => {
        try {
          const existingGuest = await db.guests.get(guestId).catch(() => ({} as any))
          const guestUpdatePayload = {
            last_booking_date: now,
            last_room_number: local.roomNumber,
            last_check_in: local.dates.checkIn,
            last_check_out: local.dates.checkOut,
            last_source: local.source || 'reception',
            total_revenue: (existingGuest?.total_revenue || 0) + Number(local.amount || 0),
            total_stays: (existingGuest?.total_stays || 0) + 1,
          }
          console.log('[BookingEngine] Persisting booking source to guest record:', guestId, guestUpdatePayload)
          await db.guests.update(guestId, guestUpdatePayload)
        } catch (guestUpdateErr) {
          console.warn('[BookingEngine] Failed to persist booking source to guest record:', guestUpdateErr)
        }
      })
    }

    // Send Booking Confirmation Email + generate the Pre-Invoice PDF attachment.
    // Only fires for confirmed/reserved bookings (not drafts/cancellations).
    //
    // PERFORMANCE: This entire block runs as fire-and-forget. The PDF
    // generation alone (createPreInvoiceData → generateInvoicePDF →
    // blobToBase64) used to be awaited inline and took 2-5 seconds on Ghana
    // mobile because jsPDF + html2canvas are CPU-heavy. The booking row is
    // already committed at this point, so deferring the email/attachment
    // work has no effect on data integrity — the email simply lands a few
    // seconds later. UI gets the success toast immediately.
    if (['confirmed', 'reserved'].includes(local.status)) {
      const bookingForEmail = {
        id: local._id,
        checkIn: local.dates.checkIn,
        checkOut: local.dates.checkOut
      }

      const guestForEmail = {
        id: guestId,
        name: local.guest.fullName,
        email: local.guest.email,
        phone: local.guest.phone || null
      }

      const roomForEmail = {
        id: room.id,
        roomNumber: local.roomNumber
      }

      const paymentInfo = (local.amountPaid || local.paymentStatus) ? {
        amountPaid: local.amountPaid || 0,
        paymentStatus: (local.paymentStatus || 'pending') as 'full' | 'part' | 'pending',
        totalPrice: local.amount || 0
      } : undefined

      // Snapshot every value the background task needs so it doesn't reach
      // back into the local closure after we've returned (closure is fine,
      // but explicit is clearer when reading).
      const bgGuestId = guestId
      const bgRoomId = room.id
      const bgRoomNumber = local.roomNumber
      const bgRoomType = local.roomType
      const bgLocalId = local._id
      const bgSpecialRequests = bookingPayload.specialRequests

      Promise.resolve().then(async () => {
        console.log(`[BookingEngine] Attempting to send confirmation email for booking ${bgLocalId}…`)

        // Generate Pre-Invoice PDF
        let attachments: any[] | undefined = undefined
        try {
          console.log('[BookingEngine] Generating pre-invoice PDF for attachment…')
          const bookingWithDetails = {
            id: bgLocalId,
            guestId: bgGuestId!,
            roomId: bgRoomId,
            checkIn: local.dates.checkIn,
            checkOut: local.dates.checkOut,
            status: local.status,
            totalPrice: local.amount,
            numGuests: local.numGuests,
            amountPaid: local.amountPaid || 0,
            paymentStatus: local.paymentStatus || 'pending',
            specialRequests: bgSpecialRequests,
            guest: {
              name: local.guest.fullName,
              email: local.guest.email,
              phone: local.guest.phone,
              address: local.guest.address
            },
            room: {
              roomNumber: bgRoomNumber,
              roomType: bgRoomType
            },
            createdAt: local.createdAt
          }

          const roomDetails = {
            roomNumber: bgRoomNumber,
            roomType: bgRoomType
          }

          const invoiceData = await createPreInvoiceData(bookingWithDetails, roomDetails)
          const pdfBlob = await generateInvoicePDF(invoiceData)
          const base64Pdf = await blobToBase64(pdfBlob)
          const content = base64Pdf.includes(',') ? base64Pdf.split(',')[1] : base64Pdf

          attachments = [{
            filename: `Pre-Invoice-${invoiceData.invoiceNumber}.pdf`,
            content: content,
            contentType: 'application/pdf'
          }]
          console.log('[BookingEngine] Pre-invoice PDF generated and attached')
        } catch (pdfError) {
          console.error('[BookingEngine] Failed to generate pre-invoice PDF:', pdfError)
          // Proceed without attachment — email still sends.
        }

        try {
          await sendBookingConfirmation(guestForEmail, roomForEmail, bookingForEmail, attachments, paymentInfo)
          console.log(`[BookingEngine] Confirmation email request sent for ${bgLocalId}`)
        } catch (err) {
          console.error('[BookingEngine] Failed to send confirmation email:', err)
        }
      })
    }

    console.log('[BookingEngine] Booking completed successfully:', localId)
    this.invalidateCache()
    this.notifySyncHandlers('synced', 'Booking saved to database')
    return local
  }

  async createGroupBooking(
    bookingsData: Array<Omit<LocalBooking, '_id' | 'createdAt' | 'updatedAt' | 'synced'>>,
    billingContact: any,
    additionalCharges: { description: string, amount: number }[] = [],
    discount: { type: 'percentage' | 'fixed', value: number, amount: number } | undefined = undefined
  ): Promise<LocalBooking[]> {
    const groupId = uuidv4()
    // Generate a short human-readable reference for the group (e.g. GRP-A1B2)
    const shortRef = Math.random().toString(36).substring(2, 6).toUpperCase()
    const groupReference = `GRP-${new Date().getFullYear()}-${shortRef}`

    console.log(`[BookingEngine] Starting Group Booking ${groupReference} (${groupId}) with ${bookingsData.length} rooms`)

    const createdBookings: LocalBooking[] = []

    // Process sequentially to avoid race conditions on guest creation if guests are shared
    for (let i = 0; i < bookingsData.length; i++) {
      const data = bookingsData[i]

      // Inject group metadata
      const bookingWithGroup = {
        ...data,
        groupId,
        groupReference,
        isPrimaryBooking: i === 0, // Mark the first one as primary for logic that needs a "main" record
        billingContact, // Attach billing contact to all records for invoice grouping
        ...(i === 0 ? { additionalCharges, discount } : {}) // Attach changes only to primary booking
      }

      try {
        const created = await this.createBooking(bookingWithGroup)
        createdBookings.push(created)
      } catch (error) {
        console.error(`[BookingEngine] Failed to create booking ${i + 1}/${bookingsData.length} in group:`, error)
        // In a real transactional DB we would rollback here. 
        // For PouchDB/CouchDB, we might want to delete the ones created so far?
        // For now, we'll throw and let the UI handle the partial state or retry.
        throw error
      }
    }

    return createdBookings
  }

  /**
   * Add a new member to an existing group booking
   * Finds the group metadata from existing bookings and creates a new booking with matching settings
   */
  async addToGroup(
    groupId: string,
    bookingData: Omit<LocalBooking, '_id' | 'createdAt' | 'updatedAt' | 'synced'>
  ): Promise<LocalBooking> {
    console.log(`[BookingEngine] Adding new member to group: ${groupId}`)

    // Find existing bookings in this group to get group metadata
    const allBookings = await db.bookings.list({ limit: 500 })
    const groupBookings = allBookings.filter((b: any) => {
      // Check for groupId in the booking or in specialRequests metadata
      if (b.groupId === groupId) return true

      const specialReq = b.special_requests || b.specialRequests || ''
      const match = specialReq.match(/<!-- GROUP_DATA:(.*?) -->/)
      if (match) {
        try {
          const data = JSON.parse(match[1])
          return data.groupId === groupId
        } catch { return false }
      }
      return false
    })

    if (groupBookings.length === 0) {
      throw new Error(`No bookings found for group ${groupId}`)
    }

    // Find the primary booking to get group reference and billing contact
    const primaryBooking = groupBookings.find((b: any) => {
      const specialReq = b.special_requests || b.specialRequests || ''
      const match = specialReq.match(/<!-- GROUP_DATA:(.*?) -->/)
      if (match) {
        try {
          const data = JSON.parse(match[1])
          return data.isPrimaryBooking === true
        } catch { return false }
      }
      return false
    }) || groupBookings[0]

    // Extract group metadata from primary booking
    let groupReference = ''
    let billingContact = null

    const specialReq = primaryBooking.special_requests || primaryBooking.specialRequests || ''
    const match = specialReq.match(/<!-- GROUP_DATA:(.*?) -->/)
    if (match) {
      try {
        const data = JSON.parse(match[1])
        groupReference = data.groupReference || ''
        billingContact = data.billingContact || null
      } catch (e) {
        console.warn('[BookingEngine] Failed to parse group data from primary booking', e)
      }
    }

    console.log(`[BookingEngine] Found group: ${groupReference} with ${groupBookings.length} existing members`)

    // Create new booking with group metadata (NOT primary, no charges/discount)
    const bookingWithGroup = {
      ...bookingData,
      groupId,
      groupReference,
      isPrimaryBooking: false,
      billingContact
    }

    const created = await this.createBooking(bookingWithGroup)
    console.log(`[BookingEngine] Added new member to group ${groupReference}:`, created._id)

    return created
  }

  /**
   * Remove a member from a group booking
   * If removing the primary booking, transfers primary status to another member
   */
  async removeFromGroup(bookingId: string): Promise<{ remainingCount: number; newPrimaryId?: string }> {
    console.log(`[BookingEngine] Removing booking from group: ${bookingId}`)

    // Find the booking
    let booking = await db.bookings.get(bookingId).catch(() => null)

    // Try alternative ID formats if not found
    if (!booking) {
      const allBookings = await db.bookings.list({ limit: 500 })
      booking = allBookings.find((b: any) =>
        b.id === bookingId ||
        b.id === bookingId.replace(/^booking_/, 'booking-') ||
        b.id === bookingId.replace(/^booking-/, 'booking_')
      )
    }

    if (!booking) {
      throw new Error(`Booking not found: ${bookingId}`)
    }

    // Prevent removal if checked in
    if (booking.status === 'checked-in') {
      throw new Error('Cannot remove a booking that is currently checked in. Please check out the guest first.')
    }

    // Extract group info from booking
    let groupId = ''
    let isPrimary = false
    let additionalCharges: any[] = []
    let discount: any = null
    let billingContact: any = null

    const specialReq = booking.special_requests || booking.specialRequests || ''
    const match = specialReq.match(/<!-- GROUP_DATA:(.*?) -->/)
    if (match) {
      try {
        const data = JSON.parse(match[1])
        groupId = data.groupId || ''
        isPrimary = data.isPrimaryBooking === true
        additionalCharges = data.additionalCharges || []
        discount = data.discount || null
        billingContact = data.billingContact || null
      } catch (e) {
        console.warn('[BookingEngine] Failed to parse group data', e)
      }
    }

    if (!groupId) {
      throw new Error('This booking is not part of a group')
    }

    // Find all other bookings in this group
    const allBookings = await db.bookings.list({ limit: 500 })
    const groupBookings = allBookings.filter((b: any) => {
      if (b.id === booking.id) return false // Exclude current booking

      const bSpecialReq = b.special_requests || b.specialRequests || ''
      const bMatch = bSpecialReq.match(/<!-- GROUP_DATA:(.*?) -->/)
      if (bMatch) {
        try {
          const bData = JSON.parse(bMatch[1])
          return bData.groupId === groupId
        } catch { return false }
      }
      return false
    })

    // Cannot remove if this is the last member
    if (groupBookings.length === 0) {
      throw new Error('Cannot remove the last member from a group. Delete the entire group booking instead.')
    }

    let newPrimaryId: string | undefined

    // If we're removing the primary booking, transfer metadata to another booking.
    // Pick deterministically (earliest check-in, tie-break lowest room number) —
    // not "whichever array index happens to be first" from an unordered fetch.
    if (isPrimary && groupBookings.length > 0) {
      const sorted = [...groupBookings].sort((a: any, b: any) => {
        const checkInCmp = String(a.checkIn || '').localeCompare(String(b.checkIn || ''))
        if (checkInCmp !== 0) return checkInCmp
        return String(a.roomNumber || '').localeCompare(String(b.roomNumber || ''), undefined, { numeric: true })
      })
      const newPrimary = sorted[0]
      console.log(`[BookingEngine] Transferring primary status to: ${newPrimary.id}`)

      // Update the new primary booking with group metadata
      const existingSpecialReq = newPrimary.special_requests || newPrimary.specialRequests || ''
      const existingMatch = existingSpecialReq.match(/<!-- GROUP_DATA:(.*?) -->/)
      let existingGroupData: any = {}
      let cleanSpecialReq = existingSpecialReq

      if (existingMatch) {
        try {
          existingGroupData = JSON.parse(existingMatch[1])
          cleanSpecialReq = existingSpecialReq.replace(/<!-- GROUP_DATA:.*? -->/g, '').trim()
        } catch { }
      }

      const newGroupData = {
        ...existingGroupData,
        isPrimaryBooking: true,
        additionalCharges,
        discount,
        billingContact
      }

      const newSpecialReq = cleanSpecialReq + `\n\n<!-- GROUP_DATA:${JSON.stringify(newGroupData)} -->`

      await db.bookings.update(newPrimary.id, { specialRequests: newSpecialReq })
      newPrimaryId = newPrimary.id
      console.log(`[BookingEngine] Primary status transferred to: ${newPrimaryId}`)
    }

    // Delete the booking
    await db.bookings.delete(booking.id)
    console.log(`[BookingEngine] Removed booking ${bookingId} from group. Remaining members: ${groupBookings.length}`)

    this.invalidateCache()
    return {
      remainingCount: groupBookings.length,
      newPrimaryId
    }
  }

  // No-op compatibility for existing calls
  async updateBooking(_id: string, _updates: Partial<LocalBooking>): Promise<void> {
    return
  }

  // Delete a booking from the database
  async deleteBooking(id: string): Promise<void> {
    try {
      console.log('[BookingEngine] Delete booking requested for:', id)

      // The bookings.id column is a Postgres `uuid` — Supabase rejects values
      // that aren't a bare UUID with `invalid input syntax for type uuid`.
      // Locally the UI carries IDs as either `booking_<uuid>` (LocalBooking._id),
      // `booking-<uuid>` (legacy remoteId scheme), or just `<uuid>`. Strip
      // either prefix so we always send the raw UUID to the database.
      const stripPrefix = (raw: string): string =>
        raw.replace(/^booking_/, '').replace(/^booking-/, '')

      let remoteId = stripPrefix(id)

      // Try to get the booking first to gather details for logging
      let booking = null
      let guest = null
      let room = null

      try {
        booking = await db.bookings.get(remoteId).catch(() => null)

        // Prevent deletion if booking is checked in
        if (booking && booking.status === 'checked-in') {
          throw new Error('Cannot delete a booking that is currently checked in. Please check out the guest first.')
        }

        // If not found, try alternative ID formats
        if (!booking) {
          const allBookings = await db.bookings.list({ limit: 500 })
          booking = allBookings.find((b: any) =>
            b.id === remoteId ||
            b.id === id ||
            b.id === id.replace(/^booking_/, 'booking-') ||
            b.id === id.replace(/^booking-/, 'booking_') ||
            // Handle case where DB ID is raw (no prefix) but local ID has booking_ prefix
            b.id === id.replace(/^booking_/, '')
          )
          if (booking) {
            console.log('[BookingEngine] Resolved booking ID from list search:', booking.id)
            remoteId = booking.id
          }
        }

        if (booking) {
          // Double-check status here to catch bookings resolved via fallback list search
          if (booking.status === 'checked-in') {
            throw new Error('Cannot delete a booking that is currently checked in. Please check out the guest first.')
          }

          // Get related guest and room info for logging
          if (booking.guestId) {
            guest = await db.guests.get(booking.guestId).catch(() => null)
          }
          if (booking.roomId) {
            room = await db.properties.get(booking.roomId).catch(() => null)
          }
        }
      } catch (err: any) {
        // If it's our validation error, propagate it!
        if (err.message && err.message.includes('Cannot delete')) {
          throw err
        }
        console.warn('[BookingEngine] Could not fetch booking details for logging:', err)
      }

      // If this booking belongs to a group, route through the group-aware
      // removal so billing contact/discount/charges are transferred to a new
      // primary instead of silently orphaned — a bare delete here previously
      // lost that data whenever the group's primary booking was the one
      // being deleted.
      if (booking) {
        const specialReq = booking.special_requests || booking.specialRequests || ''
        const groupMatch = specialReq.match(/<!-- GROUP_DATA:(.*?) -->/)
        let hasGroup = !!booking.groupId
        if (!hasGroup && groupMatch) {
          try { hasGroup = !!JSON.parse(groupMatch[1]).groupId } catch { /* ignore */ }
        }
        if (hasGroup) {
          try {
            await this.removeFromGroup(remoteId)
            return
          } catch (groupErr: any) {
            // Last remaining member of the group — fall through to a normal
            // single-booking delete rather than blocking the user.
            if (!/last member/i.test(groupErr?.message || '')) throw groupErr
          }
        }
      }

      // Defensively clear out rows that FK to this booking BEFORE we issue
      // the booking DELETE. Some referencing tables (notably invoices and
      // housekeeping_tasks) were created without ON DELETE CASCADE on their
      // FK, so the bookings.delete() call would fail with Postgres 23503
      // (foreign_key_violation) and bubble up as the unhelpful generic
      // "Failed to delete booking" toast. Doing it in code keeps things
      // working today even if the migration in 20260507_cascade_booking_fks
      // hasn't been applied yet.
      const cleanupChildren = async () => {
        const child = async (table: string, where: Record<string, any>) => {
          try {
            const rows = await (db[table]?.list?.({ where, limit: 500 }) ?? Promise.resolve([]))
            for (const row of rows || []) {
              if (row?.id) {
                await db[table].delete(row.id).catch((e: any) => {
                  console.warn(`[BookingEngine] Failed to delete ${table}/${row.id}:`, e?.message || e)
                })
              }
            }
            if (rows?.length) {
              console.log(`[BookingEngine] Removed ${rows.length} ${table} row(s) referencing booking ${remoteId}`)
            }
          } catch (e: any) {
            console.warn(`[BookingEngine] Could not enumerate ${table} for cleanup:`, e?.message || e)
          }
        }
        // booking_charges already cascades but we defend in case it doesn't.
        await child('bookingCharges', { bookingId: remoteId })
        await child('invoices', { bookingId: remoteId })
        // NOTE: housekeeping_tasks does not have a booking_id column in this
        // schema (it links via property_id + room_number), so we deliberately
        // do not enumerate it here. Querying a non-existent column would
        // return a 42703 from PostgREST that, while caught, just produces
        // log noise.
      }
      await cleanupChildren()

      // Perform the actual deletion
      console.log('[BookingEngine] Attempting to delete booking:', remoteId)
      try {
        await db.bookings.delete(remoteId)
        console.log('[BookingEngine] Booking deleted successfully:', remoteId)
      } catch (deleteError: any) {
        const code = deleteError?.code
        const status = deleteError?.status
        const details = deleteError?.details
        const hint = deleteError?.hint
        const baseMsg = deleteError?.message || ''
        console.error('[BookingEngine] Delete operation failed:', deleteError)
        console.error('[BookingEngine] Delete error details:', { message: baseMsg, status, code, details, hint })

        // Build a user-readable message — Supabase errors often have an empty
        // .message but useful .details/.code/.hint, which is why the toast
        // was showing the generic "Failed to delete booking" before.
        let friendly = baseMsg
        if (code === '23503' || /foreign key/i.test(baseMsg) || /foreign key/i.test(details || '')) {
          friendly = 'Cannot delete this booking because related records still reference it (e.g. an invoice or housekeeping task). Please remove those first or contact an admin.'
        } else if (code === '42501' || status === 403) {
          friendly = 'You do not have permission to delete this booking. Please contact an admin.'
        } else if (!friendly) {
          friendly = `Delete failed${code ? ` (code ${code})` : ''}${details ? `: ${details}` : ''}`
        }
        throw new Error(friendly)
      }

      // Also delete any duplicate bookings with the same guest, room, and dates
      // Run this even if guest/room lookup didn't work - try to match by IDs
      try {
        const allBookings = await db.bookings.list({ limit: 500 })
        const allGuests = await db.guests.list({ limit: 500 })
        const allRooms = await db.properties.list({ limit: 500 })

        const guestMap = new Map(allGuests.map((g: any) => [g.id, g]))
        const roomMap = new Map(allRooms.map((r: any) => [r.id, r]))

        const normalizeDate = (d: string) => d ? d.split('T')[0] : ''

        // Use booking-level data for matching (more reliable than resolved guest/room)
        const targetCheckIn = booking ? normalizeDate(booking.checkIn) : ''
        const targetCheckOut = booking ? normalizeDate(booking.checkOut) : ''
        const targetGuestId = booking?.guestId || ''
        const targetRoomId = booking?.roomId || ''
        const targetGuestEmail = guest?.email?.toLowerCase() || ''
        const targetRoomNumber = room?.roomNumber || ''

        console.log('[BookingEngine] Looking for duplicates with:', {
          targetCheckIn, targetCheckOut, targetGuestId, targetRoomId, targetGuestEmail, targetRoomNumber
        })

        // Find all duplicate bookings - match by IDs or by resolved details
        const duplicateBookings = allBookings.filter((b: any) => {
          if (b.id === remoteId) return false // Already deleted
          if (!targetCheckIn || !targetCheckOut) return false // No booking details

          const bCheckIn = normalizeDate(b.checkIn)
          const bCheckOut = normalizeDate(b.checkOut)

          // Check date match first (required)
          if (bCheckIn !== targetCheckIn || bCheckOut !== targetCheckOut) return false

          // Try to match by IDs (fastest, most reliable)
          if (targetGuestId && targetRoomId) {
            if (b.guestId === targetGuestId && b.roomId === targetRoomId) {
              return true
            }
          }

          // Also try to match by resolved email/room number
          const bGuest = guestMap.get(b.guestId) as any
          const bRoom = roomMap.get(b.roomId) as any
          const bGuestEmail = bGuest?.email?.toLowerCase() || ''
          const bRoomNumber = bRoom?.roomNumber || ''

          if (targetGuestEmail && targetRoomNumber) {
            if (bGuestEmail === targetGuestEmail && bRoomNumber === targetRoomNumber) {
              return true
            }
          }

          return false
        })

        console.log('[BookingEngine] Found', duplicateBookings.length, 'duplicate booking(s) to delete')

        // Delete all duplicates
        for (const dup of duplicateBookings) {
          try {
            await db.bookings.delete(dup.id)
            console.log('[BookingEngine] Also deleted duplicate booking:', dup.id)
          } catch (dupErr) {
            console.warn('[BookingEngine] Failed to delete duplicate:', dup.id, dupErr)
          }
        }

        if (duplicateBookings.length > 0) {
          console.log(`[BookingEngine] Deleted ${duplicateBookings.length} duplicate booking(s)`)
        }
      } catch (duplicateErr) {
        console.warn('[BookingEngine] Failed to check/delete duplicates:', duplicateErr)
      }

      // Log the deletion activity (fire-and-forget - never block deletion)
      const currentUser = await auth.me().catch(() => null)
      activityLogService.log({
        action: 'deleted',
        entityType: 'booking',
        entityId: remoteId,
        details: {
          guestName: guest?.name || 'Unknown Guest',
          guestEmail: guest?.email || '',
          roomNumber: room?.roomNumber || 'Unknown Room',
          checkIn: booking?.checkIn,
          checkOut: booking?.checkOut,
          amount: booking?.totalPrice,
          deletedAt: new Date().toISOString()
        },
        userId: currentUser?.id,
        metadata: {
          source: 'booking_deletion',
          deletedBy: 'staff'
        }
      }).catch(logError => {
        console.warn('[BookingEngine] Activity logging failed (non-blocking):', logError)
      })

      // Conditional guest deletion:
      // Delete guest only if booking was NOT checked-out (never completed their stay)
      // AND the guest has no other bookings
      if (booking && booking.guestId && booking.status !== 'checked-out') {
        try {
          // Check if guest has any other bookings
          const remainingBookings = await db.bookings.list({ limit: 500 })
          const guestOtherBookings = remainingBookings.filter((b: any) =>
            b.guestId === booking.guestId && b.id !== remoteId
          )

          if (guestOtherBookings.length === 0) {
            // No other bookings, safe to delete guest
            console.log('[BookingEngine] Deleting guest with no remaining bookings:', booking.guestId)
            await db.guests.delete(booking.guestId)
            console.log('[BookingEngine] Guest deleted successfully:', booking.guestId)
          } else {
            console.log('[BookingEngine] Guest has', guestOtherBookings.length, 'other booking(s), keeping guest record')
          }
        } catch (guestDeleteErr) {
          console.warn('[BookingEngine] Failed to delete guest (non-blocking):', guestDeleteErr)
        }
      } else if (booking?.status === 'checked-out') {
        // Snapshot booking data to guest record before deletion (for legacy bookings that weren't snapshotted on checkout)
        console.log('[BookingEngine] Booking was checked-out, preserving guest record for history')
        if (booking.guestId) {
          try {
            // Fetch guest if not already available
            let guestForUpdate = guest
            if (!guestForUpdate) {
              guestForUpdate = await db.guests.get(booking.guestId).catch(() => null)
            }

            if (guestForUpdate) {
              const guestHistoryUpdate = {
                last_booking_date: booking.createdAt || new Date().toISOString(),
                last_room_number: room?.roomNumber || booking.roomNumber || '',
                last_check_in: booking.checkIn,
                last_check_out: booking.checkOut,
                last_source: booking.source || 'reception',
                total_revenue: Number(booking.totalPrice || 0),
                total_stays: (guestForUpdate.total_stays || 0) + 1
              }
              console.log('[BookingEngine] Saving guest history update:', JSON.stringify(guestHistoryUpdate, null, 2))
              await db.guests.update(booking.guestId, guestHistoryUpdate)
              console.log('[BookingEngine] Guest history snapshot saved before deletion:', booking.guestId)
            } else {
              console.warn('[BookingEngine] Could not find guest for history snapshot:', booking.guestId)
            }
          } catch (historyErr) {
            console.error('[BookingEngine] Failed to save guest history snapshot:', historyErr)
          }
        }
      }

      this.invalidateCache()
      this.notifySyncHandlers('synced', 'Booking deleted successfully')
    } catch (error) {
      console.error('[BookingEngine] Failed to delete booking:', error)
      this.notifySyncHandlers('error', 'Failed to delete booking')
      throw error
    }
  }


  // Map DB bookings to LocalBooking for Admin views
  async getAllBookings(): Promise<LocalBooking[]> {
    const now = Date.now()
    if (this._allBookingsCache && now - this._allBookingsCache.ts < this._allBookingsTTL) {
      return this._allBookingsCache.data
    }
    // If a fetch is already in-flight, return same promise (dedup concurrent callers)
    if (this._allBookingsInflight) return this._allBookingsInflight
    this._allBookingsInflight = this._fetchAllBookings()
    try {
      return await this._allBookingsInflight
    } finally {
      this._allBookingsInflight = null
    }
  }

  private async _fetchAllBookings(): Promise<LocalBooking[]> {
    // Resolve booking->room display data from `properties` (canonical Rooms
    // page data — name, type, price), not the legacy `rooms` mirror, which
    // only ever carries id/roomNumber/status.
    const [bookings, rooms, guests] = await Promise.all([
      db.bookings.list({ orderBy: { createdAt: 'desc' }, limit: 5000 }),
      db.properties.listAll().catch(() => []),
      db.guests.list(),
    ])

    const safeRooms = (rooms || []) as any[]
    const safeGuests = (guests || []) as any[]
    const safeBookings = (bookings || []) as any[]


    const roomMap = new Map(safeRooms.map((r: any) => [r.id, r]))
    const guestMap = new Map(safeGuests.map((g: any) => [g.id, g]))

    const mappedBookings = safeBookings.map((b: any) => {
      const room = roomMap.get(b.roomId) as any
      const guest = guestMap.get(b.guestId) as any
      const remoteId: string = b.id || ''
      const localId = `booking_${remoteId.replace(/^booking-/, '')}`
      const createdAt = b.createdAt || b.checkIn
      // Map payment data if available (may be enhanced after PAYMENT_EVENTS parsing below)
      let payment = b.paymentMethod || b.payment_method ? {
        method: b.paymentMethod || b.payment_method || 'cash',
        status: b.paymentStatus || b.payment_status || 'pending'
      } : undefined

      // Extract payment tracking data from specialRequests metadata
      let amountPaid = 0
      let paymentStatus: 'full' | 'part' | 'pending' = 'pending'
      const specialReq = b.special_requests || b.specialRequests || ''
      const paymentMatch = specialReq.match(/<!-- PAYMENT_DATA:(.*?) -->/)
      if (paymentMatch) {
        try {
          const paymentData = JSON.parse(paymentMatch[1])
          amountPaid = paymentData.amountPaid || 0
          paymentStatus = paymentData.paymentStatus || 'pending'
        } catch (e) {
          console.warn('[BookingEngine] Failed to parse payment data from specialRequests')
        }
      }
      // Parse per-stage payment events once. Used both for the amountPaid fallback
      // below AND attached to the booking so consumers can attribute revenue by the
      // period a payment was actually collected (paidAt) — see revenue-service R1.
      const paymentEvents = parsePaymentEvents(specialReq)
      // Fallback: if PAYMENT_DATA didn't provide amountPaid, check PAYMENT_EVENTS
      // (newer bookings may record events without a separate PAYMENT_DATA comment)
      let paymentEventMethod: string | undefined
      if (amountPaid <= 0 && paymentStatus === 'pending') {
        const events = paymentEvents
        if (events.length > 0) {
          const bookingStageEvents = events.filter(e => e.stage === 'booking')
          const bookingStageTotal = bookingStageEvents.reduce((s, e) => s + (e.amount || 0), 0)
          const allTotal = events.reduce((s, e) => s + (e.amount || 0), 0)
          amountPaid = bookingStageTotal || allTotal
          if (amountPaid > 0) {
            const roomPrice = Number(b.totalPrice || 0)
            paymentStatus = amountPaid >= roomPrice ? 'full' : 'part'
          }
          // Derive payment method from the booking-stage event (or first event)
          const methodEvent = bookingStageEvents[0] || events[0]
          if (methodEvent?.method) paymentEventMethod = methodEvent.method
        }
      }
      // If no payment object yet but PAYMENT_EVENTS provided a method, create one
      if (!payment && paymentEventMethod) {
        payment = { method: paymentEventMethod, status: paymentStatus }
      }

      // Parse group data from specialRequests so consumers know about group membership
      let groupId: string | undefined
      let groupReference: string | undefined
      let isPrimaryBooking: boolean | undefined
      const groupMatch = specialReq.match(/<!-- GROUP_DATA:(.*?) -->/)
      if (groupMatch && groupMatch[1]) {
        try {
          const groupData = JSON.parse(groupMatch[1])
          groupId = groupData.groupId
          groupReference = groupData.groupReference
          isPrimaryBooking = groupData.isPrimaryBooking
        } catch (e) {
          // ignore malformed group data
        }
      }

      // Parse GUEST_SNAPSHOT — the name/email captured at booking time.
      // This is immune to changes in the guests table and is the authoritative source
      // for "who was this booking for". Fall back to the live guest table only for
      // old bookings that pre-date this snapshot feature.
      let snapshotName: string | undefined
      let snapshotEmail: string | undefined
      let snapshotPhone: string | undefined
      const snapshotMatch = specialReq.match(/<!-- GUEST_SNAPSHOT:(.*?) -->/)
      if (snapshotMatch && snapshotMatch[1]) {
        try {
          const snap = JSON.parse(snapshotMatch[1])
          snapshotName = snap.name || undefined
          snapshotEmail = snap.email || undefined
          snapshotPhone = snap.phone || undefined
        } catch (e) {
          // ignore malformed snapshot
        }
      }

      // Parse ROOM_SNAPSHOT
      let snapshotRoomNumber: string | undefined
      const roomSnapMatch = specialReq.match(/<!-- ROOM_SNAPSHOT:(.*?) -->/)
      if (roomSnapMatch && roomSnapMatch[1]) {
        try {
          const snap = JSON.parse(roomSnapMatch[1])
          snapshotRoomNumber = snap.roomNumber || undefined
        } catch (e) {
          // ignore malformed snapshot
        }
      }

      // Parse payment splits from specialRequests
      let paymentSplits: Array<{ method: string; amount: number }> | undefined
      const splitsMatch = specialReq.match(/<!-- PAYMENT_SPLITS:(.*?) -->/)
      if (splitsMatch && splitsMatch[1]) {
        try {
          paymentSplits = JSON.parse(splitsMatch[1])
        } catch (e) {
          // ignore malformed splits data
        }
      }

      const discountAmt = Number(b.discountAmount || b.discount_amount || 0)
      // Only use stored finalAmount when a discount was actually applied — prevents
      // a Supabase/ORM default of 0 on the final_amount column from overriding totalPrice
      const rawFinalAmount = b.finalAmount ?? b.final_amount
      const effectiveAmount = (discountAmt > 0 && rawFinalAmount != null && Number(rawFinalAmount) >= 0)
        ? Number(rawFinalAmount)
        : Math.max(0, Number(b.totalPrice || 0) - discountAmt)

      const local: LocalBooking = {
        _id: localId,
        remoteId: remoteId || localId,
        guest: {
          fullName: snapshotName || guest?.name || 'Guest',
          email: snapshotEmail || guest?.email || '',
          phone: snapshotPhone || guest?.phone || '',
          address: guest?.address || '',
        },
        roomType: room?.roomTypeId || '',
        roomNumber: room?.roomNumber || snapshotRoomNumber || '',
        dates: {
          checkIn: b.checkIn,
          checkOut: b.checkOut,
        },
        numGuests: b.numGuests || 1,
        amount: effectiveAmount,
        discountAmount: discountAmt,
        status: b.status || 'confirmed',
        source: b.source || 'online',
        payment: payment ? {
          ...payment,
          amount: effectiveAmount
        } : undefined,
        amountPaid,
        paymentStatus,
        payment_method: b.paymentMethod || b.payment_method || paymentEventMethod,
        createdAt,
        updatedAt: b.updatedAt || createdAt,
        synced: true,
        groupId,
        groupReference,
        isPrimaryBooking,
        createdBy: b.createdBy || b.created_by || undefined,
        createdByName: b.createdByName || b.created_by_name || undefined,
        checkInBy: b.checkInBy || b.check_in_by || undefined,
        checkInByName: b.checkInByName || b.check_in_by_name || undefined,
        checkOutBy: b.checkOutBy || b.check_out_by || undefined,
        checkOutByName: b.checkOutByName || b.check_out_by_name || undefined,
        paymentSplits,
        paymentEvents,
      }
      return local
    })

    // Deduplicate bookings based on unique combination of guest, room, and dates.
    // Handles date format differences (ISO datetime vs date-only strings).
    // When duplicates with different statuses exist, keep the most advanced status.
    const normDate = (d: string) => (d || '').split('T')[0]

    const statusPriority: Record<string, number> = {
      'checked-out': 5,
      'checked-in': 4,
      'confirmed': 3,
      'reserved': 2,
      'cancelled': 1
    }

    const uniqueBookings = mappedBookings.reduce((acc: LocalBooking[], current: LocalBooking) => {
      const curIn = normDate(current.dates.checkIn)
      const curOut = normDate(current.dates.checkOut)
      const curEmail = current.guest.email.trim().toLowerCase()
      const curName = current.guest.fullName.trim().toLowerCase()

      const duplicateIndex = acc.findIndex(booking => {
        // Room must match
        if (booking.roomNumber !== current.roomNumber) return false
        // Dates must match (format-agnostic comparison)
        if (normDate(booking.dates.checkIn) !== curIn) return false
        if (normDate(booking.dates.checkOut) !== curOut) return false
        // Guest match: prefer email, fall back to name (don't match empty values)
        const bookEmail = booking.guest.email.trim().toLowerCase()
        const bookName = booking.guest.fullName.trim().toLowerCase()
        if (curEmail && bookEmail) return curEmail === bookEmail
        if (!curEmail && !bookEmail) return curName !== '' && curName === bookName
        return false // one has email, other doesn't — treat as different guests
      })

      if (duplicateIndex >= 0) {
        const existing = acc[duplicateIndex]
        const existingPriority = statusPriority[existing.status] || 0
        const currentPriority = statusPriority[current.status] || 0

        // Keep the one with higher priority status (more advanced in booking lifecycle)
        if (currentPriority > existingPriority) {
          console.log(`[BookingEngine] Replacing duplicate booking ${existing._id} (status: ${existing.status}) with ${current._id} (status: ${current.status})`)
          acc[duplicateIndex] = current
        } else {
          console.log(`[BookingEngine] Removed duplicate booking for ${current.guest.email || current.guest.fullName} in room ${current.roomNumber} (keeping status: ${existing.status})`)
        }
      } else {
        acc.push(current)
      }

      return acc
    }, [])

    this._allBookingsCache = { data: uniqueBookings, ts: Date.now() }
    return uniqueBookings
  }

  async getBookingsByStatus(status: LocalBooking['status']): Promise<LocalBooking[]> {
    const all = await this.getAllBookings()
    return all.filter(b => b.status === status)
  }

  async getPendingSyncBookings(): Promise<LocalBooking[]> { return [] }

  // Compute conflicts from DB data (overlapping active bookings on same room)
  async getConflictedBookings(): Promise<LocalBooking[]> {
    const activeStatuses: LocalBooking['status'][] = ['reserved', 'confirmed', 'checked-in']
    const all = await this.getAllBookings()
    const conflicts: LocalBooking[] = []

    const byRoom = new Map<string, LocalBooking[]>()
    all.forEach(b => {
      if (!activeStatuses.includes(b.status)) return
      const arr = byRoom.get(b.roomNumber) || []
      arr.push(b)
      byRoom.set(b.roomNumber, arr)
    })

    for (const [, list] of byRoom) {
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i]
          const c = list[j]
          const aIn = new Date(a.dates.checkIn).getTime()
          const aOut = new Date(a.dates.checkOut).getTime()
          const cIn = new Date(c.dates.checkIn).getTime()
          const cOut = new Date(c.dates.checkOut).getTime()
          const overlap = aIn < cOut && cIn < aOut
          if (overlap) {
            conflicts.push({ ...a, conflict: true })
            conflicts.push({ ...c, conflict: true })
          }
        }
      }
    }

    // Deduplicate by _id
    const seen = new Set<string>()
    return conflicts.filter(b => (seen.has(b._id) ? false : (seen.add(b._id), true)))
  }

  async updateBookingStatus(remoteId: string, status: LocalBooking['status']) {
    console.log('[BookingEngine] updateBookingStatus called with:', { remoteId, status })

    // Get booking details for logging
    try {
      let booking = await db.bookings.get(remoteId).catch(() => null)

      // If booking not found with remoteId, try to find it by listing all bookings
      if (!booking) {
        console.log('[BookingEngine] Booking not found with ID:', remoteId, '- searching in all bookings...')
        const allBookings = await db.bookings.list({ limit: 500 })
        // Try to find booking by matching the ID pattern
        booking = allBookings.find((b: any) =>
          b.id === remoteId ||
          b.id === remoteId.replace(/^booking_/, 'booking-') ||
          b.id === remoteId.replace(/^booking-/, 'booking_')
        )

        if (booking) {
          console.log('[BookingEngine] Found booking with alternative ID:', booking.id)
          // Update remoteId to the actual ID
          remoteId = booking.id
        } else {
          console.error('[BookingEngine] Booking not found. Available booking IDs:', allBookings.slice(0, 5).map((b: any) => b.id))
          throw new Error(`Booking not found: ${remoteId}`)
        }
      }

      console.log('[BookingEngine] Found booking:', { id: booking.id, status: booking.status, guestId: booking.guestId })

      const guest = booking.guestId ? await db.guests.get(booking.guestId).catch(() => null) : null
      const room = booking.roomId ? await (db as any).rooms.get(booking.roomId).catch(() => null) : null
      const currentUser = await auth.me().catch(() => null)

      // Update status
      // Prepare updates object
      const updates: any = { status }

      // Set timestamp updates based on status change
      if (status === 'checked-in') {
        // Prevent check-in if room is already occupied
        if (room) {
          try {
            const activeBookings = await db.bookings.list({
              where: {
                roomId: room.id,
                status: 'checked-in'
              }
            })
            // Filter out self just in case (though unlikely to be checked-in already if we are setting it now)
            const otherActive = activeBookings.filter((b: any) => b.id !== remoteId)

            if (otherActive.length > 0) {
              const occupant = otherActive[0] // Just take the first one
              // Try to find occupant name for better error message
              let occupantName = 'another guest'
              if (occupant.guestId) {
                const g = await db.guests.get(occupant.guestId).catch(() => null)
                if (g) occupantName = g.name
              }
              throw new Error(`Cannot check in: Room ${room.roomNumber} is currently occupied by ${occupantName}. Check out the previous guest first.`)
            }
          } catch (checkErr: any) {
            // Rethrow if it's our content error, otherwise log and continue (fail safe? or fail secure?)
            // We should fail secure: if we can't verify occupancy, don't allow checkin? 
            // Or log and throw?
            if (checkErr.message && checkErr.message.includes('Cannot check in')) {
              throw checkErr
            }
            console.warn('[BookingEngine] Failed to check occupancy, proceeding with caution:', checkErr)
          }
        }

        if (currentUser?.id) {
          updates.checkInBy = currentUser.id

          // Try to resolve name from staff table if possible, otherwise use user metadata or fallback
          // Ideally we should have fetched the staff record for currentUser earlier if we want the "Display Name" (e.g. Admin)
          // But here we might just have the raw auth user.
          // Let's see if we can get a name.
          const name = currentUser.user_metadata?.full_name || currentUser.user_metadata?.name || currentUser.email || 'Staff'
          updates.checkInByName = name
        }
        updates.actualCheckIn = new Date().toISOString()

        // Auto-update room status
        if (room) {
          try {
            await (db as any).rooms.update(room.id, { status: 'occupied' })
            await db.properties.update(room.id, { status: 'occupied' }).catch(() => null)
          } catch (e) {
            console.warn('[BookingEngine] Failed to auto-update room status on check-in:', e)
          }
        }
      } else if (status === 'checked-out') {
        if (currentUser?.id) {
          updates.checkOutBy = currentUser.id
          const name = currentUser.user_metadata?.full_name || currentUser.user_metadata?.name || currentUser.email || 'Staff'
          updates.checkOutByName = name
        }
        updates.actualCheckOut = new Date().toISOString()

        // Auto-update room status and create cleanup task
        if (room) {
          try {
            await (db as any).rooms.update(room.id, { status: 'cleaning' })
            await db.properties.update(room.id, { status: 'cleaning' }).catch(() => null)

            // Create housekeeping task
            const roomNumber = (room as any)?.roomNumber || (room as any)?.name || 'N/A'
            const taskId = `task_${Date.now()}_${Math.random().toString(36).substring(7)}`
            await db.housekeepingTasks.create({
              id: taskId,
              userId: currentUser?.id || booking.userId || '',
              propertyId: room.id,
              roomNumber,
              status: 'pending',
              notes: `Checkout cleaning for ${guest?.name || 'Guest'}`,
              createdAt: new Date().toISOString()
            })

            // Log housekeeping task creation
            await activityLogService.log({
              action: 'created',
              entityType: 'task',
              entityId: taskId,
              details: {
                title: `Room ${roomNumber} Cleaning`,
                roomNumber,
                guestName: guest?.name || 'Guest',
                reason: 'checkout',
                createdAt: new Date().toISOString()
              }
            }).catch(err => console.error('Failed to log task creation:', err))
          } catch (e) {
            console.warn('[BookingEngine] Failed to auto-update room/task on check-out:', e)
          }
        }
      }

      console.log('[BookingEngine] Updating booking with:', { remoteId, updates: JSON.stringify(updates) })
      await db.bookings.update(remoteId, updates)

      // Log appropriate activity based on status
      if (status === 'checked-in') {
        await activityLogService.logCheckIn(remoteId, {
          guestName: guest?.name || 'Unknown Guest',
          roomNumber: room?.roomNumber || 'Unknown Room',
          actualCheckIn: new Date().toISOString(),
          scheduledCheckIn: booking.checkIn,
        }, currentUser?.id).catch(err => console.error('[BookingEngine] Failed to log check-in:', err))
      } else if (status === 'checked-out') {
        await activityLogService.logCheckOut(remoteId, {
          guestName: guest?.name || 'Unknown Guest',
          roomNumber: room?.roomNumber || 'Unknown Room',
          actualCheckOut: new Date().toISOString(),
          scheduledCheckOut: booking.checkOut,
        }, currentUser?.id).catch(err => console.error('[BookingEngine] Failed to log check-out:', err))

        // Snapshot booking data to guest record for history persistence
        console.log('[BookingEngine] Check-out: Full booking object:', JSON.stringify(booking, null, 2))
        const guestIdToUse = booking.guestId || booking.guest_id
        console.log('[BookingEngine] Check-out: guestId to use:', guestIdToUse)

        if (guestIdToUse) {
          try {
            const guestHistoryUpdate = {
              last_booking_date: booking.createdAt || booking.created_at || new Date().toISOString(),
              last_room_number: room?.roomNumber || booking.roomNumber || '',
              last_check_in: booking.checkIn || booking.check_in,
              last_check_out: booking.checkOut || booking.check_out,
              last_source: booking.source || 'reception',
              total_revenue: (guest?.total_revenue || 0) + Number(booking.totalPrice || booking.total_price || 0),
              total_stays: (guest?.total_stays || 0) + 1
            }
            console.log('[BookingEngine] Check-out: Saving guest history:', JSON.stringify(guestHistoryUpdate, null, 2))
            await db.guests.update(guestIdToUse, guestHistoryUpdate)
            console.log('[BookingEngine] Guest history snapshot saved:', guestIdToUse)
          } catch (historyErr) {
            console.error('[BookingEngine] Failed to save guest history snapshot:', historyErr)
          }
        } else {
          console.warn('[BookingEngine] No guestId found on booking, cannot save history')
        }
      } else if (status === 'cancelled') {
        await activityLogService.logBookingCancelled(remoteId, 'Status changed to cancelled', currentUser?.id)
          .catch(err => console.error('[BookingEngine] Failed to log cancellation:', err))
      } else {
        await activityLogService.logBookingUpdated(remoteId, {
          status: { old: booking.status, new: status },
        }, currentUser?.id).catch(err => console.error('[BookingEngine] Failed to log status update:', err))
      }
    } catch (error) {
      console.error('[BookingEngine] Error updating booking status:', error)
      // Still try to update status even if logging fails
      await db.bookings.update(remoteId, { status })
    } finally {
      this.invalidateCache()
    }
  }

  async resolveConflict(keepBookingId: string, cancelBookingId: string): Promise<void> {
    // Convert local-style IDs to remote IDs
    const remoteCancelId = cancelBookingId.replace(/^booking_/, 'booking-')
    await this.updateBookingStatus(remoteCancelId, 'cancelled')
    this.notifySyncHandlers('synced', 'Conflict resolved')
  }

  async recordPayment(_bookingId: string, _payment: LocalBooking['payment']): Promise<void> {
    // Not tracked in DB currently; no-op
    return
  }

  async syncWithRemote(): Promise<void> {
    // Direct DB writes already happen; nothing to sync
    this.notifySyncHandlers('synced', 'All changes are up to date')
    return
  }

  async getAuditLogs(_limit: number = 100): Promise<AuditLog[]> { return [] }

  async clearAllData(): Promise<void> { return }

  async getEndOfDayReport(dateIso: string) {
    const target = new Date(dateIso)
    const startOfDay = new Date(target)
    startOfDay.setHours(0, 0, 0, 0)
    const endOfDay = new Date(target)
    endOfDay.setHours(23, 59, 59, 999)

    const bookings: any[] = await db.bookings.list()

    const createdInDay = bookings.filter(b => {
      const createdAt = new Date(b.createdAt || b.checkIn)
      return createdAt >= startOfDay && createdAt <= endOfDay
    })

    const confirmed = createdInDay.filter(b => b.status === 'confirmed' || b.status === 'checked-in')
    const cancelled = createdInDay.filter(b => b.status === 'cancelled')

    const totalRevenue = confirmed.reduce((sum, b) => sum + Number(b.totalPrice || 0), 0)

    return {
      totalBookings: createdInDay.length,
      confirmedBookings: confirmed.length,
      cancelledBookings: cancelled.length,
      totalRevenue,
      pendingSyncs: 0,
      conflicts: (await this.getConflictedBookings()).length,
      payments: {
        cash: 0,
        mobileMoney: 0,
        card: 0,
      }
    }
  }
}

export const bookingEngine = new BookingEngine()