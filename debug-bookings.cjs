const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Load environment variables from .env.local
try {
    const envPath = path.resolve(process.cwd(), '.env.local');
    if (fs.existsSync(envPath)) {
        console.log('Loading .env.local from:', envPath);
        const envFile = fs.readFileSync(envPath, 'utf8');
        const envConfig = envFile.split('\n').reduce((acc, line) => {
            const [key, ...values] = line.split('=');
            if (key && values.length > 0) {
                acc[key.trim()] = values.join('=').trim().replace(/^["']|["']$/g, '');
            }
            return acc;
        }, {});
        Object.assign(process.env, envConfig);
    } else {
        console.warn('.env.local not found');
    }
} catch (e) {
    console.error('Error loading .env.local:', e);
}

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

console.log('Supabase URL:', supabaseUrl);
// console.log('Supabase Key:', supabaseKey); // Don't log key

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing credentials');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkBookings() {
    console.log('Fetching last 5 bookings (raw)...');
    const { data, error } = await supabase
        .from('bookings')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(5);

    if (error) {
        console.error('Supabase Error:', error);
    } else {
        console.log('Count:', data.length);
        console.log(JSON.stringify(data, null, 2));
    }
}

checkBookings();
