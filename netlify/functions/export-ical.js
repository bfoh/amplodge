import { createClient } from '@supabase/supabase-js';
import ical from 'ical-generator';
import { addDays, differenceInDays, isBefore, isAfter, startOfDay, parseISO, format } from 'date-fns';

export const handler = async (event, context) => {
    // Basic CORS headers
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'text/calendar; charset=utf-8'
    };

    if (event.httpMethod !== 'GET') {
        return { statusCode: 405, headers, body: 'Method Not Allowed' };
    }

    const { token } = event.queryStringParameters;

    if (!token) {
        return { statusCode: 400, headers, body: 'Missing export token' };
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
        console.error('Missing Supabase configuration');
        return { statusCode: 500, headers, body: 'Server Configuration Error' };
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    try {
        // 1. Find the mapping by token
        const { data: mapping, error: mappingError } = await supabase
            .from('channel_room_mappings')
            .select('*')
            .eq('export_token', token)
            .single();

        if (mappingError || !mapping) {
            return { statusCode: 404, headers, body: 'Calendar not found' };
        }

        const roomTypeId = mapping.local_room_type_id;

        // 2. Get total inventory for this room type
        // We count rooms that are NOT in maintenance (assuming status 'available' or 'cleaning' or 'occupied' are counts)
        // Actually, we should count all valid physical rooms.
        const { count: totalInventory, error: inventoryError } = await supabase
            .from('rooms')
            .select('*', { count: 'exact', head: true })
            .eq('room_type_id', roomTypeId)
            .neq('status', 'maintenance'); // Exclude maintenance rooms from inventory?

        if (inventoryError) {
            console.error('Error fetching inventory:', inventoryError);
            return { statusCode: 500, headers, body: 'Database Error' };
        }

        // 3. Get all active bookings for this room type
        // Range: Past 30 days to next 1 year
        const startDate = startOfDay(addDays(new Date(), -30));
        const endDate = startOfDay(addDays(new Date(), 365));

        const { data: bookings, error: bookingsError } = await supabase
            .from('bookings')
            .select('check_in, check_out, status, rooms!inner(room_type_id)')
            .eq('rooms.room_type_id', roomTypeId)
            .in('status', ['confirmed', 'reserved', 'checked-in'])
            .gte('check_out', startDate.toISOString())
            .lte('check_in', endDate.toISOString());

        if (bookingsError) {
            console.error('Error fetching bookings:', bookingsError);
            return { statusCode: 500, headers, body: 'Database Error' };
        }

        // 4. Calculate Availability Map
        // Map<DateString, OccupancyCount>
        const occupancyMap = new Map();

        bookings.forEach(booking => {
            const checkIn = parseISO(booking.check_in);
            const checkOut = parseISO(booking.check_out);

            // Iterate days from check-in up to (but not including) check-out
            let current = checkIn;
            // Guard against weird dates
            if (isAfter(checkIn, checkOut)) return;

            while (isBefore(current, checkOut)) {
                // Optimization: Only care if within our export window
                if (isAfter(current, endDate)) break;
                if (isBefore(current, startDate)) {
                    current = addDays(current, 1);
                    continue;
                }

                const dateKey = format(current, 'yyyy-MM-dd');
                const currentCount = occupancyMap.get(dateKey) || 0;
                occupancyMap.set(dateKey, currentCount + 1);

                current = addDays(current, 1);
            }
        });

        // 5. Generate iCal
        const calendar = ical({
            name: `AMP Lodge - ${roomTypeId}`,
            timezone: 'UTC'
        });

        // Loop through all days in range
        let iter = startDate;
        while (isBefore(iter, endDate)) {
            const dateKey = format(iter, 'yyyy-MM-dd');
            const occupancy = occupancyMap.get(dateKey) || 0;

            // If fully booked, add a "Busy" event
            if (occupancy >= totalInventory) {
                // Determine if we can merge consecutive busy days into a single event
                // (Skip for simplicity in MVP, or implement simple lookahead)

                // Simple version: 1-day event
                // calendar.createEvent({
                //     start: iter,
                //     end: addDays(iter, 1),
                //     summary: 'Unavailable',
                //     allDay: true,
                // });

                // Optimized version: find end of busy streak
                let streakEnd = addDays(iter, 1);
                while (isBefore(streakEnd, endDate)) {
                    const nextKey = format(streakEnd, 'yyyy-MM-dd');
                    const nextOcc = occupancyMap.get(nextKey) || 0;
                    if (nextOcc >= totalInventory) {
                        streakEnd = addDays(streakEnd, 1);
                    } else {
                        break;
                    }
                }

                calendar.createEvent({
                    start: iter,
                    end: streakEnd, // iCal events end is exclusive for all-day
                    summary: 'Closed', // Standard text
                    allDay: true
                });

                // Advance loop
                iter = streakEnd;
                continue;
            }

            iter = addDays(iter, 1);
        }

        return {
            statusCode: 200,
            headers,
            body: calendar.toString()
        };

    } catch (error) {
        console.error('Internal Error:', error);
        return { statusCode: 500, headers, body: 'Internal Server Error' };
    }
};
