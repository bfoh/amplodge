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

async function checkRoomStatus() {
    console.log('--- Room Types ---');
    const { data: types } = await supabase.from('room_types').select('*');
    if (!types) { console.log('No types found'); return; }

    for (const t of types) {
        console.log(`Type: ${t.name} (ID: ${t.id}, Max Occ: ${t.max_occupancy})`);

        const { data: rooms } = await supabase
            .from('rooms')
            .select('id, room_number, status')
            .eq('room_type_id', t.id);

        if (!rooms || rooms.length === 0) {
            console.log(`  -> NO ROOMS ASSIGNED!`);
        } else {
            rooms.forEach(r => {
                console.log(`  -> Room ${r.room_number}: ${r.status}`);
            });
        }
    }
}

checkRoomStatus();
