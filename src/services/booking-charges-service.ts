import { blink } from '@/blink/client'
import { BookingCharge, ChargeCategory } from '@/types'

const db = blink.db as any

// Category display names for UI
export const CHARGE_CATEGORIES: Record<ChargeCategory, string> = {
    food_beverage: 'Food & Beverage',
    room_service: 'Room Service',
    minibar: 'Minibar',
    laundry: 'Laundry',
    phone_internet: 'Phone/Internet',
    parking: 'Parking',
    room_extension: 'Room Extension',
    other: 'Other'
}

export interface CreateChargeData {
    bookingId: string
    description: string
    category: ChargeCategory
    quantity: number
    unitPrice: number
    notes?: string
    createdBy?: string
}

export interface UpdateChargeData {
    description?: string
    category?: ChargeCategory
    quantity?: number
    unitPrice?: number
    notes?: string
}

class BookingChargesService {

    /**
     * Get all charges for a booking
     */
    async getChargesForBooking(bookingId: string): Promise<BookingCharge[]> {
        try {
            const charges = await db.bookingCharges.list({
                where: { bookingId },
                orderBy: { createdAt: 'desc' },
                limit: 100
            })
            return charges
        } catch (error) {
            console.error('[BookingChargesService] Error fetching charges:', error)
            return []
        }
    }

    /**
     * Get total amount of all charges for a booking
     */
    async getChargesTotal(bookingId: string): Promise<number> {
        const charges = await this.getChargesForBooking(bookingId)
        return charges.reduce((sum, charge) => sum + (charge.amount || 0), 0)
    }

    /**
     * Add a new charge to a booking
     */
    async addCharge(data: CreateChargeData): Promise<BookingCharge | null> {
        try {
            // Calculate amount from quantity and unit price
            const amount = data.quantity * data.unitPrice

            const charge = await db.bookingCharges.create({
                bookingId: data.bookingId,
                description: data.description,
                category: data.category,
                quantity: data.quantity,
                unitPrice: data.unitPrice,
                amount: amount,
                notes: data.notes || null,
                createdBy: data.createdBy || null,
                createdAt: new Date().toISOString()
            })

            console.log('[BookingChargesService] Charge added:', charge.id)
            return charge
        } catch (error) {
            console.error('[BookingChargesService] Error adding charge:', error)
            throw error
        }
    }

    /**
     * Update an existing charge (only if booking is not checked-out)
     */
    async updateCharge(chargeId: string, data: UpdateChargeData): Promise<BookingCharge | null> {
        try {
            // Get the current charge to check booking status
            const existingCharge = await db.bookingCharges.get(chargeId)
            if (!existingCharge) {
                throw new Error('Charge not found')
            }

            // Check if booking is checked-out (charges should be locked)
            const booking = await db.bookings.get(existingCharge.bookingId)
            if (booking?.status === 'checked-out') {
                throw new Error('Cannot edit charges for a checked-out booking')
            }

            // Recalculate amount if quantity or unitPrice changed
            const quantity = data.quantity ?? existingCharge.quantity
            const unitPrice = data.unitPrice ?? existingCharge.unitPrice
            const amount = quantity * unitPrice

            const updated = await db.bookingCharges.update(chargeId, {
                ...data,
                amount,
                updatedAt: new Date().toISOString()
            })

            console.log('[BookingChargesService] Charge updated:', chargeId)
            return updated
        } catch (error) {
            console.error('[BookingChargesService] Error updating charge:', error)
            throw error
        }
    }

    /**
     * Delete a charge (only if booking is not checked-out)
     */
    async deleteCharge(chargeId: string): Promise<boolean> {
        try {
            // Get the charge to check booking status
            const existingCharge = await db.bookingCharges.get(chargeId)
            if (!existingCharge) {
                throw new Error('Charge not found')
            }

            // Check if booking is checked-out
            const booking = await db.bookings.get(existingCharge.bookingId)
            if (booking?.status === 'checked-out') {
                throw new Error('Cannot delete charges for a checked-out booking')
            }

            await db.bookingCharges.delete(chargeId)
            console.log('[BookingChargesService] Charge deleted:', chargeId)
            return true
        } catch (error) {
            console.error('[BookingChargesService] Error deleting charge:', error)
            throw error
        }
    }

    /**
     * Get a summary of charges for checkout
     */
    async getCheckoutSummary(bookingId: string): Promise<{
        charges: BookingCharge[]
        totalCharges: number
        roomCost: number
        grandTotal: number
    }> {
        const charges = await this.getChargesForBooking(bookingId)
        const totalCharges = charges.reduce((sum, c) => sum + (c.amount || 0), 0)

        // Get booking to get room cost
        const booking = await db.bookings.get(bookingId)
        const roomCost = booking?.totalPrice || 0

        return {
            charges,
            totalCharges,
            roomCost,
            grandTotal: roomCost + totalCharges
        }
    }
}

export const bookingChargesService = new BookingChargesService()
