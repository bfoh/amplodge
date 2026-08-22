import { db, auth } from '@/lib/db'
import { bookingChargesService } from './booking-charges-service'

export interface ExtensionResult {
    success: boolean
    error?: string
    newCheckout?: string
    extensionCost?: number
    chargeId?: string
    roomChanged?: boolean
    newRoomId?: string
}

export interface RoomAvailability {
    available: boolean
    conflictingBookings?: Array<{
        id: string
        guestName: string
        checkIn: string
        checkOut: string
    }>
}

export interface AvailableRoom {
    id: string
    roomNumber: string
    roomType: string
    pricePerNight: number
}

class StayExtensionService {

    /**
     * Check if a room is available for the given date range
     * Excludes the current booking from the check
     */
    async checkRoomAvailability(
        roomId: string,
        startDate: string,
        endDate: string,
        excludeBookingId?: string
    ): Promise<RoomAvailability> {
        try {
            console.log('[StayExtension] Checking room availability:', { roomId, startDate, endDate })

            // Get all bookings for this room
            const allBookings = await db.bookings.list({
                where: { roomId },
                limit: 500
            })

            // Filter for confirmed or checked-in bookings that overlap with our dates
            const conflictingBookings = allBookings.filter((b: any) => {
                // Skip the current booking
                if (excludeBookingId && b.id === excludeBookingId) return false

                // Only consider active bookings
                if (!['confirmed', 'checked-in'].includes(b.status)) return false

                // Check for overlap
                const bookingStart = new Date(b.checkIn)
                const bookingEnd = new Date(b.checkOut)
                const requestStart = new Date(startDate)
                const requestEnd = new Date(endDate)

                // Overlap exists if: requestStart < bookingEnd AND requestEnd > bookingStart
                return requestStart < bookingEnd && requestEnd > bookingStart
            })

            if (conflictingBookings.length > 0) {
                // Get guest names for the conflicts
                const guestIds = conflictingBookings.map((b: any) => b.guestId)
                const guests = await db.guests.list({ where: { id: { in: guestIds } } })
                const guestMap = new Map(guests.map((g: any) => [g.id, g.name]))

                const conflicts = conflictingBookings.map((b: any) => ({
                    id: b.id,
                    guestName: guestMap.get(b.guestId) || 'Unknown Guest',
                    checkIn: b.checkIn,
                    checkOut: b.checkOut
                }))

                console.log('[StayExtension] Room has conflicts:', conflicts.length)
                return { available: false, conflictingBookings: conflicts }
            }

            console.log('[StayExtension] Room is available')
            return { available: true }

        } catch (error) {
            console.error('[StayExtension] Error checking availability:', error)
            return { available: false }
        }
    }

    /**
     * Get available rooms for a date range
     */
    async getAvailableRooms(startDate: string, endDate: string): Promise<AvailableRoom[]> {
        try {
            console.log('[StayExtension] Finding available rooms for:', { startDate, endDate })

            // Get all properties
            const allRooms = await db.properties.list({ limit: 100 })

            // Get all bookings that overlap with requested dates
            const allBookings = await db.bookings.listAll()

            const requestStart = new Date(startDate)
            const requestEnd = new Date(endDate)

            // Find rooms with conflicts
            const occupiedRoomIds = new Set<string>()

            for (const booking of allBookings) {
                if (!['confirmed', 'checked-in'].includes(booking.status)) continue

                const bookingStart = new Date(booking.checkIn)
                const bookingEnd = new Date(booking.checkOut)

                // Check for overlap
                if (requestStart < bookingEnd && requestEnd > bookingStart) {
                    occupiedRoomIds.add(booking.roomId)
                }
            }

            // Filter to available rooms
            const availableRooms = allRooms
                .filter((room: any) => !occupiedRoomIds.has(room.id))
                .map((room: any) => ({
                    id: room.id,
                    roomNumber: room.roomNumber,
                    roomType: room.roomType || 'Standard Room',
                    pricePerNight: room.pricePerNight || room.price || 0
                }))

            console.log('[StayExtension] Found available rooms:', availableRooms.length)
            return availableRooms

        } catch (error) {
            console.error('[StayExtension] Error getting available rooms:', error)
            return []
        }
    }

    /**
     * Calculate extension cost based on room rate and nights
     */
    async calculateExtensionCost(roomId: string, additionalNights: number): Promise<number> {
        try {
            const pricePerNight = await this.getRoomRate(roomId)
            return pricePerNight * additionalNights
        } catch (error) {
            console.error('[StayExtension] Error calculating cost:', error)
            return 0
        }
    }

    /**
     * Get room rate per night - looks up from room.price or roomType.basePrice
     */
    async getRoomRate(roomId: string): Promise<number> {
        try {
            console.log('[StayExtension] Getting room rate for roomId:', roomId)

            // First try to get from properties table
            const property = await db.properties.get(roomId)
            console.log('[StayExtension] Property data:', property)

            // Priority 1: look up roomType by roomTypeId and use basePrice (Source of Truth)
            if (property?.propertyTypeId || property?.roomTypeId) {
                const rtId = (property.propertyTypeId || property.roomTypeId) as string
                const roomType = await db.roomTypes.get(rtId)
                console.log('[StayExtension] RoomType data:', roomType)
                if (roomType?.basePrice && roomType.basePrice > 0) {
                    console.log('[StayExtension] Using roomType.basePrice:', roomType.basePrice)
                    return roomType.basePrice
                }
            }

            // Priority 2: If property has a direct price override and it's > 0, use it
            const price = property?.basePrice || property?.displayPrice || property?.pricePerNight || property?.price || 0
            if (price > 0) {
                console.log('[StayExtension] Using property price:', price)
                return price
            }


            console.warn('[StayExtension] Could not find valid price, returning 0')
            return 0
        } catch (error) {
            console.error('[StayExtension] Error getting room rate:', error)
            return 0
        }
    }

    /**
     * Execute the stay extension
     */
    async extendStay(
        bookingId: string,
        newCheckoutDate: string,
        newRoomId?: string,
        userId?: string,
        discountAmount?: number,
        discountReason?: string,
        paymentSplits?: Array<{ method: string; amount: number }>
    ): Promise<ExtensionResult> {
        try {
            console.log('[StayExtension] Extending stay:', { bookingId, newCheckoutDate, newRoomId })

            // Get current booking
            const booking = await db.bookings.get(bookingId)
            if (!booking) {
                return { success: false, error: 'Booking not found' }
            }

            if (booking.status !== 'checked-in') {
                return { success: false, error: 'Can only extend checked-in bookings' }
            }

            const currentCheckout = new Date(booking.checkOut)
            const newCheckout = new Date(newCheckoutDate)

            if (newCheckout <= currentCheckout) {
                return { success: false, error: 'New checkout must be after current checkout' }
            }

            // Calculate additional nights
            const additionalNights = Math.ceil(
                (newCheckout.getTime() - currentCheckout.getTime()) / (1000 * 60 * 60 * 24)
            )

            // Determine which room to use (current or new)
            const targetRoomId = newRoomId || booking.roomId

            // Check availability for the target room
            const availability = await this.checkRoomAvailability(
                targetRoomId,
                currentCheckout.toISOString(),
                newCheckoutDate,
                bookingId
            )

            if (!availability.available) {
                return {
                    success: false,
                    error: 'Room is not available for the extension period'
                }
            }

            // Calculate extension cost using target room's rate
            const extensionCost = await this.calculateExtensionCost(targetRoomId, additionalNights)

            // Update booking with new checkout date (and room if changed)
            const updateData: any = { checkOut: newCheckoutDate }
            if (newRoomId && newRoomId !== booking.roomId) {
                updateData.roomId = newRoomId
            }

            await db.bookings.update(bookingId, updateData)

            // Money collected for the extension, recorded ON the charge itself —
            // the same way every other paid charge records its method. It must
            // never become a charge row of its own: a payment is not a negative
            // sale, and booking it as one cancelled out the extension revenue.
            const extensionPaidTotal = (paymentSplits || []).reduce((s, p) => s + Math.max(0, Number(p.amount) || 0), 0)
            const extensionPrimaryMethod = (paymentSplits || [])
                .filter(p => Number(p.amount) > 0)
                .reduce((a, p) => (!a || Number(p.amount) > Number(a.amount) ? p : a), undefined as undefined | { method: string; amount: number })
                ?.method

            // Add extension charge
            const charge = await bookingChargesService.addCharge({
                bookingId,
                description: `Stay Extension (${additionalNights} night${additionalNights > 1 ? 's' : ''})`,
                category: 'room_extension',
                quantity: additionalNights,
                unitPrice: extensionCost / additionalNights,
                notes: `Extended from ${currentCheckout.toLocaleDateString()} to ${newCheckout.toLocaleDateString()}`,
                ...(extensionPrimaryMethod ? { paymentMethod: extensionPrimaryMethod } : {}),
                createdBy: userId
            })

            // Add extension discount charge if applicable
            let finalCost = extensionCost;
            if (discountAmount && discountAmount > 0) {
                await bookingChargesService.addCharge({
                    bookingId,
                    description: `Stay Extension Discount${discountReason ? ` - ${discountReason}` : ''}`,
                    category: 'other',
                    quantity: 1,
                    unitPrice: -Math.abs(discountAmount),
                    notes: `Discount applied during extension. Reason: ${discountReason || 'None'}`,
                    createdBy: userId
                })
                finalCost = Math.max(0, extensionCost - discountAmount)
            }

            // Roll what the guest paid for the extension into the booking's own
            // payment record, so the balance owed at check-out reflects it.
            if (extensionPaidTotal > 0) {
                try {
                    await this.recordExtensionPayment(bookingId, extensionPaidTotal)
                    console.log(`[StayExtension] Recorded extension payment of ${extensionPaidTotal}`)
                } catch (payErr) {
                    console.error('[StayExtension] Failed to record extension payment', payErr)
                }
            }

            console.log('[StayExtension] Extension completed:', {
                newCheckout: newCheckoutDate,
                additionalNights,
                extensionCost,
                chargeId: charge?.id,
                paymentsProcessed: paymentSplits?.length || 0
            })

            return {
                success: true,
                newCheckout: newCheckoutDate,
                extensionCost: finalCost,
                chargeId: charge?.id,
                roomChanged: !!newRoomId && newRoomId !== booking.roomId,
                newRoomId: newRoomId && newRoomId !== booking.roomId ? newRoomId : undefined
            }

        } catch (error: any) {
            console.error('[StayExtension] Extension failed:', error)
            return { success: false, error: error.message || 'Extension failed' }
        }
    }

    /**
     * Add money collected for an extension to the booking's PAYMENT_DATA total.
     *
     * The booking's amountPaid is what check-out subtracts from the bill, so an
     * extension payment has to land there or the guest is asked for it twice.
     * PAYMENT_EVENTS is deliberately not touched: it holds one event per stage
     * and appending would overwrite the check-in payment already recorded.
     */
    private async recordExtensionPayment(bookingId: string, amount: number): Promise<void> {
        const booking: any = await db.bookings.get(bookingId)
        const specialReq: string = booking?.special_requests || booking?.specialRequests || ''

        const match = specialReq.match(/<!-- PAYMENT_DATA:(.*?) -->/)
        let payment: any = { amountPaid: 0, paymentStatus: 'pending', perRoom: true }
        if (match?.[1]) {
            try {
                payment = { ...payment, ...JSON.parse(match[1]) }
            } catch { /* keep defaults */ }
        }

        const updated = {
            ...payment,
            amountPaid: Math.round(((Number(payment.amountPaid) || 0) + amount) * 100) / 100,
            perRoom: true,
        }
        const comment = `<!-- PAYMENT_DATA:${JSON.stringify(updated)} -->`
        const specialRequests = match
            ? specialReq.replace(/<!-- PAYMENT_DATA:.*? -->/, comment)
            : `${specialReq}\n\n${comment}`.trim()

        await db.bookings.update(bookingId, { specialRequests })
    }
}

export const stayExtensionService = new StayExtensionService()
