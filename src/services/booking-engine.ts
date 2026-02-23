import { blink, isOnline, syncQueue } from '../blink/client'
import { v4 as uuidv4 } from 'uuid'
import { activityLogService } from './activity-log-service'
import { sendBookingConfirmation } from './notifications'
import { createPreInvoiceData, generateInvoicePDF, blobToBase64 } from './invoice-service'

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
  createdBy?: string
  createdByName?: string
  checkInBy?: string
  checkInByName?: string
  checkOutBy?: string
  checkOutByName?: string
  createdAt: string
  updatedAt: string
  payment_method?: string

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
  subtotal?: number
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

  public onSyncStatusChange(handler: (status: 'syncing' | 'synced' | 'error', message?: string) => void) {
    this.syncHandlers.push(handler)
    return () => {
      this.syncHandlers = this.syncHandlers.filter(h => h !== handler)
    }
  }

  private notifySyncHandlers(status: 'syncing' | 'synced' | 'error', message?: string) {
    this.syncHandlers.forEach(h => h(status, message))
  }

  public getOnlineStatus(): boolean {
    if (typeof navigator === 'undefined') return true
    return navigator.onLine
  }

  // Create a booking directly in Blink DB and return LocalBooking-shaped object for UI compatibility
  async createBooking(bookingData: Omit<LocalBooking, '_id' | 'createdAt' | 'updatedAt' | 'synced'>): Promise<LocalBooking> {
    const db = blink.db as any

    console.log('[BookingEngine] Starting booking creation with data:', bookingData)

    // Check for duplicate bookings before creating
    const normalizedEmail = (bookingData.guest.email || '').trim().toLowerCase()

    // Get all existing bookings and guests to check for duplicates
    const [allExistingBookings, allGuests] = await Promise.all([
      db.bookings.list(),
      db.guests.list()
    ])

    // Create a map of guest IDs to guest data for quick lookup
    const guestMap = new Map(allGuests.map((g: any) => [g.id, g]))

    // Check for duplicates
    const isDuplicate = allExistingBookings.some((existing: any) => {
      const guest = existing.guestId ? guestMap.get(existing.guestId) : null
      return guest &&
        guest.email?.toLowerCase() === normalizedEmail &&
        existing.roomNumber === bookingData.roomNumber &&
        existing.checkIn === bookingData.dates.checkIn &&
        existing.checkOut === bookingData.dates.checkOut
    })

    if (isDuplicate) {
      console.log('[BookingEngine] Duplicate booking detected, skipping creation')
      throw new Error('A booking with the same guest, room, and dates already exists')
    }

    // Normalize/ensure guest (always resolve to an existing record)
    const guestName = (bookingData.guest.fullName || 'Guest').trim()
    const baseSlug = (normalizedEmail || guestName || 'guest').toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
    const computedGuestId = `guest-${baseSlug}`

    let guestId: string | undefined

    try {
      console.log('[BookingEngine] Resolving guest with email:', normalizedEmail, 'computed ID:', computedGuestId)

      // Try to find existing guest by email first
      let existing = null
      if (normalizedEmail) {
        const byEmail = await db.guests.list({ where: { email: normalizedEmail }, limit: 1 })
        existing = (byEmail as any[])?.[0]
        console.log('[BookingEngine] Found by email:', existing?.id)
      }

      // If not found by email, try by computed ID
      if (!existing) {
        const byId = await db.guests.list({ where: { id: computedGuestId }, limit: 1 })
        existing = (byId as any[])?.[0]
        console.log('[BookingEngine] Found by ID:', existing?.id)
      }

      if (existing) {
        guestId = existing.id
        console.log('[BookingEngine] Using existing guest:', guestId)
        // Try to update guest info if changed
        try {
          await db.guests.update(guestId, {
            name: guestName,
            email: normalizedEmail || existing.email,
            phone: bookingData.guest.phone || existing.phone || '',
            address: bookingData.guest.address || existing.address || '',
          })
          console.log('[BookingEngine] Updated guest info')
        } catch (updateErr: any) {
          console.warn('[BookingEngine] Guest update failed (non-critical):', updateErr?.message)
        }
      } else {
        // Create new guest (let Blink auto-generate the ID)
        const createPayload = {
          name: guestName,
          email: normalizedEmail || `${computedGuestId}@guest.local`,
          phone: bookingData.guest.phone || '',
          address: bookingData.guest.address || ''
        }
        console.log('[BookingEngine] Creating new guest:', createPayload)

        try {
          const created = await db.guests.create(createPayload)
          guestId = created.id
          console.log('[BookingEngine] Created guest:', guestId, created)
        } catch (createErr: any) {
          const msg = createErr?.message || ''
          const status = createErr?.status
          console.warn('[BookingEngine] Guest create failed:', status, msg)

          // If constraint violation or duplicate, try to find the existing guest
          if (status === 409 || msg.includes('Constraint violation') || msg.includes('UNIQUE')) {
            // Try to find existing guest by email
            const existing = await db.guests.list({ where: { email: normalizedEmail }, limit: 1 })
            if (existing?.[0]) {
              guestId = existing[0].id
              console.log('[BookingEngine] Found existing guest by email:', guestId)
            } else {
              throw createErr
            }
          } else {
            // For other errors, try fallback creation
            throw createErr
          }
        }
      }
    } catch (guestErr) {
      console.error('[BookingEngine] Guest resolution failed, attempting fallback:', guestErr)
    }

    // Final safety: if no guestId yet, create a unique timestamped guest
    if (!guestId) {
      const timestamp = Date.now()
      const random = Math.random().toString(36).slice(2, 8)
      const fallbackId = `guest-${timestamp}-${random}`
      const fallbackEmail = normalizedEmail || `${fallbackId}@guest.local`

      console.log('[BookingEngine] Creating fallback guest:', fallbackId)

      try {
        const created = await db.guests.create({
          name: guestName,
          email: fallbackEmail,
          phone: bookingData.guest.phone || '',
          address: bookingData.guest.address || ''
        })
        guestId = created.id
        console.log('[BookingEngine] Fallback guest created:', guestId)
      } catch (fallbackErr: any) {
        console.error('[BookingEngine] Fallback guest creation failed:', fallbackErr?.message)
        // Last resort: use the ID anyway and hope for the best
        guestId = fallbackId
      }
    }

    if (!guestId) {
      const error = new Error('Failed to resolve or create guest record')
      console.error('[BookingEngine] CRITICAL:', error.message)
      throw error
    }

    console.log('[BookingEngine] Final guest ID:', guestId)

    // Find room by roomNumber (fallback to Properties if missing, then auto-create Room)
    console.log('[BookingEngine] Looking for room number:', bookingData.roomNumber)
    const roomRes = await db.rooms.list({ where: { roomNumber: bookingData.roomNumber }, limit: 1 })
    let room = roomRes?.[0]

    if (!room) {
      console.warn('[BookingEngine] Room not found in rooms table for number:', bookingData.roomNumber, '— attempting to resolve from properties...')
      try {
        const propRes = await db.properties.list({ where: { roomNumber: bookingData.roomNumber }, limit: 1 })
        const prop = propRes?.[0]

        if (prop) {
          // Determine roomTypeId from property if available; otherwise try by roomType name
          let roomTypeId = prop.propertyTypeId
          if (!roomTypeId && bookingData.roomType) {
            try {
              const rt = await db.roomTypes.list({ where: { name: bookingData.roomType }, limit: 1 })
              roomTypeId = rt?.[0]?.id || roomTypeId
            } catch (_) { /* ignore */ }
          }

          if (!roomTypeId) {
            console.error('[BookingEngine] Unable to resolve roomTypeId for roomNumber:', bookingData.roomNumber)
            throw new Error('Unable to resolve room type for selected room')
          }

          // Create a room record so bookings can reference it (let Blink auto-generate the ID)
          const newRoomPayload = {
            roomNumber: bookingData.roomNumber,
            roomTypeId,
            status: 'available',
            price: Number(prop.basePrice || 0),
            imageUrls: ''
          }

          try {
            const created = await db.rooms.create(newRoomPayload)
            room = created
            console.log('[BookingEngine] Auto-created room from property:', room.id)
          } catch (createRoomErr: any) {
            const msg = createRoomErr?.message || ''
            const status = createRoomErr?.status
            console.warn('[BookingEngine] Room create failed:', status, msg)
            if (status === 409 || msg.includes('Constraint violation') || msg.includes('UNIQUE')) {
              // If room already exists, fetch it
              const retry = await db.rooms.list({ where: { roomNumber: bookingData.roomNumber }, limit: 1 })
              room = retry?.[0]
              if (!room) {
                throw createRoomErr
              }
            } else {
              throw createRoomErr
            }
          }
        }
      } catch (propErr) {
        console.error('[BookingEngine] Property resolution failed:', (propErr as any)?.message)
      }
    }

    if (!room) {
      const error = new Error(`Room not found for number: ${bookingData.roomNumber}`)
      console.error('[BookingEngine] CRITICAL:', error.message)
      throw error
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
    const localId = `booking_${suffix}`
    const remoteId = `booking-${suffix}`

    // Create booking remotely
    const currentUser = await blink.auth.me().catch(() => null)
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

    // Build payment tracking metadata
    const paymentTrackingData = {
      amountPaid: bookingData.amountPaid ?? 0,
      paymentStatus: bookingData.paymentStatus ?? 'pending'
    }
    const hasPaymentTracking = paymentTrackingData.amountPaid > 0 || paymentTrackingData.paymentStatus !== 'pending'

    const specialRequests = (bookingData.notes || '') +
      (hasGroupData ? `\n\n<!-- GROUP_DATA:${JSON.stringify(groupData)} -->` : '') +
      (hasPaymentTracking ? `\n\n<!-- PAYMENT_DATA:${JSON.stringify(paymentTrackingData)} -->` : '')

    console.log('[BookingEngine Debug] Generated specialRequests length:', specialRequests.length)
    if (hasGroupData) {
      console.log('[BookingEngine Debug] Attached Group Data:', JSON.stringify(groupData, null, 2))
    }
    if (hasPaymentTracking) {
      console.log('[BookingEngine Debug] Attached Payment Data:', JSON.stringify(paymentTrackingData, null, 2))
    }

    const bookingPayload = {
      userId: currentUser?.id || null,
      guestId,
      roomId: room.id,
      checkIn: bookingData.dates.checkIn,
      checkOut: bookingData.dates.checkOut,
      status: bookingData.status,
      source: bookingData.source,
      totalPrice: bookingData.amount ?? 0,
      numGuests: bookingData.numGuests ?? 1,
      payment_method: bookingData.payment_method,
      createdBy: bookingData.createdBy || currentUser?.id || null,
      specialRequests: specialRequests
    }

    console.log('[BookingEngine] Creating booking with payload:', JSON.stringify(bookingPayload, null, 2))

    try {
      const created = await db.bookings.create(bookingPayload)
      console.log('[BookingEngine] Booking created successfully:', JSON.stringify(created, null, 2))
    } catch (bookingErr: any) {
      const msg = bookingErr?.message || ''
      const status = bookingErr?.status
      console.error('[BookingEngine] Booking creation failed:', status, msg)
      console.error('[BookingEngine] Full error object:', JSON.stringify(bookingErr, null, 2))
      console.error('[BookingEngine] Error stack:', bookingErr?.stack)

      // Only ignore if it's truly a duplicate
      if (status === 409 || msg.includes('Constraint violation')) {
        console.warn('[BookingEngine] Booking already exists (duplicate), continuing...')
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
    if (bookingData.status !== 'checked-in') {
      try {
        const currentRoom = await db.rooms.get(room.id).catch(() => room)

        // Only reset status if it's 'cleaning' or already 'available' (to ensure consistency)
        // CRITICAL: Do NOT reset 'occupied' or 'maintenance' status.
        if (currentRoom?.status === 'cleaning' || currentRoom?.status === 'available') {
          if (currentRoom?.status !== 'available') {
            await db.rooms.update(room.id, { status: 'available' })
            console.log('[BookingEngine] Reset room status from', currentRoom.status, 'to available for new booking')
          }

          // Also align related property status
          try {
            const propMatch = await db.properties.list({
              where: { roomNumber: room.roomNumber },
              limit: 1
            })
            const relatedProperty = propMatch?.[0]
            if (relatedProperty && (relatedProperty.status === 'cleaning' || relatedProperty.status === 'active')) {
              if (relatedProperty.status !== 'active') {
                await db.properties.update(relatedProperty.id, { status: 'active' })
                console.log('[BookingEngine] Reset property status to active')
              }
            }
          } catch (propStatusError) {
            console.warn('[BookingEngine] Failed to sync property status:', propStatusError)
          }
        } else {
          console.log(`[BookingEngine] Skipping room status reset because currently: ${currentRoom?.status}`)
        }
      } catch (roomStatusError) {
        console.warn('[BookingEngine] Failed to reset room status:', roomStatusError)
      }
    }

    const now = new Date().toISOString()
    console.log('[BookingEngine] Creating booking with createdBy:', bookingData.createdBy)
    console.log('[BookingEngine] Full bookingData received:', JSON.stringify(bookingData, null, 2))

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
      payment_method: bookingData.payment_method,
      additionalCharges: bookingData.additionalCharges,
      discount: bookingData.discount,
      subtotal: bookingData.subtotal
    }
    console.log('[BookingEngine] Local booking created with createdBy:', local.createdBy)
    console.log('[BookingEngine] Full local booking object:', JSON.stringify(local, null, 2))

    // Log activity
    await activityLogService.logBookingCreated(remoteId, {
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

    // Update Guest record with latest booking details for persistence
    // This ensures that even if the booking is deleted (and guest is kept), we know the source
    if (guestId) {
      try {
        const guestUpdatePayload = {
          last_booking_date: now,
          last_room_number: local.roomNumber,
          last_check_in: local.dates.checkIn,
          last_check_out: local.dates.checkOut,
          last_source: local.source || 'reception',
          last_created_by: local.createdBy,
          last_created_by_name: local.createdByName,
          total_revenue: (await db.guests.get(guestId).then((g: any) => g.total_revenue || 0).catch(() => 0)) + Number(local.amount || 0),
          total_stays: (await db.guests.get(guestId).then((g: any) => g.total_stays || 0).catch(() => 0)) + 1,
          updatedAt: now
        }

        console.log('[BookingEngine] Persisting booking source to guest record:', guestId, guestUpdatePayload)
        await db.guests.update(guestId, guestUpdatePayload)
      } catch (guestUpdateErr) {
        console.warn('[BookingEngine] Failed to persist booking source to guest record:', guestUpdateErr)
      }
    }

    // Send Booking Confirmation Email
    // Only send if it's a confirmed/reserved booking (not a draft or cancelled one)
    if (['confirmed', 'reserved'].includes(local.status)) {
      // Construct booking object compatible with the notification service
      const bookingForEmail = {
        id: local._id, // Use local ID for reference
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

      console.log(`[BookingEngine] Attempting to send confirmation email for booking ${local._id}...`)

      // Generate Pre-Invoice PDF
      let attachments: any[] | undefined = undefined
      try {
        console.log('[BookingEngine] Generating pre-invoice PDF for attachment...')
        const bookingWithDetails = {
          id: local._id,
          guestId: guestId!,
          roomId: room.id,
          checkIn: local.dates.checkIn,
          checkOut: local.dates.checkOut,
          status: local.status,
          totalPrice: local.amount,
          numGuests: local.numGuests,
          amountPaid: local.amountPaid || 0,
          paymentStatus: local.paymentStatus || 'pending',
          specialRequests: bookingPayload.specialRequests,
          guest: {
            name: local.guest.fullName,
            email: local.guest.email,
            phone: local.guest.phone,
            address: local.guest.address
          },
          room: {
            roomNumber: local.roomNumber,
            roomType: local.roomType
          },
          createdAt: local.createdAt
        }

        // Ensure we have minimal room details even if room object is partial
        const roomDetails = {
          roomNumber: local.roomNumber,
          roomType: local.roomType
        }

        const invoiceData = await createPreInvoiceData(bookingWithDetails, roomDetails)
        const pdfBlob = await generateInvoicePDF(invoiceData)
        const base64Pdf = await blobToBase64(pdfBlob)

        // Extract base64 part (remove data:application/pdf;base64, prefix if present)
        const content = base64Pdf.includes(',') ? base64Pdf.split(',')[1] : base64Pdf

        attachments = [{
          filename: `Pre-Invoice-${invoiceData.invoiceNumber}.pdf`,
          content: content,
          contentType: 'application/pdf'
        }]
        console.log('[BookingEngine] Pre-invoice PDF generated and attached')
      } catch (pdfError) {
        console.error('[BookingEngine] Failed to generate pre-invoice PDF:', pdfError)
        // Proceed without attachment
      }

      // Fire and forget - don't await the result to block UI
      const paymentInfo = (local.amountPaid || local.paymentStatus) ? {
        amountPaid: local.amountPaid || 0,
        paymentStatus: (local.paymentStatus || 'pending') as 'full' | 'part' | 'pending',
        totalPrice: local.amount || 0
      } : undefined

      sendBookingConfirmation(guestForEmail, roomForEmail, bookingForEmail, attachments, paymentInfo)
        .then(() => console.log(`[BookingEngine] Confirmation email request sent for ${local._id}`))
        .catch(err => console.error('[BookingEngine] Failed to send confirmation email:', err))
    }

    console.log('[BookingEngine] Booking completed successfully:', localId)
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
    const db = blink.db as any
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
    let primaryBooking = groupBookings.find((b: any) => {
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
    const db = blink.db as any
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

    // If we're removing the primary booking, transfer metadata to another booking
    if (isPrimary && groupBookings.length > 0) {
      const newPrimary = groupBookings[0]
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
      const db = blink.db as any
      console.log('[BookingEngine] Delete booking requested for:', id)

      // Convert local-style ID to remote ID format if needed
      let remoteId = id
      if (id.startsWith('booking_')) {
        remoteId = id.replace(/^booking_/, 'booking-')
      }

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
            room = await db.rooms.get(booking.roomId).catch(() => null)
          }
        }
      } catch (err: any) {
        // If it's our validation error, propagate it!
        if (err.message && err.message.includes('Cannot delete')) {
          throw err
        }
        console.warn('[BookingEngine] Could not fetch booking details for logging:', err)
      }

      // Perform the actual deletion
      console.log('[BookingEngine] Attempting to delete booking:', remoteId)
      try {
        await db.bookings.delete(remoteId)
        console.log('[BookingEngine] Delete command executed for:', remoteId)

        // Verify the booking was actually deleted
        const verifyDeleted = await db.bookings.get(remoteId).catch(() => null)
        if (verifyDeleted) {
          console.error('[BookingEngine] WARNING: Booking still exists after deletion attempt!', remoteId)
          throw new Error(`Failed to delete booking ${remoteId} - booking still exists in database`)
        }
        console.log('[BookingEngine] Verified booking deletion successful:', remoteId)
      } catch (deleteError: any) {
        console.error('[BookingEngine] Delete operation failed:', deleteError)
        console.error('[BookingEngine] Delete error details:', {
          message: deleteError?.message,
          status: deleteError?.status,
          code: deleteError?.code,
          stack: deleteError?.stack
        })
        throw deleteError
      }

      // Also delete any duplicate bookings with the same guest, room, and dates
      // Run this even if guest/room lookup didn't work - try to match by IDs
      try {
        const allBookings = await db.bookings.list({ limit: 500 })
        const allGuests = await db.guests.list({ limit: 500 })
        const allRooms = await db.rooms.list({ limit: 500 })

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
          const bGuest = guestMap.get(b.guestId)
          const bRoom = roomMap.get(b.roomId)
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
      const currentUser = await blink.auth.me().catch(() => null)
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
                last_created_by_name: booking.created_by_name || booking.createdByName || '',
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

      this.notifySyncHandlers('synced', 'Booking deleted successfully')
    } catch (error) {
      console.error('[BookingEngine] Failed to delete booking:', error)
      this.notifySyncHandlers('error', 'Failed to delete booking')
      throw error
    }
  }

  // Map DB bookings to LocalBooking for Admin views
  async getAllBookings(): Promise<LocalBooking[]> {
    const db = blink.db as any
    const [bookings, rooms, guests] = await Promise.all([
      db.bookings.list(),
      db.rooms.list(),
      db.guests.list(),
    ])

    const roomMap = new Map(rooms.map((r: any) => [r.id, r]))
    const guestMap = new Map(guests.map((g: any) => [g.id, g]))

    const mappedBookings = bookings.map((b: any) => {
      const room = roomMap.get(b.roomId)
      const guest = guestMap.get(b.guestId)
      const remoteId: string = b.id || ''
      const localId = `booking_${remoteId.replace(/^booking-/, '')}`
      const createdAt = b.createdAt || b.checkIn
      // Map payment data if available
      const payment = b.paymentMethod || b.payment_method ? {
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

      const local: LocalBooking = {
        _id: localId,
        remoteId: remoteId || localId,
        guest: {
          fullName: guest?.name || 'Guest',
          email: guest?.email || '',
          phone: guest?.phone || '',
          address: guest?.address || '',
        },
        roomType: room?.roomTypeId || '',
        roomNumber: room?.roomNumber || '',
        dates: {
          checkIn: b.checkIn,
          checkOut: b.checkOut,
        },
        numGuests: b.numGuests || 1,
        amount: Number(b.totalPrice || 0),
        status: b.status || 'confirmed',
        source: b.source || 'online',
        payment: payment ? {
          ...payment,
          amount: Number(b.totalPrice || 0)
        } : undefined,
        amountPaid,
        paymentStatus,
        payment_method: b.paymentMethod || b.payment_method,
        createdAt,
        updatedAt: b.updatedAt || createdAt,
        synced: true,
      }
      return local
    })

    // Deduplicate bookings based on unique combination of guest email, room number, and dates
    // When duplicates with different statuses exist, keep the one with the most advanced status
    const statusPriority: Record<string, number> = {
      'checked-out': 5,
      'checked-in': 4,
      'confirmed': 3,
      'reserved': 2,
      'cancelled': 1
    }

    const uniqueBookings = mappedBookings.reduce((acc: LocalBooking[], current: LocalBooking) => {
      // Find if there's already a booking with same guest, room, and dates
      const duplicateIndex = acc.findIndex(booking =>
        booking.guest.email === current.guest.email &&
        booking.roomNumber === current.roomNumber &&
        booking.dates.checkIn === current.dates.checkIn &&
        booking.dates.checkOut === current.dates.checkOut
      )

      if (duplicateIndex >= 0) {
        const existing = acc[duplicateIndex]
        const existingPriority = statusPriority[existing.status] || 0
        const currentPriority = statusPriority[current.status] || 0

        // Keep the one with higher priority status (more advanced in booking lifecycle)
        if (currentPriority > existingPriority) {
          console.log(`[BookingEngine] Replacing duplicate booking ${existing._id} (status: ${existing.status}) with ${current._id} (status: ${current.status})`)
          acc[duplicateIndex] = current
        } else {
          console.log(`[BookingEngine] Removed duplicate booking for ${current.guest.email} in room ${current.roomNumber} (keeping status: ${existing.status})`)
        }
      } else {
        acc.push(current)
      }

      return acc
    }, [])

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
    const db = blink.db as any

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
      const room = booking.roomId ? await db.rooms.get(booking.roomId).catch(() => null) : null
      const currentUser = await blink.auth.me().catch(() => null)

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

        // Auto-update room/property status
        if (room) {
          try {
            await db.rooms.update(room.id, { status: 'occupied' })
            const props = await db.properties.list({ limit: 500 })
            const prop = props.find((p: any) => p.id === room.id)
            if (prop) {
              await db.properties.update(prop.id, { status: 'occupied' })
            }
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
            await db.rooms.update(room.id, { status: 'cleaning' })
            const props = await db.properties.list({ limit: 500 })
            const prop = props.find((p: any) => p.id === room.id)
            if (prop) {
              await db.properties.update(prop.id, { status: 'cleaning' })
            }

            // Create housekeeping task
            const roomNumber = prop?.roomNumber || room?.roomNumber || prop?.name || 'N/A'
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
              last_created_by_name: booking.created_by_name || booking.createdByName || '',
              last_check_in_by_name: booking.checkInByName || booking.check_in_by_name || '',
              last_check_out_by_name: currentUser?.user_metadata?.full_name || currentUser?.user_metadata?.name || currentUser?.email || '',
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
    const db = blink.db as any
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