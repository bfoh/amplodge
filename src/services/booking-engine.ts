import { blink } from '@/blink/client'
import { activityLogService } from './activity-log-service'

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
    method: 'cash' | 'mobile_money' | 'card'
    status: 'pending' | 'completed' | 'failed'
    amount: number
    reference?: string
    paidAt?: string
  }
  notes?: string
  createdBy?: string
  createdAt: string
  updatedAt: string
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

    // Generate deterministic IDs to keep UI logic intact
    const timestamp = Date.now()
    const random = Math.random().toString(36).slice(2, 8)
    const suffix = `${timestamp}_${random}`
    const localId = `booking_${suffix}`
    const remoteId = `booking-${suffix}`

    // Create booking remotely
    const currentUser = await blink.auth.me().catch(() => null)
    console.log('[BookingEngine] Current user:', currentUser?.id || 'No user authenticated')

    const bookingPayload = {
      userId: currentUser?.id || null,
      guestId,
      roomId: room.id,
      checkIn: bookingData.dates.checkIn,
      checkOut: bookingData.dates.checkOut,
      status: bookingData.status,
      totalPrice: bookingData.amount ?? 0,
      numGuests: bookingData.numGuests ?? 1,
      specialRequests: bookingData.notes || ''
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

    // Ensure room remains available until check-in
    if (bookingData.status !== 'checked-in') {
      try {
        const currentRoom = await db.rooms.get(room.id).catch(() => room)
        if (currentRoom?.status === 'occupied') {
          await db.rooms.update(room.id, { status: 'available' })
          console.log('[BookingEngine] Reset room status to available for future stay')
        }

        // Also align related property status
        try {
          const propMatch = await db.properties.list({
            where: { roomNumber: room.roomNumber },
            limit: 1
          })
          const relatedProperty = propMatch?.[0]
          if (relatedProperty && relatedProperty.status === 'occupied') {
            await db.properties.update(relatedProperty.id, { status: 'active' })
            console.log('[BookingEngine] Reset property status to active for future stay')
          }
        } catch (propStatusError) {
          console.warn('[BookingEngine] Failed to sync property status:', propStatusError)
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
      notes: bookingData.notes,
      createdBy: bookingData.createdBy,
      createdAt: now,
      updatedAt: now,
      synced: true,
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

    console.log('[BookingEngine] Booking completed successfully:', localId)
    this.notifySyncHandlers('synced', 'Booking saved to database')
    return local
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

        // If not found, try alternative ID formats
        if (!booking) {
          const allBookings = await db.bookings.list({ limit: 500 })
          booking = allBookings.find((b: any) =>
            b.id === remoteId ||
            b.id === id ||
            b.id === id.replace(/^booking_/, 'booking-') ||
            b.id === id.replace(/^booking-/, 'booking_')
          )
          if (booking) {
            remoteId = booking.id
          }
        }

        if (booking) {
          // Get related guest and room info for logging
          if (booking.guestId) {
            guest = await db.guests.get(booking.guestId).catch(() => null)
          }
          if (booking.roomId) {
            room = await db.rooms.get(booking.roomId).catch(() => null)
          }
        }
      } catch (err) {
        console.warn('[BookingEngine] Could not fetch booking details for logging:', err)
      }

      // Perform the actual deletion
      await db.bookings.delete(remoteId)
      console.log('[BookingEngine] Successfully deleted booking:', remoteId)

      // Also delete any duplicate bookings with the same guest, room, and dates
      if (booking && guest && room) {
        try {
          const allBookings = await db.bookings.list({ limit: 500 })
          const allGuests = await db.guests.list({ limit: 500 })
          const allRooms = await db.rooms.list({ limit: 500 })

          const guestMap = new Map(allGuests.map((g: any) => [g.id, g]))
          const roomMap = new Map(allRooms.map((r: any) => [r.id, r]))

          const normalizeDate = (d: string) => d ? d.split('T')[0] : ''
          const targetCheckIn = normalizeDate(booking.checkIn)
          const targetCheckOut = normalizeDate(booking.checkOut)
          const targetGuestEmail = guest?.email?.toLowerCase() || ''
          const targetRoomNumber = room?.roomNumber || ''

          // Find all duplicate bookings
          const duplicateBookings = allBookings.filter((b: any) => {
            if (b.id === remoteId) return false // Already deleted

            const bGuest = guestMap.get(b.guestId)
            const bRoom = roomMap.get(b.roomId)
            const bCheckIn = normalizeDate(b.checkIn)
            const bCheckOut = normalizeDate(b.checkOut)
            const bGuestEmail = bGuest?.email?.toLowerCase() || ''
            const bRoomNumber = bRoom?.roomNumber || ''

            return (
              bGuestEmail === targetGuestEmail &&
              bRoomNumber === targetRoomNumber &&
              bCheckIn === targetCheckIn &&
              bCheckOut === targetCheckOut
            )
          })

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
      }

      // Log the deletion activity
      try {
        const currentUser = await blink.auth.me().catch(() => null)
        await activityLogService.log({
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
        })
      } catch (logError) {
        console.error('[BookingEngine] Failed to log booking deletion:', logError)
        // Don't fail the deletion if logging fails
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
      const payment = undefined // Not tracked in DB currently

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
        source: 'online',
        payment,
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
            await db.housekeepingTasks.create({
              id: `task_${Date.now()}_${Math.random().toString(36).substring(7)}`,
              userId: currentUser?.id || booking.userId || '',
              propertyId: room.id,
              roomNumber,
              status: 'pending',
              notes: `Checkout cleaning for ${guest?.name || 'Guest'}`,
              createdAt: new Date().toISOString()
            })
          } catch (e) {
            console.warn('[BookingEngine] Failed to auto-update room/task on check-out:', e)
          }
        }
      }

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