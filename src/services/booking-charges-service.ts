import { db, auth } from '@/lib/db'
import { supabase } from '@/lib/supabase'
import { BookingCharge, ChargeCategory } from '@/types'
import { inventoryService } from './inventory-service'

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
    inventoryId?: string
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

// db.get() returns a RAW snake_case row (unlike list(), which camelCases).
// deleteCharge/updateCharge read camelCase fields off it, which came back
// undefined — breaking the checked-out lookup (id=eq.undefined) and the
// inventory restock. Normalize the fields those paths depend on.
function normalizeChargeRow(row: any) {
    return {
        bookingId: row?.bookingId ?? row?.booking_id,
        inventoryId: row?.inventoryId ?? row?.inventory_id,
        unitPrice: Number(row?.unitPrice ?? row?.unit_price ?? 0),
        quantity: Number(row?.quantity ?? 0),
        paymentMethod: row?.paymentMethod ?? row?.payment_method,
        notes: row?.notes,
        description: row?.description,
    }
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

/**
 * The staff member to stamp on a charge: the staff row id, and their name.
 *
 * booking_charges.created_by holds a staff.id — NOT the auth user id — so an id
 * from auth.me() has to be translated to the staff row it belongs to before it
 * can be written. Callers may pass either, or nothing at all.
 *
 * The name goes on the charge alongside the id because the id no longer has a
 * foreign key behind it (see 20260915120000_employee_deletion.sql): an employee
 * can be deleted, and when they are, this is the only thing left that can tell
 * the revenue reports whose takings these were.
 */
async function resolveChargeStaff(given?: string | null): Promise<{ id: string; name: string; userId: string } | null> {
    const staffRows: any[] = await db.staff.listAll().catch(() => [])
    const byRowId = new Map(staffRows.filter((s) => s.id).map((s) => [s.id, s]))

    const asStaffRow = (id?: string | null): { id: string; name: string; userId: string } | null => {
        if (!id) return null
        const row = byRowId.get(id)                          // already a staff row id
            || staffRows.find((s) => (s.userId || s.user_id) === id)  // an auth id — translate
        if (!row?.id) return null
        return { id: row.id, name: (row.name || row.email || '').trim(), userId: row.userId || row.user_id || '' }
    }

    const fromCaller = asStaffRow(given)
    if (fromCaller) return fromCaller

    const me = await auth.me().catch(() => null)
    if (!me?.id) return null

    const fromSession = asStaffRow(me.id)
    if (fromSession) return fromSession

    // Signed in, but with no staff row to point the charge at. That is how
    // money ended up belonging to nobody: five accounts had taken GHS 23,795
    // between them without a row in the staff table. Give the account its row
    // rather than dropping the attribution — it is a real authenticated user,
    // and 'staff' is the least privilege a row can carry.
    try {
        const name = me.user_metadata?.full_name || me.user_metadata?.name || me.email?.split('@')[0] || 'Staff'
        const created: any = await db.staff.create({
            userId: me.id,
            name,
            email: me.email || '',
            role: 'staff',
        })
        console.warn('[BookingChargesService] Signed-in user had no staff row; created one so their takings are attributable:', created?.id)
        return created?.id ? { id: created.id, name, userId: me.id } : null
    } catch (err) {
        console.error('[BookingChargesService] Could not create a staff row for the signed-in user:', err)
        return null
    }
}

class BookingChargesService {

    /**
     * Get all charges for a booking
     */
    /**
     * Charges for several bookings in one request.
     *
     * A group invoice asked for them one booking at a time — seven rooms meant
     * seven round trips, each paying the proxy hop, before the PDF work even
     * started.
     */
    async getChargesForBookings(bookingIds: string[]): Promise<Map<string, BookingCharge[]>> {
        const byBooking = new Map<string, BookingCharge[]>()
        const ids = [...new Set(bookingIds.filter(Boolean))]
        if (ids.length === 0) return byBooking
        try {
            const rows = await db.bookingCharges.list({
                where: { bookingId: { in: ids } },
                orderBy: { createdAt: 'desc' },
            })
            for (const raw of (rows || [])) {
                const charge = enrichCharge(raw)
                const key = (charge as any).bookingId
                if (!byBooking.has(key)) byBooking.set(key, [])
                byBooking.get(key)!.push(charge)
            }
        } catch (error) {
            console.error('[BookingChargesService] Failed to fetch charges for bookings:', error)
        }
        return byBooking
    }

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
     * Fresh read straight from Supabase (via the proxy client), bypassing the
     * offline PouchDB cache. db.list() is cache-first and the cache only
     * re-warms on page load, so it goes stale after a mid-session write. Use
     * this right after add/edit/delete so the folio reflects the change without
     * a reload. Falls back to the cached read on any error.
     */
    async getChargesForBookingFresh(bookingId: string): Promise<BookingCharge[]> {
        try {
            const { data, error } = await supabase
                .from('booking_charges')
                .select('*')
                .eq('booking_id', bookingId)
                .order('created_at', { ascending: false })
                .limit(100)
            if (error) throw error
            return (data || []).map((r: any) => enrichCharge({
                id: r.id,
                bookingId: r.booking_id,
                description: r.description,
                category: r.category,
                quantity: r.quantity,
                unitPrice: r.unit_price,
                amount: r.amount,
                notes: r.notes,
                paymentMethod: r.payment_method,
                inventoryId: r.inventory_id,
                createdAt: r.created_at,
                createdBy: r.created_by,
                createdByName: r.created_by_name,
                createdByUserId: r.created_by_user_id,
            }))
        } catch (error) {
            console.error('[BookingChargesService] Fresh fetch failed, using cached:', error)
            return this.getChargesForBooking(bookingId)
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

            // Every charge must record who took the money. A caller that forgets
            // to pass it used to store null, and a charge belonging to nobody is
            // dropped from the revenue reports entirely while still showing on
            // the analytics page — the same money counted in one place and not
            // the other. Resolving the signed-in user here means no caller can
            // reintroduce that.
            const staffMember = await resolveChargeStaff(data.createdBy)
            const createdBy = staffMember?.id || null
            if (!createdBy) {
                // The database refuses a charge that names nobody (see
                // 20260822_require_staff_on_revenue.sql), so failing here with
                // something reception can act on beats a bare "failed to add".
                throw new Error(
                    'Cannot add this charge: your account is not set up as a staff member. ' +
                    'Ask an admin to add you under Employees, then try again.'
                )
            }

            const row = {
                bookingId: data.bookingId,
                description: data.description,
                category: data.category,
                quantity: data.quantity,
                unitPrice: data.unitPrice,
                amount: amount,
                notes: data.notes || null,
                paymentMethod: data.paymentMethod || 'cash',
                createdBy,
                createdByName: staffMember?.name || null,
                createdByUserId: staffMember?.userId || null,
                inventoryId: data.inventoryId || null,
                createdAt: new Date().toISOString()
            }

            let charge
            try {
                charge = await db.bookingCharges.create(row)
            } catch (err: any) {
                // created_by_name and created_by_user_id arrive with
                // 20260915120000_employee_deletion.sql. If the app is deployed
                // before the migration is run, PostgREST rejects the whole insert
                // for the unknown column — and a charge that cannot be saved is
                // money the hotel does not record. Losing the attribution detail
                // is survivable; losing the charge is not.
                const missingColumn = err?.code === 'PGRST204' ||
                    /created_by_name|created_by_user_id/.test(err?.message || '')
                if (!missingColumn) throw err
                console.warn('[BookingChargesService] booking_charges attribution columns not present yet; saving without them. Run the employee-deletion migration.')
                const { createdByName: _name, createdByUserId: _userId, ...withoutAttribution } = row
                charge = await db.bookingCharges.create(withoutAttribution)
            }

            // Trigger real-time inventory reduction if inventoryId is provided
            if (data.inventoryId) {
                try {
                    // Use staff info if provided, else try to get current user, else fallback to 'system'
                    let staffInfo = { id: 'system', name: 'System' }
                    if (createdBy) {
                        staffInfo = { id: createdBy, name: staffMember?.name || 'Staff' }
                    } else {
                        const me = await auth.me().catch(() => null)
                        if (me) {
                            staffInfo = { id: me.id, name: me.email?.split('@')[0] || 'Staff' }
                        }
                    }

                    await inventoryService.reduceStock(
                        data.inventoryId,
                        data.quantity,
                        staffInfo,
                        `Guest charge: ${data.description} (Booking ${data.bookingId})`
                    )
                } catch (invError) {
                    console.error('[BookingChargesService] Failed to reduce stock:', invError)
                }
            }

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
    async updateCharge(chargeId: string, data: UpdateChargeData, existing?: BookingCharge): Promise<BookingCharge | null> {
        try {
            // Prefer the caller-supplied row (from list(), reliable). get() is a
            // last resort — it has returned partial rows via the offline cache.
            const existingCharge = existing ?? await db.bookingCharges.get(chargeId)
            if (!existingCharge) throw new Error('Charge not found')
            const ex = normalizeChargeRow(existingCharge)

            // Best-effort checked-out guard.
            if (ex.bookingId) {
                const booking = await db.bookings.get(ex.bookingId)
                if (booking?.status === 'checked-out') {
                    throw new Error('Cannot edit charges for a checked-out booking')
                }
            }

            const quantity = data.quantity ?? ex.quantity
            const unitPrice = data.unitPrice ?? ex.unitPrice
            const amount = quantity * unitPrice

            const { paymentMethod: _pm, notes: _n, ...rest } = data  // strip from spread
            const updated = await db.bookingCharges.update(chargeId, {
                ...rest,
                notes: data.notes !== undefined ? (data.notes || null) : ex.notes,
                paymentMethod: data.paymentMethod || ex.paymentMethod || 'cash',
                amount,
                updatedAt: new Date().toISOString()
            })

            // Keep inventory in sync when the quantity of an inventory-linked
            // charge changes. Without this, editing a charge's quantity drifted
            // stock (deletion restocks, but edit did not). Non-blocking.
            const qtyDelta = quantity - ex.quantity
            if (ex.inventoryId && qtyDelta !== 0) {
                try {
                    const me = await auth.me().catch(() => null)
                    const staffInfo = me
                        ? { id: me.id, name: me.email?.split('@')[0] || 'Staff' }
                        : { id: 'system', name: 'System' }
                    if (qtyDelta > 0) {
                        await inventoryService.reduceStock(ex.inventoryId, qtyDelta, staffInfo, `Charge edit (+${qtyDelta}): ${ex.description}`)
                    } else {
                        await inventoryService.restockStock(ex.inventoryId, -qtyDelta, staffInfo, `Charge edit (${qtyDelta}): ${ex.description}`)
                    }
                } catch (invError) {
                    console.error('[BookingChargesService] Failed to adjust stock on charge edit:', invError)
                }
            }

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
    async deleteCharge(charge: BookingCharge | string): Promise<boolean> {
        try {
            // Prefer the already-loaded charge object (from list(), which
            // reliably carries bookingId/inventoryId). Only fall back to get()
            // for a bare id — get() has returned partial rows via the offline
            // cache, losing those fields and breaking the reversal.
            const chargeId = typeof charge === 'string' ? charge : charge.id
            const row = typeof charge === 'string' ? await db.bookingCharges.get(charge) : charge
            if (!row) throw new Error('Charge not found')
            const ex = normalizeChargeRow(row)

            // Best-effort checked-out guard (skipped if we can't resolve the booking).
            if (ex.bookingId) {
                const booking = await db.bookings.get(ex.bookingId)
                if (booking?.status === 'checked-out') {
                    throw new Error('Cannot delete charges for a checked-out booking')
                }
            }

            // Reverse inventory stock if linked
            if (ex.inventoryId && ex.quantity) {
                try {
                    const me = await auth.me().catch(() => null)
                    const staffInfo = me ? { id: me.id, name: me.email?.split('@')[0] || 'Staff' } : { id: 'system', name: 'System' }
                    await inventoryService.restockStock(
                        ex.inventoryId,
                        ex.quantity,
                        staffInfo,
                        `Reversed guest charge: ${ex.description} (Booking ${ex.bookingId})`
                    )
                } catch (invError) {
                    console.error('[BookingChargesService] Failed to restock stock during deletion:', invError)
                }
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
