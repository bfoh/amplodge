import { createClient } from '@supabase/supabase-js'
import { requireAdmin, jsonResponse, handleCors } from './_lib/auth.js'

/**
 * Remove an employee: staff row, profile row and login, in that order.
 *
 * All three used to be split between here and the browser — this function
 * deleted the auth user, the Employees page deleted the staff row under RLS,
 * and neither knew whether the other had succeeded. The page never checked the
 * response, so an employee whose login failed to delete still disappeared from
 * the list while keeping their account: three such accounts were left behind in
 * production. Doing the whole removal in one place, with the service role, is
 * what makes the result something the caller can be told about.
 *
 * Idempotent: a piece that is already gone counts as done, so a retry after a
 * partial failure finishes the job instead of reporting an error about the half
 * that already worked.
 */
export const handler = async function (event) {
    const corsResp = handleCors(event); if (corsResp) return corsResp

    if (event.httpMethod !== 'POST' && event.httpMethod !== 'DELETE') {
        return jsonResponse(405, { error: 'Method not allowed' })
    }

    let actor
    try {
        actor = await requireAdmin(event)
    } catch (e) {
        return jsonResponse(e.status, e.body)
    }

    try {
        const { userId, staffId } = JSON.parse(event.body || '{}')

        if (!userId && !staffId) {
            return jsonResponse(400, { error: 'userId or staffId is required' })
        }

        const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

        if (!supabaseUrl || !supabaseServiceKey) {
            console.error('[delete-employee] Missing Supabase credentials')
            return jsonResponse(500, { error: 'Server configuration error' })
        }

        const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
            auth: { autoRefreshToken: false, persistSession: false },
        })

        // Find the staff row first: it carries the role and the auth id, and the
        // caller may know only one of the two.
        let staffRow = null
        if (staffId) {
            const { data } = await supabaseAdmin.from('staff').select('*').eq('id', staffId).maybeSingle()
            staffRow = data || null
        }
        if (!staffRow && userId) {
            const { data } = await supabaseAdmin.from('staff').select('*').eq('user_id', userId).maybeSingle()
            staffRow = data || null
        }

        const authUserId = staffRow?.user_id || (userId && userId !== 'pending' ? userId : null)

        // An admin who deletes their own account is signed in with a token that
        // outlives it — they keep working until the page reloads, then cannot
        // get back in. The owner is above an admin and the Employees page
        // already hides the option; this is the same rule where it cannot be
        // clicked past.
        if (authUserId && actor?.user?.id && authUserId === actor.user.id) {
            return jsonResponse(400, { error: 'You cannot delete your own account.' })
        }
        if (staffRow?.role === 'owner' && actor?.staff?.role !== 'owner') {
            return jsonResponse(403, { error: 'Only the owner can delete the owner account.' })
        }

        const result = { success: true, staffDeleted: false, profileDeleted: false, authDeleted: false, warnings: [] }

        // 1. Staff row — what the Employees page lists.
        if (staffRow) {
            const { error } = await supabaseAdmin.from('staff').delete().eq('id', staffRow.id)
            if (error) {
                console.error('[delete-employee] staff row:', error)
                return jsonResponse(400, {
                    error: `Could not remove the employee record: ${error.message}`,
                    stage: 'staff',
                })
            }
            result.staffDeleted = true
        }

        if (authUserId) {
            // 2. Profile row. Best effort: the login is what grants access, and
            // a stranded profile row is not a way back in.
            const { error: profileError } = await supabaseAdmin.from('users').delete().eq('id', authUserId)
            if (profileError) {
                console.warn('[delete-employee] user profile:', profileError)
                result.warnings.push(`Profile record kept: ${profileError.message}`)
            } else {
                result.profileDeleted = true
            }

            // 3. The login itself. This is the part that has to be reported
            // honestly — an employee with a live account is still an employee.
            const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(authUserId)
            if (authError) {
                const alreadyGone = authError.status === 404 ||
                    /not\s*found/i.test(authError.message || '')
                if (alreadyGone) {
                    result.authDeleted = true
                } else {
                    console.error('[delete-employee] auth user:', authError)
                    return jsonResponse(400, {
                        error: `The employee record was removed but their login could not be deleted: ${authError.message}`,
                        stage: 'auth',
                        staffDeleted: result.staffDeleted,
                        profileDeleted: result.profileDeleted,
                    })
                }
            } else {
                result.authDeleted = true
            }
        }

        if (!staffRow && !authUserId) {
            return jsonResponse(404, { error: 'No employee found for that id' })
        }

        console.log('[delete-employee] removed', { staffId: staffRow?.id, authUserId, ...result })
        return jsonResponse(200, result)

    } catch (error) {
        console.error('[delete-employee] Error:', error)
        return jsonResponse(500, { error: error.message || 'An unexpected error occurred' })
    }
}
