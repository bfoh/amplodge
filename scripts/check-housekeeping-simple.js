
const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')
const path = require('path')

// Manually parsing env file since we can't reliably load dotenv in this environment
const envPath = path.resolve(process.cwd(), '.env.local')
const envContent = fs.readFileSync(envPath, 'utf8')
const envConfig = {}
envContent.split('\n').forEach(line => {
    const [key, value] = line.split('=')
    if (key && value) {
        envConfig[key.trim()] = value.trim()
    }
})

const supabaseUrl = envConfig.VITE_SUPABASE_URL
const supabaseKey = envConfig.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase credentials')
    process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

async function checkHousekeeping() {
    console.log('Checking housekeeping_tasks table...')

    const { data, error } = await supabase
        .from('housekeeping_tasks')
        .select('*')
        .limit(5)

    if (error) {
        console.error('Error fetching tasks:', error)
    } else {
        console.log('Success! Found', data.length, 'tasks.')
        if (data.length > 0) {
            console.log('Sample task:', data[0])
        }
    }

    // Check room status
    console.log('\nChecking test room status...')
    const { data: rooms, error: roomError } = await supabase
        .from('rooms')
        .select('*')
        .limit(5)

    if (roomError) {
        console.log('Error fetching rooms:', roomError)
    } else {
        console.log('Found', rooms.length, 'rooms')
        if (rooms.length > 0) console.log('Sample room:', rooms[0])
    }
}

checkHousekeeping()
