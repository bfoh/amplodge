import { createClient } from '@supabase/supabase-js'
import { requireAdmin, jsonResponse, handleCors } from './_lib/auth.js'

// -----------------------------------------------------------------------------
// Phase 2H (2026-05-10): admin-token gate added via requireAdmin().
// Phase 1 (2026-05-10): verified parity against legacy functions/create-employee
// — auth-user creation, "already exists" recovery, public.users row + first_login
// flag all covered here.
//
// The staff row is written here too. It used to be inserted from the browser,
// which needed a policy letting any signed-in account write any staff row —
// and so promote itself to owner (20261106120000_staff_role_lockdown.sql).
// The activity log entry is still written client-side in EmployeesPage.tsx.
// -----------------------------------------------------------------------------

const ROLES = ['staff', 'manager', 'admin', 'owner']
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Give the account its staff row. Returns the row, or a response to send when
 * the account is already an employee or the insert fails.
 */
async function createStaffRow(supabaseAdmin, user, { staffId, name, email, phone, role }) {
    const { data: existing, error: readError } = await supabaseAdmin
        .from('staff').select('id').eq('user_id', user.id).limit(1)
    if (readError) return { response: jsonResponse(500, { error: readError.message }) }
    if (existing && existing.length > 0) {
        return { response: jsonResponse(409, { error: 'This account is already an employee.' }) }
    }

    const { data: staff, error } = await supabaseAdmin
        .from('staff')
        .insert({
            id: staffId,
            user_id: user.id,
            name,
            email,
            phone: phone || null,
            role,
            created_at: new Date().toISOString(),
        })
        .select()
        .single()
    if (error) {
        console.error('[create-employee] Staff row insert failed:', error)
        return { response: jsonResponse(500, { error: `Account created, but the staff record failed: ${error.message}` }) }
    }
    return { staff }
}

export const handler = async function (event) {
    const corsResp = handleCors(event); if (corsResp) return corsResp

    if (event.httpMethod !== 'POST') {
        return jsonResponse(405, { error: 'Method not allowed' })
    }

    let actor
    try {
        actor = await requireAdmin(event)
    } catch (e) {
        return jsonResponse(e.status, e.body)
    }

    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Content-Type': 'application/json'
    }

    try {
        const { email, password, name, role = 'staff', phone, staffId: requestedId } = JSON.parse(event.body)

        // Validate required fields
        if (!email || !password) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'Email and password are required' })
            }
        }
        if (!name || typeof name !== 'string' || !name.trim()) {
            return jsonResponse(400, { error: 'Name is required' })
        }
        if (!ROLES.includes(role)) {
            return jsonResponse(400, { error: `Unknown role: ${role}` })
        }
        // Same rule as update-employee: only the owner hands out the owner role.
        if (role === 'owner' && actor?.staff?.role !== 'owner') {
            return jsonResponse(403, { error: 'Only the owner can assign the owner role.' })
        }
        if (requestedId !== undefined && !UUID.test(String(requestedId))) {
            return jsonResponse(400, { error: 'staffId must be a UUID' })
        }
        const staffFields = {
            staffId: requestedId || crypto.randomUUID(),
            name: name.trim(),
            email,
            phone,
            role,
        }

        // Create Supabase Admin client
        const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

        if (!supabaseUrl || !supabaseServiceKey) {
            console.error('Missing Supabase credentials')
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({ error: 'Server configuration error - missing Supabase credentials' })
            }
        }

        const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
            auth: {
                autoRefreshToken: false,
                persistSession: false
            }
        })

        // Create user with Admin API (doesn't require email confirmation)
        console.log('[create-employee] Creating user:', email)
        const { data: userData, error: createError } = await supabaseAdmin.auth.admin.createUser({
            email: email,
            password: password,
            email_confirm: true // Auto-confirm email
        })

        if (createError) {
            console.error('[create-employee] User creation error:', createError)

            // Handle "user already exists" error - attempt recovery
            if (createError.message.includes('already been registered') ||
                createError.message.includes('already exists')) {
                console.log('[create-employee] User already exists. Searching in auth.users...')

                // Use Admin API to list users and find by email
                const { data: listData, error: listError } = await supabaseAdmin.auth.admin.listUsers({
                    page: 1,
                    perPage: 100
                })

                if (listError) {
                    console.error('[create-employee] Failed to list users:', listError)
                    return {
                        statusCode: 409,
                        headers,
                        body: JSON.stringify({ error: 'User exists but could not be recovered. Please contact support.' })
                    }
                }

                // Find the user with matching email
                const existingUser = listData?.users?.find(u => u.email === email)

                if (existingUser) {
                    console.log('[create-employee] Found existing auth user:', existingUser.id)

                    // Someone who is already an employee keeps their password:
                    // re-adding their email must not reset it to the default.
                    const { data: alreadyStaff } = await supabaseAdmin
                        .from('staff').select('id').eq('user_id', existingUser.id).limit(1)
                    if (alreadyStaff && alreadyStaff.length > 0) {
                        return jsonResponse(409, { error: 'This account is already an employee.' })
                    }

                    // Reset password to the one provided
                    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
                        existingUser.id,
                        {
                            password: password,
                            email_confirm: true
                        }
                    )

                    if (updateError) {
                        console.error('[create-employee] Failed to reset password:', updateError)
                        return {
                            statusCode: 409,
                            headers,
                            body: JSON.stringify({ error: 'Account exists but password could not be reset. Please contact support.' })
                        }
                    }

                    // Ensure public.users record exists with first_login flag
                    await supabaseAdmin.from('users').upsert({
                        id: existingUser.id,
                        email: existingUser.email,
                        phone: phone || null,
                        first_login: 1,
                        updated_at: new Date().toISOString()
                    }, { onConflict: 'id' })

                    console.log('[create-employee] Successfully recovered existing user account')

                    const recoveredStaff = await createStaffRow(supabaseAdmin, existingUser, staffFields)
                    if (recoveredStaff.response) return recoveredStaff.response

                    return {
                        statusCode: 200,
                        headers,
                        body: JSON.stringify({
                            success: true,
                            user: {
                                id: existingUser.id,
                                email: existingUser.email
                            },
                            staff: recoveredStaff.staff,
                            recovered: true
                        })
                    }
                } else {
                    console.warn('[create-employee] Could not find user in auth.users despite conflict error')
                    return {
                        statusCode: 409,
                        headers,
                        body: JSON.stringify({ error: 'An account with this email already exists but could not be accessed.' })
                    }
                }
            }

            // Other creation errors
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: createError.message })
            }
        }

        if (!userData?.user) {
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({ error: 'Failed to create user account' })
            }
        }

        console.log('[create-employee] User created successfully:', userData.user.id)

        // Create user profile record
        try {
            await supabaseAdmin.from('users').insert({
                id: userData.user.id,
                email: userData.user.email,
                phone: phone || null,
                first_login: 1,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            })
            console.log('[create-employee] User profile created')
        } catch (profileError) {
            console.warn('[create-employee] Could not create user profile:', profileError)
            // Non-critical - continue
        }

        const created = await createStaffRow(supabaseAdmin, userData.user, staffFields)
        if (created.response) return created.response

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                user: {
                    id: userData.user.id,
                    email: userData.user.email
                },
                staff: created.staff
            })
        }

    } catch (error) {
        console.error('[create-employee] Error:', error)
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: error.message || 'An unexpected error occurred' })
        }
    }
}
