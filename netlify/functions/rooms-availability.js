import { createClient } from '@supabase/supabase-js';
import { checkRateLimit, tooManyRequests } from './_lib/rate-limit.js';
import { busyRoomIds, freeRooms, loadCatalog, typeCapacity, typePhotos, typePrice } from './_lib/room-catalog.js';

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

    // Rate limit: 60 requests / minute per IP.
    const rl = await checkRateLimit(event, { endpoint: 'rooms-availability', limit: 60 });
    if (!rl.allowed) return tooManyRequests(headers);

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

        // The same rooms, types, prices and availability rule as the website
        // and the Rooms page: see _lib/room-catalog.js for why it no longer
        // reads the legacy `rooms` table.
        const catalog = await loadCatalog(supabase);
        const busy = await busyRoomIds(supabase, checkIn, checkOut);
        const siteUrl = process.env.URL || 'https://amplodge.org';

        const availabilityByType = {};
        for (const entry of catalog) {
            const { type } = entry;
            const capacity = typeCapacity(type);
            const fits = capacity === null || capacity >= guestCount;
            const free = fits ? freeRooms(entry, busy) : [];
            availabilityByType[type.id] = {
                roomTypeId: type.id,
                name: type.name,
                description: type.description,
                currency: 'GHS',
                price: typePrice(type),
                maxOccupancy: capacity,
                images: typePhotos(type, siteUrl),
                availableCount: free.length,
                roomIds: free.map((r) => r.id)
            };
        }

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
