const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
    // Only allow POST requests
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }

    try {
        const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

        if (!supabaseUrl || !supabaseKey) {
            return { statusCode: 500, body: JSON.stringify({ error: 'Missing Supabase configuration' }) };
        }

        const supabase = createClient(supabaseUrl, supabaseKey);

        // Find bookings without a token
        const { data: bookings, error: fetchError } = await supabase
            .from('bookings')
            .select('id, guest_token')
            .is('guest_token', null);

        if (fetchError) {
            return { statusCode: 500, body: JSON.stringify({ error: 'Error fetching bookings', details: fetchError.message }) };
        }

        const count = bookings?.length || 0;

        if (count === 0) {
            return { statusCode: 200, body: JSON.stringify({ message: 'All bookings already have tokens', updated: 0 }) };
        }

        // Update each booking with a new token
        let updated = 0;
        for (const booking of bookings) {
            const newToken = `${Math.random().toString(36).substring(2, 15)}-${Math.random().toString(36).substring(2, 15)}-${Date.now().toString(36)}`;
            const { error: updateError } = await supabase
                .from('bookings')
                .update({ guest_token: newToken })
                .eq('id', booking.id);

            if (!updateError) {
                updated++;
            }
        }

        return {
            statusCode: 200,
            body: JSON.stringify({ message: `Backfilled ${updated} of ${count} bookings with guest_tokens`, updated, total: count })
        };

    } catch (err) {
        console.error('Backfill Error:', err);
        return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
    }
};
