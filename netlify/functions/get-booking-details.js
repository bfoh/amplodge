
import { createClient } from '@supabase/supabase-js';

export const handler = async (event, context) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, OPTIONS'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    if (event.httpMethod !== 'GET') {
        return { statusCode: 405, headers, body: 'Method Not Allowed' };
    }

    const { bookingId } = event.queryStringParameters;

    if (!bookingId) {
        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Missing bookingId' })
        };
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'Configuration error' }) };
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    try {
        console.log('[get-booking-details] Fetching booking:', bookingId);

        // Join with rooms and room_types to get room name
        // Supabase join syntax: select('*, rooms(*, room_types(*))')
        // We only need specific fields
        const { data: booking, error } = await supabase
            .from('bookings')
            .select(`
        check_in,
        check_out,
        guests ( name ),
        rooms (
          room_types ( name )
        )
      `)
            .eq('id', bookingId)
            .single();

        console.log('[get-booking-details] Query result:', { booking, error });

        if (error || !booking) {
            console.log('[get-booking-details] Booking not found. Error:', error);
            return { statusCode: 404, headers, body: JSON.stringify({ error: 'Booking not found' }) };
        }

        // Check if review already exists
        const { data: review } = await supabase
            .from('reviews')
            .select('id')
            .eq('booking_id', bookingId)
            .single();

        if (review) {
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    alreadyReviewed: true,
                    guestName: booking.guests?.name
                })
            };
        }

        // Flatten response
        const safeData = {
            checkIn: booking.check_in,
            checkOut: booking.check_out,
            guestName: booking.guests?.name || 'Guest',
            roomType: booking.rooms?.room_types?.name || 'Room',
            alreadyReviewed: false
        };

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify(safeData)
        };

    } catch (err) {
        console.error('Error fetching booking details:', err);
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal Server Error' }) };
    }
};
