const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
    try {
        const token = event.queryStringParameters?.token;

        const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

        if (!supabaseUrl || !supabaseKey) {
            return { statusCode: 500, body: JSON.stringify({ error: 'Missing Supabase configuration' }) };
        }

        const supabase = createClient(supabaseUrl, supabaseKey);

        if (token) {
            // Check specific token
            const { data: booking, error } = await supabase
                .from('bookings')
                .select('id, status, check_in, check_out, guest_token')
                .eq('guest_token', token)
                .single();

            if (error) {
                return { statusCode: 404, body: JSON.stringify({ error: 'Token not found', details: error.message }) };
            }

            return { statusCode: 200, body: JSON.stringify({ booking }) };
        } else {
            // List recent bookings with their statuses
            const { data: bookings, error } = await supabase
                .from('bookings')
                .select('id, status, check_in, check_out, guest_token')
                .not('guest_token', 'is', null)
                .order('created_at', { ascending: false })
                .limit(10);

            if (error) {
                return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
            }

            return { statusCode: 200, body: JSON.stringify({ bookings }) };
        }

    } catch (err) {
        console.error('Debug Error:', err);
        return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
    }
};
