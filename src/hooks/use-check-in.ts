import { useState } from 'react'
import { blink } from '@/blink/client'
import { toast } from 'sonner'
import { activityLogService } from '@/services/activity-log-service'
import { Booking, Room, Guest, PaymentSplit } from '@/types'
import { buildCheckInPaymentEvent, appendPaymentEvent } from '@/lib/payment-events'

// Define a standardized CheckInOptions interface
export interface CheckInOptions {
    booking: Booking | any // Support both strict Booking and loose objects from Calendar
    room: Room | any
    guest: Guest | any
    paymentMethod: string
    paymentSplits?: PaymentSplit[] // Multiple payment methods when guest splits payment
    checkInAmount?: number        // Total amount collected at check-in (for revenue attribution)
    discountAmount?: number       // Discount applied at check-in
    discountReason?: string       // Reason for discount
    user?: any // Current user for logging
}

export function useCheckIn() {
    const [isProcessing, setIsProcessing] = useState(false)

    const checkIn = async ({ booking, room, guest, paymentMethod, paymentSplits, checkInAmount, discountAmount, discountReason, user }: CheckInOptions) => {
        setIsProcessing(true)
        const db = (blink.db as any)

        try {
            // 1. Validation — fetch fresh room status from DB to avoid stale state
            if (room && booking.status !== 'checked-in') {
                let freshRoomStatus = room.status
                try {
                    const freshRoom = await db.rooms.get(room.id)
                    if (freshRoom) freshRoomStatus = freshRoom.status
                } catch {
                    // Fall back to passed-in room status
                }

                if (freshRoomStatus === 'occupied') {
                    // Double-check: is there actually another checked-in booking for this room?
                    // Room status can get stuck on 'occupied' if a prior check-out failed to update it.
                    const allBookings = await db.bookings.list({ limit: 500 })
                    const conflicting = allBookings.find((b: any) =>
                        b.status === 'checked-in' &&
                        (b.roomId === room.id || b.room_id === room.id) &&
                        b.id !== (booking.remoteId || booking.id || booking._id)
                    )
                    if (conflicting) {
                        throw new Error(`Cannot check in: Room ${room.roomNumber} is currently occupied. Check out the previous guest first.`)
                    }
                    // No conflicting booking found — room status is stale, auto-fix it
                    console.warn(`[useCheckIn] Room ${room.roomNumber} status was 'occupied' but no checked-in booking found — auto-correcting to 'available'`)
                    await db.rooms.update(room.id, { status: 'available' }).catch(() => {})
                }
                if (freshRoomStatus === 'maintenance') {
                    throw new Error(`Cannot check in: Room ${room.roomNumber} is under maintenance.`)
                }
                // 'cleaning' status is allowed — staff can check in after cleaning even if
                // housekeeping hasn't formally marked the room as available yet
            }

            // Extract and normalize booking ID - Calendar views use various ID formats
            let bookingId = booking.remoteId || booking.id || booking._id

            console.log('[useCheckIn] Raw booking object keys:', Object.keys(booking))
            console.log('[useCheckIn] Raw IDs - remoteId:', booking.remoteId, 'id:', booking.id, '_id:', booking._id)

            // Strip 'booking_' or 'booking-' prefix if present
            if (typeof bookingId === 'string') {
                if (bookingId.startsWith('booking_')) {
                    bookingId = bookingId.replace('booking_', '')
                } else if (bookingId.startsWith('booking-')) {
                    bookingId = bookingId.replace('booking-', '')
                }
            }

            const roomId = room?.id
            const guestId = guest?.id

            console.log('[useCheckIn] Starting check-in process:', { bookingId, roomId, guestContent: guest })

            // 2. Find the booking in the database first (handles ID format variations)
            let actualBooking = await db.bookings.get(bookingId).catch(() => null)

            console.log('[useCheckIn] Direct lookup result:', actualBooking ? 'Found' : 'Not found')

            // If not found, try with different ID formats
            if (!actualBooking) {
                console.log('[useCheckIn] Booking not found with ID:', bookingId, '- searching all bookings...')
                const allBookings = await db.bookings.list({ limit: 500 })
                console.log('[useCheckIn] Total bookings in database:', allBookings.length)
                console.log('[useCheckIn] First few booking IDs:', allBookings.slice(0, 5).map((b: any) => b.id))

                actualBooking = allBookings.find((b: any) =>
                    b.id === bookingId ||
                    b.id === `booking-${bookingId}` ||
                    b.id === `booking_${bookingId}` ||
                    b.id?.replace(/^booking[-_]/, '') === bookingId
                )

                if (actualBooking) {
                    bookingId = actualBooking.id
                    console.log('[useCheckIn] Found booking with actual ID:', bookingId)
                } else {
                    console.error('[useCheckIn] Could not find booking. Searched for:', bookingId)
                    throw new Error(`Booking not found: ${booking.remoteId || booking.id}`)
                }
            } else {
                // If booking was found directly, ensure we have the correct ID
                bookingId = actualBooking.id || bookingId
                console.log('[useCheckIn] Using resolved booking ID:', bookingId)
            }

            // 3. Calculate final amount if discount is applied
            const totalPrice = actualBooking?.totalPrice || booking.totalPrice || booking.amount || 0
            const finalAmount = discountAmount && discountAmount > 0
                ? Math.max(0, totalPrice - discountAmount)
                : totalPrice

            // 4. Update Booking with the resolved ID
            console.log('[useCheckIn] Attempting to update booking:', bookingId, 'with discount:', discountAmount)
            try {
                const staffName = user?.user_metadata?.full_name || user?.email || user?.name || 'Staff'
                const updateData: any = {
                    status: 'checked-in',
                    actualCheckIn: new Date().toISOString(),
                    paymentMethod: paymentMethod,
                    // Record who performed the check-in for revenue attribution
                    checkInBy: user?.id || '',
                    checkInByName: staffName,
                }

                // Build specialRequests: preserve existing content, append payment event + splits
                let existingReq = actualBooking?.special_requests || actualBooking?.specialRequests || ''

                // Store split payment data (no DB column needed)
                if (paymentSplits && paymentSplits.length > 1) {
                    existingReq = existingReq.replace(/\s*<!-- PAYMENT_SPLITS:.*? -->/g, '').trimEnd()
                    existingReq = existingReq + `\n\n<!-- PAYMENT_SPLITS:${JSON.stringify(paymentSplits)} -->`
                }

                // Append check-in payment event for revenue attribution
                const checkInEvent = buildCheckInPaymentEvent({
                    amount: checkInAmount ?? 0,
                    staffId: user?.id || '',
                    staffName,
                    method: paymentMethod,
                    splits: paymentSplits?.map(s => ({ method: s.method, amount: s.amount })),
                })
                if (checkInEvent) {
                    existingReq = appendPaymentEvent(existingReq, checkInEvent)
                }
                updateData.specialRequests = existingReq

                // Add discount fields if discount is applied
                if (discountAmount && discountAmount > 0) {
                    updateData.discountAmount = discountAmount
                    updateData.finalAmount = finalAmount
                    if (discountReason) {
                        updateData.discountReason = discountReason
                    }
                    if (user?.id) {
                        updateData.discountedBy = user.id
                    }
                }

                await db.bookings.update(bookingId, updateData)
                console.log('[useCheckIn] Booking updated successfully with discount:', discountAmount || 0)
            } catch (bookingUpdateError) {
                console.error('[useCheckIn] Booking update failed:', bookingUpdateError)
                throw bookingUpdateError
            }

            // 4. Update Room (with error handling - don't fail entire check-in if room update fails)
            if (roomId) {
                console.log('[useCheckIn] Attempting to update room:', roomId)
                try {
                    await db.rooms.update(roomId, { status: 'occupied' })
                    console.log('[useCheckIn] Room updated successfully')

                    // Log room status change
                    await activityLogService.log({
                        action: 'updated',
                        entityType: 'room',
                        entityId: roomId,
                        details: {
                            roomNumber: room.roomNumber,
                            previousStatus: 'available',
                            newStatus: 'occupied',
                            reason: 'guest_check_in',
                            guestName: guest.name || 'Unknown Guest',
                            bookingId: bookingId
                        },
                        userId: user?.id || 'system'
                    }).catch(logError => console.error('[useCheckIn] Failed to log room status change:', logError))

                    // Update property status if consistent
                    try {
                        const props = await db.properties.list({ limit: 1, where: { id: roomId } })
                        if (props.length > 0) {
                            await db.properties.update(roomId, { status: 'occupied' })
                        }
                    } catch (e) {
                        console.warn('[useCheckIn] Property status update skipped/failed', e)
                    }
                } catch (roomUpdateError) {
                    console.warn('[useCheckIn] Room update failed (continuing anyway):', roomUpdateError)
                }
            }

            // 5. Send Notifications
            try {
                const { sendCheckInNotification, sendManagerCheckInNotification } = await import('@/services/notifications')

                const bookingForNotification = {
                    id: bookingId,
                    checkIn: booking.checkIn || booking.dates?.checkIn,
                    checkOut: booking.checkOut || booking.dates?.checkOut,
                    actualCheckIn: new Date().toISOString(),
                    totalPrice: booking.totalPrice || booking.amount,
                    discountAmount: discountAmount || 0,
                    finalAmount: finalAmount
                }

                // Send notification to guest - use final amount (after discount)
                // Extract prior payment info from booking
                const priorAmountPaid = booking.amountPaid || 0
                const priorPaymentStatus = booking.paymentStatus || 'pending'
                const priorPayment = priorAmountPaid > 0 ? {
                    amountPaid: priorAmountPaid,
                    paymentStatus: priorPaymentStatus as 'full' | 'part' | 'pending'
                } : undefined

                await sendCheckInNotification(guest, room, bookingForNotification, {
                    method: paymentMethod,
                    amount: finalAmount
                }, priorPayment)
                console.log('✅ [useCheckIn] Guest notification sent')

                // Send notification to manager - include discount info in method field if applicable
                const paymentInfo = discountAmount && discountAmount > 0
                    ? `${paymentMethod} (Discount: ${discountAmount})`
                    : paymentMethod

                sendManagerCheckInNotification(
                    guest,
                    room,
                    bookingForNotification,
                    user?.email || user?.name || 'Staff',
                    {
                        method: paymentInfo,
                        amount: finalAmount
                    }
                ).catch(err => console.error('❌ [useCheckIn] Manager notification failed:', err))
                console.log('✅ [useCheckIn] Manager notification triggered')
            } catch (notificationError) {
                console.error('❌ [useCheckIn] Notification failed:', notificationError)
            }

            // 6. Log Activity
            try {
                await activityLogService.log({
                    action: 'checked_in',
                    entityType: 'booking',
                    entityId: bookingId,
                    details: {
                        guestName: guest.name || 'Unknown Guest',
                        roomNumber: room?.roomNumber || 'Unknown Room',
                        checkInDate: booking.checkIn || booking.dates?.checkIn,
                        actualCheckIn: new Date().toISOString(),
                        bookingId: bookingId,
                        paymentMethod,
                        paymentSplits: paymentSplits || null,
                        originalAmount: totalPrice,
                        discountAmount: discountAmount || 0,
                        discountReason: discountReason || null,
                        finalAmount: finalAmount
                    },
                    userId: user?.id || 'system'
                })
            } catch (logError) {
                console.error('[useCheckIn] Activity log failed:', logError)
            }

            toast.success(`Guest ${guest.name || 'Guest'} checked in successfully!`)
            return true

        } catch (error: any) {
            console.error('[useCheckIn] Failed:', error)
            toast.error(error.message || 'Failed to check in guest')
            return false
        } finally {
            setIsProcessing(false)
        }
    }

    return { checkIn, isProcessing }
}
