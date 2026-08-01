import { useState } from 'react'
import { db } from '@/lib/db'
import { toast } from 'sonner'
import { activityLogService } from '@/services/activity-log-service'
import { housekeepingService } from '@/services/housekeeping-service'
import { Booking, Room, Guest } from '@/types'
import {
    createInvoiceData,
    generateInvoicePDF,
    sendInvoiceEmail,
    buildGuestInvoiceUrl,
} from '@/services/invoice-service'

// Unified check-out flow. Extracted from ReservationsPage.handleCheckOut (the
// canonical, guest-facing-notification-complete implementation) so the AI
// assistant and any future caller use the exact same logic — never the leaner
// bookingEngine.updateBookingStatus('checked-out') path, which skips invoice
// PDF generation and the checkout/invoice emails entirely.
export interface CheckOutOptions {
    booking: Booking | any
    room: Room | any
    guest: Guest | any
    roomTypeName?: string // e.g. roomTypeMap.get(room.roomTypeId)?.name — falls back to 'Standard Room'
    user?: any
}

export function useCheckOut() {
    const [isProcessing, setIsProcessing] = useState(false)

    const checkOut = async ({ booking, room, guest, roomTypeName, user }: CheckOutOptions): Promise<boolean> => {
        setIsProcessing(true)
        try {
            let housekeepingTaskCreated = false
            const staffName = user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email || 'Staff'
            const nowIso = new Date().toISOString()

            await db.bookings.update(booking.id, {
                status: 'checked-out',
                actualCheckOut: nowIso,
                checkOutBy: user?.id || '',
                checkOutByName: staffName,
            })

            if (room) {
                try {
                    await db.properties.update(room.id, { status: 'cleaning' })
                } catch (roomUpdateError) {
                    console.warn('[useCheckOut] Property update failed (continuing anyway):', roomUpdateError)
                }

                try {
                    await activityLogService.log({
                        action: 'updated',
                        entityType: 'property',
                        entityId: room.id,
                        details: {
                            roomNumber: room.roomNumber,
                            previousStatus: 'occupied',
                            newStatus: 'cleaning',
                            reason: 'guest_check_out',
                            guestName: guest?.name || 'Unknown Guest',
                            bookingId: booking.id,
                        },
                        userId: user?.id || 'system',
                    })
                } catch (logError) {
                    console.error('[useCheckOut] Failed to log room status change:', logError)
                }

                try {
                    const newTask = await housekeepingService.createCheckoutTask(booking, room, guest?.name || 'Guest', user)
                    if (newTask) housekeepingTaskCreated = true
                } catch (taskError) {
                    console.error('[useCheckOut] Failed to create housekeeping task:', taskError)
                }
            }

            // Guest history snapshot — folded in from bookingEngine.updateBookingStatus,
            // which had this but the page-level checkout flow didn't. Note: guest
            // objects from db.guests.* are camelCased (totalRevenue/totalStays) —
            // the original engine code read the snake_case DB column names off this
            // already-camelCased object and always got undefined, silently resetting
            // lifetime stats to just the current booking on every checkout.
            if (guest?.id) {
                try {
                    await db.guests.update(guest.id, {
                        last_booking_date: booking.createdAt || nowIso,
                        last_room_number: room?.roomNumber || booking.roomNumber || '',
                        last_check_in: booking.checkIn,
                        last_check_out: booking.checkOut,
                        last_source: booking.source || 'reception',
                        total_revenue: (guest?.totalRevenue || 0) + Number(booking.totalPrice || 0),
                        total_stays: (guest?.totalStays || 0) + 1,
                    })
                } catch (historyErr) {
                    console.error('[useCheckOut] Failed to save guest history snapshot:', historyErr)
                }
            }

            // Invoice generation + notifications (invoice total includes additional charges)
            if (guest && room) {
                try {
                    const bookingWithDetails = {
                        ...booking,
                        actualCheckOut: nowIso,
                        guest,
                        room: {
                            roomNumber: room.roomNumber,
                            roomType: roomTypeName || 'Standard Room',
                        },
                    }

                    const invoiceData = await createInvoiceData(bookingWithDetails, room)

                    try {
                        await db.bookings.update(booking.id, { invoiceNumber: invoiceData.invoiceNumber })
                    } catch (saveError) {
                        console.error('[useCheckOut] Failed to save invoice number to booking:', saveError)
                    }

                    const invoicePdf = await generateInvoicePDF(invoiceData)

                    try {
                        const { sendCheckOutNotification } = await import('@/services/notifications')
                        const bookingForNotification = {
                            id: booking.id,
                            checkIn: booking.checkIn,
                            checkOut: booking.checkOut,
                            actualCheckIn: booking.actualCheckIn,
                            actualCheckOut: nowIso,
                        }
                        const notificationInvoiceData = {
                            invoiceNumber: invoiceData.invoiceNumber,
                            totalAmount: invoiceData.charges.total,
                            downloadUrl: await buildGuestInvoiceUrl(booking.id, invoiceData.invoiceNumber),
                        }
                        await sendCheckOutNotification(guest, { id: room.id, roomNumber: room.roomNumber || 'N/A' }, bookingForNotification, notificationInvoiceData)
                    } catch (notificationError) {
                        console.error('[useCheckOut] Check-out notification error:', notificationError)
                    }

                    const emailResult = await sendInvoiceEmail(invoiceData, invoicePdf)
                    if (emailResult.success) {
                        toast.success(`Invoice sent to ${guest.email}`)
                    } else {
                        toast.error(`Invoice email failed: ${emailResult.error}`)
                    }
                } catch (invoiceError: any) {
                    console.error('[useCheckOut] Invoice generation failed:', invoiceError)
                    toast.error(`Invoice generation failed: ${invoiceError.message}`)
                }
            } else {
                console.warn('[useCheckOut] Missing guest or room data for invoice generation', {
                    hasGuest: !!guest,
                    hasRoom: !!room,
                })
                toast.error('Cannot generate invoice: Missing guest or room data')
            }

            try {
                await activityLogService.log({
                    action: 'checked_out',
                    entityType: 'booking',
                    entityId: booking.id,
                    details: {
                        guestName: guest?.name || 'Unknown Guest',
                        roomNumber: room?.roomNumber || 'Unknown Room',
                        checkOutDate: booking.checkOut,
                        actualCheckOut: nowIso,
                        bookingId: booking.id,
                    },
                    userId: user?.id || 'system',
                })
            } catch (logError) {
                console.error('[useCheckOut] Failed to log check-out activity:', logError)
            }

            const taskMessage = housekeepingTaskCreated ? ' Cleaning task created.' : ' (Cleaning task creation failed — please check console)'
            toast.success(`Guest ${guest?.name || 'Guest'} checked out successfully!${taskMessage}`)
            return true
        } catch (error: any) {
            console.error('[useCheckOut] Failed:', error)
            toast.error(error.message || 'Failed to check out guest')
            return false
        } finally {
            setIsProcessing(false)
        }
    }

    return { checkOut, isProcessing }
}
