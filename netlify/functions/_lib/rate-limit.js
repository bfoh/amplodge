import { createClient } from '@supabase/supabase-js'

// Per-client-IP rate limiting backed by the check_rate_limit Postgres RPC
// (see migration 20260719010000_rate_limits.sql). Fails OPEN: any limiter
// error allows the request, so booking flows never break because of it.

let _sb = null
function client() {
  if (_sb) return _sb
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
  _sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  return _sb
}

/** Real client IP behind Netlify (falls back progressively). */
export function clientIp(event) {
  const h = event.headers || {}
  return h['x-nf-client-connection-ip']
    || h['x-forwarded-for']?.split(',')[0]?.trim()
    || h['client-ip']
    || 'unknown'
}

/**
 * Returns { allowed: boolean }. `endpoint` namespaces the counter so each
 * function has its own bucket per IP. windowSeconds defaults to 60.
 */
export async function checkRateLimit(event, { endpoint, limit, windowSeconds = 60 }) {
  try {
    const key = `${endpoint}:${clientIp(event)}`
    const { data, error } = await client().rpc('check_rate_limit', {
      p_key: key,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    })
    // TEMP DEBUG — remove after diagnosing limiter
    console.log('[rate-limit][debug] key=%s host=%s data=%j err=%s',
      key,
      (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'NONE').replace(/^https?:\/\//, ''),
      data, error?.message || 'none')
    if (error) {
      console.error('[rate-limit] RPC error (failing open):', error.message)
      return { allowed: true }
    }
    return { allowed: data === true }
  } catch (e) {
    console.error('[rate-limit] Exception (failing open):', e?.message)
    return { allowed: true }
  }
}

/** Standard 429 response body. Pass the function's existing CORS headers. */
export function tooManyRequests(headers = {}) {
  return {
    statusCode: 429,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ error: 'Too many requests. Please slow down and try again shortly.' }),
  }
}
