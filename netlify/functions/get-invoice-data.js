import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import { tryAuth, handleCors, jsonResponse } from './_lib/auth.js';

// Constant-time token comparison. Hashing first sidesteps timingSafeEqual's
// equal-length requirement without leaking length information.
function safeTokenEqual(a, b) {
    if (!a || !b) return false;
    const ha = crypto.createHash('sha256').update(String(a)).digest();
    const hb = crypto.createHash('sha256').update(String(b)).digest();
    return crypto.timingSafeEqual(ha, hb);
}

// Never return guest access tokens in the payload (group responses would
// otherwise leak sibling bookings' tokens).
function stripToken(booking) {
    if (!booking) return booking;
    const { guest_token, ...rest } = booking;
    return rest;
}

export const handler = async (event) => {
    const corsResp = handleCors(event);
    if (corsResp) return corsResp;

    if (event.httpMethod !== 'GET') {
        return jsonResponse(405, { error: 'Method Not Allowed' });
    }

    const { invoiceNumber, bookingId, t: guestToken } = event.queryStringParameters || {};

    if (!invoiceNumber && !bookingId) {
        return jsonResponse(400, { error: 'Missing invoiceNumber or bookingId' });
    }

    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseKey) {
        console.error('Missing Supabase configuration');
        return jsonResponse(500, { error: 'Configuration error' });
    }
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Auth: staff JWT grants full access; otherwise the caller must present the
    // booking's guest_token (?t=...) which is compared after the booking loads.
    let isStaff = false;
    try {
        const ctx = await tryAuth(event);
        isStaff = !!(ctx && ctx.staff);
    } catch {
        isStaff = false;
    }
    if (!isStaff && !guestToken) {
        return jsonResponse(401, { error: 'Unauthorized' });
    }

    try {
        // Explicit joins only. Never `guests (*)` — that leaked commercial
        // history (total_revenue, total_stays, last_room_number, ...) to anyone
        // with the invoice link. The invoice needs just these guest fields.
        const SELECT = `
                *,
                guests (name, email, phone, address),
                rooms (room_number, room_types (name, base_price)),
                properties (room_number, room_types (name, base_price))
            `;

        let query = supabase.from('bookings').select(SELECT);
        if (bookingId) {
            query = query.eq('id', bookingId);
        } else {
            query = query.eq('invoice_number', invoiceNumber);
        }

        const { data: bookings, error } = await query;
        if (error) {
            console.error('[get-invoice-data] Database error:', error);
            throw error;
        }

        const mainBooking = bookings && bookings.length > 0 ? bookings[0] : null;

        if (!mainBooking) {
            return jsonResponse(404, { error: 'Invoice not found' });
        }

        // Guest path: constant-time check against the booking's own token.
        // Bookings without a token fail closed (run backfill-guest-tokens).
        if (!isStaff && !safeTokenEqual(guestToken, mainBooking.guest_token)) {
            return jsonResponse(401, { error: 'Unauthorized' });
        }

        // Detect Group Booking
        let groupId = mainBooking.group_id;
        let groupReference = mainBooking.group_reference;

        if (!groupId && mainBooking.special_requests) {
            const match = mainBooking.special_requests.match(/<!-- GROUP_DATA:(.*?) -->/);
            if (match) {
                try {
                    const groupData = JSON.parse(match[1]);
                    if (groupData.groupId) groupId = groupData.groupId;
                    if (groupData.groupReference) groupReference = groupData.groupReference;
                } catch (e) {
                    console.warn('[get-invoice-data] Failed to parse group metadata', e);
                }
            }
        }

        const responseData = {
            type: 'single',
            booking: stripToken(mainBooking),
            invoiceNumber: mainBooking.invoice_number || invoiceNumber
        };

        // If part of a group, fetch ALL group bookings. Access to the group is
        // already authorized above via the main booking (staff JWT or its token).
        if (groupId) {
            let siblingsQuery = supabase.from('bookings').select(SELECT);
            if (mainBooking.group_id) {
                siblingsQuery = siblingsQuery.eq('group_id', groupId);
            } else {
                siblingsQuery = siblingsQuery.ilike('special_requests', `%${groupId}%`);
            }

            const { data: siblings } = await siblingsQuery;

            if (siblings && siblings.length > 0) {
                responseData.type = 'group';
                responseData.bookings = siblings.map(stripToken);
                responseData.groupId = groupId;
                responseData.groupReference = groupReference;
                const primary = siblings.find(b =>
                    b.is_primary_booking ||
                    (b.special_requests && b.special_requests.includes('"isPrimaryBooking":true'))
                ) || siblings[0];
                responseData.primaryBooking = stripToken(primary);
            }
        }

        return jsonResponse(200, responseData);
    } catch (error) {
        console.error('[get-invoice-data] Internal error:', error);
        return jsonResponse(500, { error: 'Internal Server Error' });
    }
};
