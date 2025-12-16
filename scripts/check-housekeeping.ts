
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'

// Load env vars
const envConfig = dotenv.parse(fs.readFileSync(path.resolve(process.cwd(), '.env.local')))
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

    // Also check if we can insert a test task
    console.log('\nAttempting to create a test task...')
    const testId = `test_${Date.now()}`
    const { data: insertData, error: insertError } = await supabase
        .from('housekeeping_tasks')
        .insert({
            id: testId,
            property_id: 'test_prop', // Note: snake_case for DB
            room_number: '999',
            status: 'pending',
            notes: 'Test task from debug script',
            created_at: new Date().toISOString()
        })
        .select()

    if (insertError) {
        console.error('Error creating test task:', insertError)
    } else {
        console.log('Successfully created test task:', insertData)

        // Clean up
        await supabase.from('housekeeping_tasks').delete().eq('id', testId)
        console.log('Cleaned up test task.')
    }
}

checkHousekeeping()
