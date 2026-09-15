import { createClient } from '@supabase/supabase-js'
import { requireAdmin, jsonResponse, handleCors } from './_lib/auth.js'

/**
 * Edit an employee: their staff record, and the login that belongs to it.
 *
 * The Employees page used to write name, role and phone straight to the staff
 * row and stop there. Email was on the form and editable, but nothing ever
 * wrote it — changing it appeared to work and changed nothing. Even had it been
 * written, the person would still have signed in with the old address, because
 * the login lives in auth.users and nothing here touched it.
 *
 * So the record and the account are updated together, in one place, under the
 * service role, and the caller is told which parts moved.
 */
export const handler = async function (event) {
    const corsResp = handleCors(event); if (corsResp) return corsResp

    if (event.httpMethod !== 'POST' && event.httpMethod !== 'PUT') {
        return jsonResponse(405, { error: 'Method not allowed' })
    }

    let actor
    try {
        actor = await requireAdmin(event)
    } catch (e) {
        return jsonResponse(e.status, e.body)
    }

    const ROLES = ['staff', 'manager', 'admin', 'owner']
    const RANK = { staff: 1, manager: 2, admin: 3, owner: 4 }

    try {
        const { staffId, name, email, phone, role } = JSON.parse(event.body || '{}')

        if (!staffId) return jsonResponse(400, { error: 'staffId is required' })
        if (role && !ROLES.includes(role)) return jsonResponse(400, { error: `Unknown role: ${role}` })

        const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
        if (!supabaseUrl || !supabaseServiceKey) {
            console.error('[update-employee] Missing Supabase credentials')
            return jsonResponse(500, { error: 'Server configuration error' })
        }

        const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
            auth: { autoRefreshToken: false, persistSession: false },
        })

        const { data: staffRow, error: readError } = await supabaseAdmin
            .from('staff').select('*').eq('id', staffId).maybeSingle()
        if (readError) return jsonResponse(400, { error: readError.message })
        if (!staffRow) return jsonResponse(404, { error: 'No employee found for that id' })

        const actorRole = actor?.staff?.role || ''
        const isSelf = staffRow.user_id && actor?.user?.id && staffRow.user_id === actor.user.id

        // The owner outranks an admin, so only the owner edits the owner.
        if (staffRow.role === 'owner' && actorRole !== 'owner') {
            return jsonResponse(403, { error: 'Only the owner can edit the owner account.' })
        }
        // Nobody hands themselves more authority, or takes their own away and
        // locks the hotel out of its own admin.
        if (role && role !== staffRow.role && isSelf) {
            return jsonResponse(400, { error: 'You cannot change your own role.' })
        }
        // An admin may not mint an owner, nor promote anyone past themselves.
        if (role && role !== staffRow.role && actorRole !== 'owner' && RANK[role] >= RANK.owner) {
            return jsonResponse(403, { error: 'Only the owner can assign the owner role.' })
        }

        const cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : ''
        const emailChanged = !!cleanEmail && cleanEmail !== (staffRow.email || '').trim().toLowerCase()

        // An email already in use is the one failure worth catching before
        // anything is written: half-applied, it would leave the record and the
        // login disagreeing about who this person is.
        if (emailChanged) {
            const { data: clash } = await supabaseAdmin
                .from('staff').select('id').ilike('email', cleanEmail).neq('id', staffId).limit(1)
            if (clash && clash.length > 0) {
                return jsonResponse(409, { error: 'Another employee already uses that email address.' })
            }
        }

        const result = { success: true, recordUpdated: false, loginEmailUpdated: false, warnings: [] }

        // 1. The login first. If the address is taken in auth it fails here,
        //    before the staff row has been touched, so the two cannot diverge.
        if (emailChanged && staffRow.user_id) {
            const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(
                staffRow.user_id,
                { email: cleanEmail, email_confirm: true }
            )
            if (authError) {
                const taken = /already|registered|exists/i.test(authError.message || '')
                return jsonResponse(taken ? 409 : 400, {
                    error: taken
                        ? 'That email address already belongs to another account.'
                        : `Could not change the sign-in email: ${authError.message}`,
                    stage: 'auth',
                })
            }
            result.loginEmailUpdated = true
        }

        // 2. The staff record.
        const updates = {}
        if (typeof name === 'string' && name.trim()) updates.name = name.trim()
        if (typeof phone === 'string') updates.phone = phone.trim() || null
        if (role) updates.role = role
        if (emailChanged) updates.email = cleanEmail

        if (Object.keys(updates).length > 0) {
            const { error: updateError } = await supabaseAdmin.from('staff').update(updates).eq('id', staffId)
            if (updateError) {
                console.error('[update-employee] staff row:', updateError)
                return jsonResponse(400, {
                    error: `Could not update the employee record: ${updateError.message}`,
                    stage: 'staff',
                    loginEmailUpdated: result.loginEmailUpdated,
                })
            }
            result.recordUpdated = true
        }

        // 3. The profile row, which carries the email for the first-login flow.
        if (emailChanged && staffRow.user_id) {
            const { error: profileError } = await supabaseAdmin
                .from('users').update({ email: cleanEmail, updated_at: new Date().toISOString() })
                .eq('id', staffRow.user_id)
            if (profileError) {
                console.warn('[update-employee] user profile:', profileError)
                result.warnings.push(`Profile record still shows the old email: ${profileError.message}`)
            }
        }

        if (emailChanged && !staffRow.user_id) {
            result.warnings.push('This employee has no login yet, so only their record was updated.')
        }

        console.log('[update-employee] updated', { staffId, ...result })
        return jsonResponse(200, result)

    } catch (error) {
        console.error('[update-employee] Error:', error)
        return jsonResponse(500, { error: error.message || 'An unexpected error occurred' })
    }
}
