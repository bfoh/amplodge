const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
    // Only allow POST
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }

    // Single generic failure for every "credentials don't line up" case so the
    // endpoint never reveals which rooms exist, which have bookings, or the
    // name on file. Enumeration + name-leak protection.
    const GENERIC_AUTH_ERROR = 'Invalid room number or name. Please check your booking details or contact reception.';
    const authFailed = () => ({ statusCode: 401, body: JSON.stringify({ error: GENERIC_AUTH_ERROR }) });

    try {
        const { roomNumber, firstName } = JSON.parse(event.body);

        if (!roomNumber || !firstName || !firstName.trim()) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Room number and First Name are required' }) };
        }

        const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

        if (!supabaseKey) {
            console.error("Server Error: Missing Service Key");
            return { statusCode: 500, body: JSON.stringify({ error: 'Server Configuration Error' }) };
        }

        const supabase = createClient(supabaseUrl, supabaseKey);

        // 1. Find Room ID
        const { data: room, error: roomError } = await supabase
            .from('rooms')
            .select('id')
            .eq('room_number', roomNumber)
            .maybeSingle();

        if (roomError) {
            console.error("Room Query Error:", roomError);
            return { statusCode: 500, body: JSON.stringify({ error: `Database Error (Room): ${roomError.message}` }) };
        }
        if (!room) {
            return authFailed();
        }

        console.log(`[guest-login] Room found: ${room.id} for room_number: ${roomNumber}`);

        // 2. Find ALL bookings for this room (for debugging)
        const { data: allBookings, error: allBookingsError } = await supabase
            .from('bookings')
            .select('id, status, check_in, check_out, guest_token, guest_id, guests(name)')
            .eq('room_id', room.id)
            .order('check_in', { ascending: false });

        if (allBookingsError) {
            console.error("All Bookings Query Error:", allBookingsError);
            return { statusCode: 500, body: JSON.stringify({ error: `Database Error (Booking): ${allBookingsError.message}` }) };
        }

        console.log(`[guest-login] Found ${allBookings?.length || 0} bookings for room ${roomNumber}`);

        if (!allBookings || allBookings.length === 0) {
            return authFailed();
        }

        // 3. Find the best matching booking
        // Priority: checked_in > confirmed, then by check_in date (most recent first)
        const today = new Date().toISOString().split('T')[0];
        console.log(`[guest-login] Today's date for comparison: ${today}`);

        // Find active booking (checked_in or confirmed with valid dates)
        let activeBooking = null;

        for (const booking of allBookings) {
            console.log(`[guest-login] Checking booking: id=${booking.id}, status=${booking.status}, check_in=${booking.check_in}, check_out=${booking.check_out}`);

            // Check if status is valid
            if (!['confirmed', 'checked-in'].includes(booking.status)) {
                console.log(`[guest-login] Skipping - status not active: ${booking.status}`);
                continue;
            }

            // Check if booking is current (check_out >= today)
            // Be lenient: if check_out is null or it's >= today, accept it
            if (booking.check_out && booking.check_out < today) {
                console.log(`[guest-login] Skipping - already checked out: ${booking.check_out} < ${today}`);
                continue;
            }

            // Found a valid booking
            activeBooking = booking;
            console.log(`[guest-login] Found active booking: ${booking.id}`);
            break;
        }

        if (!activeBooking) {
            return authFailed();
        }

        // 4. Verify Guest Name
        let guestName = '';
        if (activeBooking.guests) {
            guestName = Array.isArray(activeBooking.guests) ? activeBooking.guests[0]?.name : activeBooking.guests.name;
        }

        if (!guestName && activeBooking.guest_id) {
            // Fallback: Fetch guest manually
            const { data: guest, error: guestError } = await supabase
                .from('guests')
                .select('name')
                .eq('id', activeBooking.guest_id)
                .single();

            if (guestError || !guest) {
                console.error("Guest Query Error:", guestError);
                return authFailed();
            }
            guestName = guest.name;
        }

        // 5. Verify name. Require an EXACT (case-insensitive) match on the
        // guest's first name — NOT a prefix, which let a single letter match
        // any guest. On any mismatch, return the generic error and never echo
        // the stored name.
        const storedFirstName = (guestName || '').trim().split(/\s+/)[0].toLowerCase();
        const providedFirstName = firstName.trim().toLowerCase();

        if (!storedFirstName || storedFirstName !== providedFirstName) {
            console.log('[guest-login] Name mismatch for room', roomNumber);
            return authFailed();
        }

        // Name matched but no token was ever issued for this booking — fail
        // rather than hand back a "/guest/null" capability URL.
        if (!activeBooking.guest_token) {
            console.warn('[guest-login] Booking has no guest_token:', activeBooking.id);
            return authFailed();
        }

        console.log('[guest-login] Name match successful');
        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                token: activeBooking.guest_token,
                guestName: guestName
            })
        };

    } catch (err) {
        console.error("Guest Login Handler Error:", err);
        return { statusCode: 500, body: JSON.stringify({ error: 'Internal Server Error' }) };
    }
};
