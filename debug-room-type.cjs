const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Load env
try {
    const envPath = path.resolve(process.cwd(), '.env.local');
    if (fs.existsSync(envPath)) {
        const envFile = fs.readFileSync(envPath, 'utf8');
        const envConfig = envFile.split('\n').reduce((acc, line) => {
            const [key, ...values] = line.split('=');
            if (key && values.length > 0) {
                const value = values.join('=').trim().replace(/^["']|["']$/g, '');
                process.env[key.trim()] = value;
            }
            return acc;
        }, {});
    }
} catch (e) { console.error(e); }

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkRoomType() {
    const typeId = '40d5e127-1baa-4401-a302-bb6524494b6e'; // From screenshot

    console.log('Checking Room Type:', typeId);

    // 1. Check if type exists
    const { data: type, error: typeError } = await supabase
        .from('room_types')
        .select('*')
        .eq('id', typeId)
        .single();

    if (typeError) console.error('Type Error:', typeError);
    console.log('Type Data:', type);

    // 2. Check rooms for this type
    const { data: rooms, error: roomsError } = await supabase
        .from('rooms')
        .select('*')
        .eq('room_type_id', typeId);

    if (roomsError) console.error('Rooms Error:', roomsError);

    console.log('Total Rooms for Type:', rooms ? rooms.length : 0);
    if (rooms) {
        rooms.forEach(r => console.log(`- Room ${r.room_number}: ${r.status}`));
    }
}

checkRoomType();
