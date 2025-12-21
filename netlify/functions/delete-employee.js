import { createClient } from '@supabase/supabase-js'

export const handler = async function (event, context) {
    // Only allow POST/DELETE requests
    if (event.httpMethod !== 'POST' && event.httpMethod !== 'DELETE') {
        return {
            statusCode: 405,
            body: JSON.stringify({ error: 'Method not allowed' })
        }
    }

    // CORS headers
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS, GET',
        'Content-Type': 'application/json'
    }

    // Handle preflight
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' }
    }

    try {
        const { userId } = JSON.parse(event.body)

        if (!userId) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'User ID is required' })
            }
        }

        // Create Supabase Admin client
        const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

        if (!supabaseUrl || !supabaseServiceKey) {
            console.error('Missing Supabase credentials')
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({ error: 'Server configuration error' })
            }
        }

        const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
            auth: {
                autoRefreshToken: false,
                persistSession: false
            }
        })

        console.log(`[delete-employee] Deleting user ${userId}...`)

        // Delete user from Auth
        const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(userId)

        if (deleteError) {
            console.error('[delete-employee] Failed to delete auth user:', deleteError)
            // Even if auth deletion fails, we might want to return success if user wasn't found
            // but for now let's report it
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: deleteError.message })
            }
        }

        // Also ensure user profile is deleted (should cascade but good to be sure)
        const { error: profileError } = await supabaseAdmin.from('users').delete().eq('id', userId)
        if (profileError) {
            console.warn('[delete-employee] Failed to delete user profile:', profileError)
        }

        console.log(`[delete-employee] Successfully deleted user ${userId}`)

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ success: true })
        }

    } catch (error) {
        console.error('[delete-employee] Error:', error)
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: error.message || 'An unexpected error occurred' })
        }
    }
}
