
const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event, context) => {
    // CORS headers
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers, body: 'Make sure you send a POST request.' };
    }

    try {
        const { bookingId, rating, comment } = JSON.parse(event.body);

        if (!bookingId || !rating) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'Missing bookingId or rating' })
            };
        }

        const supabaseUrl = process.env.SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

        if (!supabaseUrl || !supabaseKey) {
            console.error('Missing Supabase credentials');
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({ error: 'Server configuration error' })
            };
        }

        const supabase = createClient(supabaseUrl, supabaseKey);

        // 1. Verify Booking exists
        const { data: booking, error: bookingError } = await supabase
            .from('bookings')
            .select('id, guest_id') // adjusted to snake_case if DB is snake_case
            .eq('id', bookingId)
            .single();

        if (bookingError || !booking) {
            return {
                statusCode: 404,
                headers,
                body: JSON.stringify({ error: 'Booking not found' })
            };
        }

        // 2. Check if review already exists
        const { data: existingReview, error: reviewCheckError } = await supabase
            .from('reviews')
            .select('id')
            .eq('booking_id', bookingId)
            .single();

        if (existingReview) {
            return {
                statusCode: 409,
                headers,
                body: JSON.stringify({ error: 'Review already submitted for this booking.' })
            };
        }

        // 3. Insert Review
        const { data: review, error: insertError } = await supabase
            .from('reviews')
            .insert({
                booking_id: bookingId,
                guest_id: booking.guest_id, // automatically linked
                rating: parseInt(rating),
                comment: comment || '',
                status: 'pending', // Pending moderation
                created_at: new Date().toISOString()
            })
            .select()
            .single();

        if (insertError) {
            console.error('Error inserting review:', insertError);
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({ error: 'Failed to submit review' })
            };
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ success: true, review })
        };

    } catch (error) {
        console.error('Function error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Internal Server Error' })
        };
    }
};
