const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
    if (event.httpMethod !== 'GET') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }

    const { token } = event.queryStringParameters;

    if (!token) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Missing token' }) };
    }

    try {
        const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

        if (!supabaseKey) {
            console.error("Server Error: Missing Service Key");
            return { statusCode: 500, body: JSON.stringify({ error: 'Server Configuration Error' }) };
        }

        const supabase = createClient(supabaseUrl, supabaseKey);

        const { data, error } = await supabase.rpc('get_guest_requests', {
            token_input: token
        });

        if (error) {
            console.error("RPC Error:", error);
            return { statusCode: 500, body: JSON.stringify({ error: 'Database error' }) };
        }

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ success: true, requests: data })
        };

    } catch (err) {
        console.error("Get Guest Requests Error:", err);
        return { statusCode: 500, body: JSON.stringify({ error: 'Internal Server Error' }) };
    }
};
