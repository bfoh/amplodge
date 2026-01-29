import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

async function backfillTokens() {
    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
        console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
        return;
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Find bookings without a token
    const { data: bookings, error: fetchError } = await supabase
        .from('bookings')
        .select('id, guest_token')
        .is('guest_token', null);

    if (fetchError) {
        console.error('Error fetching bookings:', fetchError);
        return;
    }

    console.log(`Found ${bookings?.length || 0} bookings without guest_token`);

    if (!bookings || bookings.length === 0) {
        console.log('All bookings already have tokens');
        return;
    }

    // Update each booking with a new token
    let updated = 0;
    for (const booking of bookings) {
        const { error: updateError } = await supabase
            .from('bookings')
            .update({ guest_token: crypto.randomUUID() })
            .eq('id', booking.id);

        if (updateError) {
            console.error(`Failed to update booking ${booking.id}:`, updateError);
        } else {
            updated++;
        }
    }

    console.log(`Successfully updated ${updated} bookings with guest_tokens`);
}

backfillTokens();
