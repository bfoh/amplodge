const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
    // Only allow GET requests
    if (event.httpMethod !== 'GET') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }

    const { token } = event.queryStringParameters;

    if (!token) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Missing token' }) };
    }

    try {
        const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // Must use Service Role to search by token securely

        if (!supabaseKey) {
            console.error("Missing SUPABASE_SERVICE_ROLE_KEY");
            return { statusCode: 500, body: JSON.stringify({ error: 'Server Configuration Error' }) };
        }

        const supabase = createClient(supabaseUrl, supabaseKey);

        // Fetch booking by token
        // Security: Only return non-sensitive fields.
        const { data: booking, error } = await supabase
            .from('bookings')
            .select(`
                id,
                check_in,
                check_out,
                status,
                guests (name, email),
                rooms (room_number)
            `)
            .eq('guest_token', token)
            .single();

        if (error || !booking) {
            console.warn("Invalid Guest Token Query Error:", error);
            return { statusCode: 404, body: JSON.stringify({ error: 'Invalid or Expired Token' }) };
        }

        // Additional Check: Is the booking active? (Optional, maybe allow viewing past bookings too?)
        // For now, allow viewing any valid booking linked to the token.

        const guestName = booking.guests ? booking.guests.name : 'Guest';
        const roomNumber = booking.rooms ? booking.rooms.room_number : 'Unassigned';

        const responseData = {
            valid: true,
            guest: {
                name: guestName,
                room: roomNumber
            },
            booking: {
                id: booking.id,
                checkIn: booking.check_in,
                checkOut: booking.check_out,
                status: booking.status
            }
        };

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                // Enable CORS if needed (usually handled by Netlify dev or same-origin in prod)
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify(responseData)
        };

    } catch (err) {
        console.error("Verify Guest Error:", err);
        return { statusCode: 500, body: JSON.stringify({ error: 'Internal Server Error' }) };
    }
};
