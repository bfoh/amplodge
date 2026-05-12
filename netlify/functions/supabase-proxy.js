/**
 * Supabase Proxy Function
 *
 * Called by the Supabase client's custom fetch override in production.
 * The client rewrites Supabase URLs to:
 *   /.netlify/functions/supabase-proxy?_sbpath=/auth/v1/token&grant_type=password
 *
 * This function extracts _sbpath, strips it from the query, and forwards
 * the request to Supabase server-to-server, bypassing geographic routing
 * issues (e.g. Ghana → Ireland direct connections timing out).
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer, x-upsert',
}

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers: CORS_HEADERS, body: '' }
    }

    try {
        // Extract the supabase path from _sbpath query param
        const rawQuery = event.rawQuery || ''
        const sbpathMatch = rawQuery.match(/(?:^|&)_sbpath=([^&]*)/)
        const supabasePath = sbpathMatch ? decodeURIComponent(sbpathMatch[1]) : '/'
        
        // Forward everything except _sbpath
        const forwardQuery = rawQuery
            .replace(/^_sbpath=[^&]*(&|$)/, '$1')
            .replace(/&_sbpath=[^&]*/, '')
            .replace(/^&/, '')

        const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY

        if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
            console.error('[supabase-proxy] Missing configuration: URL or ANON_KEY not found in environment.')
            return {
                statusCode: 500,
                headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
                body: JSON.stringify({ error: 'Server configuration error', message: 'Missing environment variables' }),
            }
        }

        const targetUrl = `${SUPABASE_URL}${supabasePath}${forwardQuery ? '?' + forwardQuery : ''}`

        console.log(`[supabase-proxy] ${event.httpMethod} ${supabasePath}`)

        // Build forwarded headers
        const forwardHeaders = {}
        if (event.headers['content-type'])   forwardHeaders['content-type']   = event.headers['content-type']
        
        // Forward the apikey from the client, or fallback to the server-side key.
        // This fallback fixes the "Invalid API key" error when headers are stripped by middleboxes.
        // We also check for 'null' or 'undefined' strings which can happen if client-side extraction fails.
        const providedKey = event.headers['apikey'] || event.headers['apiKey']
        const isValidKey = providedKey && providedKey !== 'undefined' && providedKey !== 'null'
        forwardHeaders['apikey'] = isValidKey ? providedKey : SUPABASE_ANON_KEY
        
        if (event.headers['authorization'])   forwardHeaders['authorization']   = event.headers['authorization']
        if (event.headers['x-client-info'])   forwardHeaders['x-client-info']   = event.headers['x-client-info']
        if (event.headers['prefer'])          forwardHeaders['prefer']          = event.headers['prefer']
        if (event.headers['x-upsert'])        forwardHeaders['x-upsert']        = event.headers['x-upsert']

        // Forward the real client IP so Supabase rate-limits per-user not per-proxy.
        const clientIp = event.headers['x-nf-client-connection-ip']
            || event.headers['x-forwarded-for']?.split(',')[0]?.trim()
            || event.headers['client-ip']
        if (clientIp) {
            forwardHeaders['x-forwarded-for'] = clientIp
            forwardHeaders['x-real-ip'] = clientIp
        }

        const fetchOptions = { method: event.httpMethod, headers: forwardHeaders }

        if (event.body && event.httpMethod !== 'GET' && event.httpMethod !== 'HEAD') {
            fetchOptions.body = event.isBase64Encoded
                ? Buffer.from(event.body, 'base64').toString('utf-8')
                : event.body
        }

        const response = await fetch(targetUrl, fetchOptions)
        const responseBody = await response.text()

        const responseHeaders = { ...CORS_HEADERS }
        const ct = response.headers.get('content-type')
        if (ct) responseHeaders['Content-Type'] = ct
        const wa = response.headers.get('www-authenticate')
        if (wa) responseHeaders['WWW-Authenticate'] = wa

        return { statusCode: response.status, headers: responseHeaders, body: responseBody }
    } catch (error) {
        console.error('[supabase-proxy] Error:', error.message)
        return {
            statusCode: 502,
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Proxy error', message: error.message }),
        }
    }
}
