
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

// Logging helper
const logFile = path.resolve('clear-housekeeping.log')
function log(msg: string) {
    console.log(msg)
    fs.appendFileSync(logFile, msg + '\n')
}

// Helper to read env file
function getEnvVars() {
    try {
        const __filename = fileURLToPath(import.meta.url)
        const __dirname = path.dirname(__filename)
        // Go up two levels to root (src/services -> src -> root)
        const envPath = path.resolve(__dirname, '../../.env.local')

        log('Reading env from: ' + envPath)

        if (fs.existsSync(envPath)) {
            const content = fs.readFileSync(envPath, 'utf-8')
            const urlMatch = content.match(/VITE_SUPABASE_URL=(.+)/)
            const keyMatch = content.match(/VITE_SUPABASE_ANON_KEY=(.+)/)

            return {
                url: urlMatch ? urlMatch[1].trim() : process.env.VITE_SUPABASE_URL,
                key: keyMatch ? keyMatch[1].trim() : process.env.VITE_SUPABASE_ANON_KEY
            }
        }
    } catch (e) {
        log('Error reading .env.local ' + e)
    }
    return {
        url: process.env.VITE_SUPABASE_URL,
        key: process.env.VITE_SUPABASE_ANON_KEY
    }
}

async function clearHousekeeping() {
    fs.writeFileSync(logFile, 'Starting cleanup...\n')
    const { url, key } = getEnvVars()

    if (!url || !key) {
        log('❌ Missing Supabase credentials')
        process.exit(1)
    }

    log('🔌 Connecting to Supabase...')
    const supabase = createClient(url, key)

    try {
        // 1. Delete all pending housekeeping tasks
        log('🧹 Finding pending housekeeping tasks...')
        const { data: tasks, error: fetchError } = await supabase
            .from('housekeeping_tasks')
            .select('id, status, room_id')
            .neq('status', 'completed')

        if (fetchError) {
            log('❌ Error fetching tasks: ' + fetchError.message)
        } else if (tasks && tasks.length > 0) {
            log(`Found ${tasks.length} pending/active tasks. Deleting...`)

            const idsToDelete = tasks.map(t => t.id)
            const { error: deleteError } = await supabase
                .from('housekeeping_tasks')
                .delete()
                .in('id', idsToDelete)

            if (deleteError) {
                log('❌ Error deleting tasks: ' + deleteError.message)
            } else {
                log('✅ Successfully deleted pending housekeeping tasks')
            }
        } else {
            log('ℹ️ No pending housekeeping tasks found.')
        }

        // 2. Reset rooms stuck in 'cleaning'
        log('Tb Finding rooms with status cleaning or maintenance...')

        const { data: cleaningRooms, error: verifyError } = await supabase
            .from('rooms')
            .select('*')
            .eq('status', 'cleaning')

        if (cleaningRooms && cleaningRooms.length > 0) {
            log(`Found ${cleaningRooms.length} rooms in 'cleaning' status. Resetting to 'clean'...`)
            const roomIds = cleaningRooms.map(r => r.id)

            const { error: updateError } = await supabase
                .from('rooms')
                .update({ status: 'clean' })
                .in('id', roomIds)

            if (updateError) {
                log('❌ Error updating rooms: ' + JSON.stringify(updateError))
            } else {
                log('✅ Successfully reset rooms to clean status')
            }
        } else {
            log('ℹ️ No rooms found in cleaning status.')
        }

        log('✨ Cleanup complete!')

    } catch (error) {
        log('❌ Unexpected error: ' + error)
    }
}

clearHousekeeping()
