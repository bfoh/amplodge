
import { createClient } from '@supabase/supabase-js';

export const handler = async (event, context) => {
    // CORS headers
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, OPTIONS'
    };

    // Handle preflight requests
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    if (event.httpMethod !== 'GET') {
        return { statusCode: 405, headers, body: 'Method Not Allowed' };
    }

    const { invoiceNumber, bookingId } = event.queryStringParameters;

    if (!invoiceNumber && !bookingId) {
        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Missing invoiceNumber or bookingId' })
        };
    }

    // Initialize Supabase Admin Client
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
        console.error('Missing Supabase configuration');
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'Configuration error' }) };
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    try {
        console.log(`[get-invoice-data] Fetching for invoice: ${invoiceNumber} / booking: ${bookingId}`);

        let query = supabase
            .from('bookings')
            .select(`
                *,
                guests (*),
                rooms (*, room_types (*))
            `);

        // Filter by invoice number or booking ID
        // Note: 'invoice_number' column vs 'invoiceNumber' param
        if (bookingId) {
            query = query.eq('id', bookingId);
        } else if (invoiceNumber) {
            // Try matching invoice_number column first
            // If that fails, we might need to search special_requests or other logic
            // providing a flexible OR search if needed, but strict is better for now
            query = query.eq('invoice_number', invoiceNumber);
        }

        const { data: bookings, error } = await query;

        if (error) {
            console.error('[get-invoice-data] Database error:', error);
            throw error;
        }

        let mainBooking = bookings && bookings.length > 0 ? bookings[0] : null;

        // Fallback: If not found by invoice_number column, try finding by ID if invoiceNumber looks like a UUID
        if (!mainBooking && invoiceNumber && !bookingId) {
            const { data: fallbackBookings } = await supabase
                .from('bookings')
                .select(`*, guests (*), rooms (*, room_types (*))`)
                .eq('id', invoiceNumber);

            if (fallbackBookings && fallbackBookings.length > 0) {
                mainBooking = fallbackBookings[0];
                console.log('[get-invoice-data] Found booking by treating invoiceNumber as ID');
            }
        }

        if (!mainBooking) {
            return {
                statusCode: 404,
                headers,
                body: JSON.stringify({ error: 'Invoice not found' })
            };
        }

        // Detect Group Booking
        // Check for 'group_id' column or metadata in special_requests
        let groupId = mainBooking.group_id; // If column exists
        let groupReference = mainBooking.group_reference;

        // Parse special_requests if columns are missing/empty
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

        let responseData = {
            type: 'single',
            booking: mainBooking,
            // Helper to determine if we found it via ID or invoice_number, passes back logical invoice number
            invoiceNumber: mainBooking.invoice_number || invoiceNumber
        };

        // If part of a group, fetch ALL group bookings
        if (groupId) {
            console.log(`[get-invoice-data] Detected group ${groupId}, fetching siblings...`);

            // We need to query again to get all siblings
            // If group_id is a real column:
            const { data: groupBookings, error: groupError } = await supabase
                .from('bookings')
                .select(`*, guests (*), rooms (*, room_types (*))`)
                .eq(mainBooking.group_id ? 'group_id' : 'id', 'NEVER_MATCH_PLACEHOLDER') // Placeholder to setup query structure
                .or(`group_id.eq.${groupId},special_requests.ilike.%${groupId}%`); // Clean search approach

            // More robust group search:
            // If we have a real column 'group_id', use it. 
            // If not, we have to rely on the metadata search which is tricky in restricted SQL.
            // Using a simpler approach: 
            let siblingsQuery = supabase.from('bookings').select(`*, guests (*), rooms (*, room_types (*))`);

            if (mainBooking.group_id) {
                siblingsQuery = siblingsQuery.eq('group_id', groupId);
            } else {
                // Fallback: search special_requests for the groupId string
                // This is less efficient but necessary if no column
                siblingsQuery = siblingsQuery.ilike('special_requests', `%${groupId}%`);
            }

            const { data: siblings, error: siblingsError } = await siblingsQuery;

            if (siblings && siblings.length > 0) {
                responseData.type = 'group';
                responseData.bookings = siblings;
                responseData.groupId = groupId;
                responseData.groupReference = groupReference;
                // Identify billing contact (usually on primary booking)
                const primary = siblings.find(b => {
                    const isPrimary = b.is_primary_booking || (b.special_requests && b.special_requests.includes('"isPrimaryBooking":true'));
                    return isPrimary;
                }) || siblings[0];

                responseData.primaryBooking = primary;
            }
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify(responseData)
        };

    } catch (error) {
        console.error('[get-invoice-data] Internal error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Internal Server Error' })
        };
    }
};
