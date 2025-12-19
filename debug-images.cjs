const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Manually parse .env.local
const envFile = fs.readFileSync(path.resolve(__dirname, '.env.local'), 'utf8');
const env = {};
envFile.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
        let value = match[2].trim();
        // Remove comments
        if (value.includes('#')) value = value.split('#')[0].trim();
        env[match[1].trim()] = value;
    }
});

const supabaseUrl = env['VITE_SUPABASE_URL'] || env['SUPABASE_URL'];
const supabaseKey = env['SUPABASE_SERVICE_ROLE_KEY'];

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing credentials in .env.local');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkImages() {
    const { data: types, error } = await supabase
        .from('room_types')
        .select('name, amenities, base_price'); // Checking amenities or other columns

    if (error) {
        console.error('Error:', error);
        return;
    }

    console.log('Room Types Check:');
    types.forEach(t => {
        console.log(`Type ${t.name}:`, JSON.stringify(t));
    });
}

checkImages();
