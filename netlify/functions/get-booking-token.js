const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
    if (event.httpMethod !== 'GET') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }

    const { bookingId } = event.queryStringParameters;

    if (!bookingId) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Missing bookingId' }) };
    }

    try {
        const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

        if (!supabaseKey) {
            return { statusCode: 500, body: JSON.stringify({ error: 'Server Config Error' }) };
        }

        const supabase = createClient(supabaseUrl, supabaseKey);

        // Normalize ID (handle local vs remote formatting if needed)
        // Usually bookingId passed here should be the remote ID (UUID) or close to it.
        // But our local booking IDs are "booking_TIMESTAMP".

        let targetId = bookingId;
        // If it looks like a local Pouch ID (booking_...), we might fail unless we stored the remote ID properly.
        // Assuming bookingId passed is the one stored in Supabase (UUID).
        // If the frontend has "booking_123", we can't easily find it unless we know the remote ID.
        // Frontend `BookingWithDetails` has `remoteId`. We should pass THAT.

        const { data, error } = await supabase
            .from('bookings')
            .select('guest_token')
            .eq('id', targetId)
            .single();

        if (error || !data) {
            // Try strict fallback for "booking-" prefix if pure UUID failed
            // (Though usually remoteId is just the UUID)
            return { statusCode: 404, body: JSON.stringify({ error: 'Booking not found' }) };
        }

        return {
            statusCode: 200,
            body: JSON.stringify({ token: data.guest_token })
        };

    } catch (err) {
        console.error("Get Token Error:", err);
        return { statusCode: 500, body: JSON.stringify({ error: 'Internal Server Error' }) };
    }
};
