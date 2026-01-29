const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
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

        // Drop and recreate the function with fixed logic
        const sql = `
            CREATE OR REPLACE FUNCTION submit_guest_request(
                token_input uuid,
                req_type service_request_type,
                req_details text
            )
            RETURNS json
            SECURITY DEFINER
            AS $$
            DECLARE
                target_booking_id uuid;
            BEGIN
                -- Validate Token - accepts ANY booking with this token (not just active ones)
                SELECT id INTO target_booking_id
                FROM bookings
                WHERE guest_token = token_input;

                IF target_booking_id IS NULL THEN
                    RETURN json_build_object('success', false, 'error', 'Invalid or expired token');
                END IF;

                -- Insert Request
                INSERT INTO service_requests (booking_id, type, details)
                VALUES (target_booking_id, req_type, req_details);

                RETURN json_build_object('success', true);
            END;
            $$ LANGUAGE plpgsql;
        `;

        const { error } = await supabase.rpc('exec_sql', { sql_query: sql });

        if (error) {
            // If exec_sql doesn't exist, try raw query approach
            console.error('RPC Error:', error);
            return { statusCode: 500, body: JSON.stringify({ error: 'Failed to apply fix. RPC not available.', details: error.message }) };
        }

        return { statusCode: 200, body: JSON.stringify({ success: true, message: 'Function updated successfully' }) };

    } catch (err) {
        console.error('Apply Fix Error:', err);
        return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
    }
};
