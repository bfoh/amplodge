
const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')
const path = require('path')

const envPath = path.resolve(process.cwd(), '.env.local')
const envContent = fs.readFileSync(envPath, 'utf8')
const envConfig = {}
envContent.split('\n').forEach(line => {
    const [key, value] = line.split('=')
    if (key && value) {
        envConfig[key.trim()] = value.trim()
    }
})

const supabase = createClient(envConfig.VITE_SUPABASE_URL, envConfig.VITE_SUPABASE_ANON_KEY)

async function insertTestTask() {
    console.log('Inserting test task...')

    // Find a valid room first
    const { data: rooms } = await supabase.from('rooms').select('id, room_number').limit(1)
    const room = rooms && rooms[0] ? rooms[0] : { id: 'test_room_id', room_number: '999' }

    const testId = `task_debug_${Date.now()}`

    const { data, error } = await supabase
        .from('housekeeping_tasks')
        .insert({
            id: testId,
            property_id: room.id,
            room_number: room.room_number,
            status: 'pending',
            notes: 'VERIFICATION TASK: If you see this, housekeeping is working!',
            created_at: new Date().toISOString(),
            user_id: null // Ensure we test the null case
        })
        .select()

    if (error) {
        console.error('Error inserting test task:', JSON.stringify(error))
        process.exit(1)
    } else {
        console.log('Successfully inserted task:', JSON.stringify(data))

        // Write verification file
        fs.writeFileSync(path.resolve(process.cwd(), 'housekeeping-verified.txt'), 'SUCCESS: ' + testId)
    }
}

insertTestTask()
