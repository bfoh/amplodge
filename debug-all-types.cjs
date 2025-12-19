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

async function listAllTypes() {
    console.log('Listing all Room Types...');
    const { data: types, error } = await supabase.from('room_types').select('*');
    if (error) {
        console.error(error);
    } else {
        types.forEach(t => console.log(`${t.name}: ${t.id}`));
    }

    console.log('\nSimulating Availability Response logic...');
    // Replicating rooms-availability logic to see what IDs it generates
    const { data: rooms } = await supabase.from('rooms').select('id, room_types(id, name)').limit(5);
    rooms.forEach(r => {
        if (r.room_types) {
            console.log(`Room ${r.id} -> Type: ${r.room_types.name} (${r.room_types.id})`);
        } else {
            console.log(`Room ${r.id} has NO type relation!`);
        }
    });
}

listAllTypes();
