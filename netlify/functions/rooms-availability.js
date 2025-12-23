import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

export const handler = async (event, context) => {
    // CORS Headers
    const headers = {
        'Access-Control-Allow-Origin': '*', // Allow any origin for testing, restrict to app/agent domain in prod if needed
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
    };

    // Handle OPTIONS request (Preflight)
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers,
            body: ''
        };
    }

    if (event.httpMethod !== 'GET') {
        return {
            statusCode: 405,
            headers,
            body: JSON.stringify({ error: 'Method Not Allowed' })
        };
    }

    try {
        const { checkIn, checkOut, guests } = event.queryStringParameters;
        console.log('[RoomsAvailability] Request:', { checkIn, checkOut, guests });

        if (!checkIn || !checkOut) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'Missing checkIn or checkOut parameters' })
            };
        }

        const guestCount = parseInt(guests) || 1;

        // 0. Pre-fetch ALL room types to ensure complete response structure
        const { data: allTypes, error: typesError } = await supabase.from('room_types').select('*');
        if (typesError) throw typesError;

        // Fallback images if DB is empty
        const FALLBACK_IMAGES = {
            'Standard Room': ['https://images.unsplash.com/photo-1611892440504-42a792e24d32?q=80&w=800&auto=format&fit=crop'],
            'Deluxe Room': ['https://images.unsplash.com/photo-1618773928121-c32242e63f39?q=80&w=800&auto=format&fit=crop'],
            'Executive Suite': ['https://images.unsplash.com/photo-1590490360182-c33d57733427?q=80&w=800&auto=format&fit=crop'],
            'Family Room': ['https://images.unsplash.com/photo-1566665797739-1674de7a421a?q=80&w=800&auto=format&fit=crop'],
            'Presidential Suite': ['https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?q=80&w=800&auto=format&fit=crop']
        };

        const availabilityByType = {};
        allTypes.forEach(t => {
            availabilityByType[t.id] = {
                roomTypeId: t.id,
                name: t.name,
                description: t.description,
                currency: 'GHS',
                price: t.base_price,
                maxOccupancy: t.max_occupancy,
                images: FALLBACK_IMAGES[t.name] || FALLBACK_IMAGES['Standard Room'],
                availableCount: 0,
                roomIds: []
            };
        });

        // 1. Get all rooms with their types (clean/available only)
        const { data: allRooms, error: roomsError } = await supabase
            .from('rooms')
            .select(`
                id,
                room_number,
                status,
                image_urls,
                room_types (id)
            `)
            .in('status', ['clean', 'available']);

        if (roomsError) throw roomsError;

        // 2. Get overlapping bookings
        const { data: busyBookings, error: bookingsError } = await supabase
            .from('bookings')
            .select('room_id')
            .neq('status', 'cancelled')
            .lt('check_in', checkOut)
            .gt('check_out', checkIn);

        if (bookingsError) throw bookingsError;

        const busyRoomIds = new Set(busyBookings.map(b => b.room_id));

        // 3. Filter available rooms and update counts
        allRooms.forEach(room => {
            if (!room.room_types) return;
            const typeId = room.room_types.id;

            // Check occupancy (using pre-fetched type data for max_occupancy)
            if (availabilityByType[typeId].maxOccupancy < guestCount) return;

            // Check if busy
            if (busyRoomIds.has(room.id)) return;

            // Valid room found
            availabilityByType[typeId].availableCount++;
            availabilityByType[typeId].roomIds.push(room.id);

            // Update images if specific room has them
            if (room.image_urls && room.image_urls.length > 0) {
                availabilityByType[typeId].images = room.image_urls;
            }
        });

        console.log(`[RoomsAvailability] Response built with ${Object.keys(availabilityByType).length} types`);

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                data: Object.values(availabilityByType)
            })
        };

    } catch (error) {
        console.error('Error fetching availability:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Internal Server Error', details: error.message })
        };
    }
};
