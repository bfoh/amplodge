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
    paymentMethod?: string  // 'cash' | 'mobile_money' | 'card'
    createdBy?: string
}

export interface UpdateChargeData {
    description?: string
    category?: ChargeCategory
    quantity?: number
    unitPrice?: number
    notes?: string
    paymentMethod?: string
}

// ─── Payment method helpers ────────────────────────────────────────────────────
// payment_method is stored as a dedicated column in the DB.
// Legacy: some old charges may have <!-- CHARGE_PAY:xxx --> encoded in notes.

function decodePaymentMethodFromNotes(rawNotes: string | undefined | null): { notes: string; paymentMethod: string } {
    if (!rawNotes) return { notes: '', paymentMethod: '' }
    const match = rawNotes.match(/<!-- CHARGE_PAY:(.*?) -->/)
    const paymentMethod = match?.[1] || ''
    const notes = rawNotes.replace(/\s*<!-- CHARGE_PAY:.*? -->\s*/, '').trim()
    return { notes, paymentMethod }
}

/** Enrich a raw DB charge row — reads paymentMethod from dedicated column, falls back to legacy notes encoding */
function enrichCharge(raw: any): BookingCharge {
    // Direct column takes priority (new charges)
    if (raw.paymentMethod) {
        const cleanNotes = raw.notes ? raw.notes.replace(/\s*<!-- CHARGE_PAY:.*? -->\s*/, '').trim() : undefined
        return { ...raw, notes: cleanNotes || undefined }
    }
    // Legacy fallback: decode from notes field
    const { notes, paymentMethod } = decodePaymentMethodFromNotes(raw.notes)
    return { ...raw, notes: notes || undefined, paymentMethod: paymentMethod || undefined }
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
            return (charges || []).map(enrichCharge)
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
            const amount = data.quantity * data.unitPrice

            const charge = await db.bookingCharges.create({
                bookingId: data.bookingId,
                description: data.description,
                category: data.category,
                quantity: data.quantity,
                unitPrice: data.unitPrice,
                amount: amount,
                notes: data.notes || null,
                paymentMethod: data.paymentMethod || 'cash',
                createdBy: data.createdBy || null,
                createdAt: new Date().toISOString()
            })

            console.log('[BookingChargesService] Charge added:', charge.id)
            return enrichCharge(charge)
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
            const existingCharge = await db.bookingCharges.get(chargeId)
            if (!existingCharge) throw new Error('Charge not found')

            const booking = await db.bookings.get(existingCharge.bookingId)
            if (booking?.status === 'checked-out') {
                throw new Error('Cannot edit charges for a checked-out booking')
            }

            const quantity = data.quantity ?? existingCharge.quantity
            const unitPrice = data.unitPrice ?? existingCharge.unitPrice
            const amount = quantity * unitPrice

            const { paymentMethod: _pm, notes: _n, ...rest } = data  // strip from spread
            const updated = await db.bookingCharges.update(chargeId, {
                ...rest,
                notes: data.notes !== undefined ? (data.notes || null) : existingCharge.notes,
                paymentMethod: data.paymentMethod || existingCharge.paymentMethod || 'cash',
                amount,
                updatedAt: new Date().toISOString()
            })

            console.log('[BookingChargesService] Charge updated:', chargeId)
            return enrichCharge(updated)
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
            const existingCharge = await db.bookingCharges.get(chargeId)
            if (!existingCharge) throw new Error('Charge not found')

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
