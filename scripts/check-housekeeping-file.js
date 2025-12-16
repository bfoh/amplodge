
const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')
const path = require('path')

const outputFile = path.resolve(process.cwd(), 'housekeeping-debug.txt')
const log = (msg) => {
    fs.appendFileSync(outputFile, msg + '\n')
    console.log(msg)
}

// Manually parsing env file
const envPath = path.resolve(process.cwd(), '.env.local')
try {
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
        log('Missing Supabase credentials')
        process.exit(1)
    }

    const supabase = createClient(supabaseUrl, supabaseKey)

    async function checkHousekeeping() {
        log('Checking housekeeping_tasks table...')

        const { data, error } = await supabase
            .from('housekeeping_tasks')
            .select('*')
            .limit(5)

        if (error) {
            log('Error fetching tasks: ' + JSON.stringify(error))
        } else {
            log('Success! Found ' + data.length + ' tasks.')
            if (data.length > 0) {
                log('Sample task: ' + JSON.stringify(data[0]))
            }
        }

        log('Checking rooms table...')
        const { data: rooms, error: roomError } = await supabase
            .from('rooms')
            .select('*')
            .limit(1)

        if (roomError) {
            log('Error checking rooms: ' + JSON.stringify(roomError))
        } else {
            log('Rooms available: ' + rooms.length)
        }
    }

    checkHousekeeping()
} catch (e) {
    log('Fatal error: ' + e.message)
}
