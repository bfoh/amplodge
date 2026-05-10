import { createClient } from '@supabase/supabase-js'

/**
 * Auth-gate primitives shared by all privileged netlify functions.
 * Verifies Supabase JWT from `Authorization: Bearer <token>` header,
 * then enforces role requirements via `staff.role`.
 */

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

function adminClient() {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('Missing Supabase env vars (VITE_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY)')
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

function unauthorized(msg = 'Missing or invalid token') {
  const err = new Error(msg)
  err.status = 401
  err.body = { error: msg }
  throw err
}

function forbidden(msg = 'Forbidden') {
  const err = new Error(msg)
  err.status = 403
  err.body = { error: msg }
  throw err
}

/**
 * Returns { user, staff } if Authorization header has a valid JWT and the
 * user has a staff record. Returns null if no header or token invalid.
 * Does NOT throw on missing token (use require* for that).
 */
export async function tryAuth(event) {
  const auth = event.headers?.authorization || event.headers?.Authorization || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (!token) return null

  const sb = adminClient()
  const { data: { user }, error: uerr } = await sb.auth.getUser(token)
  if (uerr || !user) return null

  const { data: staff } = await sb
    .from('staff')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle()
  return { user, staff }
}

/**
 * Throws 401 if no token / invalid token.
 * Throws 403 if no staff record.
 * Returns { user, staff }.
 */
export async function requireStaff(event) {
  const ctx = await tryAuth(event)
  if (!ctx) unauthorized()
  if (!ctx.staff) forbidden('Not a staff member')
  return ctx
}

/**
 * Throws 401 / 403 unless authenticated user has staff.role = admin or owner.
 * Returns { user, staff }.
 */
export async function requireAdmin(event) {
  const ctx = await requireStaff(event)
  const role = ctx.staff?.role
  if (role !== 'admin' && role !== 'owner') {
    forbidden('Admin role required')
  }
  return ctx
}

/**
 * For cron-only endpoints. Accepts EITHER:
 *   - x-netlify-cron header (Netlify sets it on scheduled invocations)
 *   - admin token (manual trigger)
 * Throws 401/403 otherwise.
 * Returns { user, staff } (null fields if cron-triggered).
 */
export async function requireCron(event) {
  const isCron = event.headers?.['x-netlify-cron'] || event.headers?.['X-Netlify-Cron']
  if (isCron) return { user: null, staff: null }
  return requireAdmin(event)
}

export function jsonResponse(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json', ...cors },
    body: JSON.stringify(body),
  }
}

export function handleCors(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: cors, body: '' }
  }
  return null
}

export { cors }
