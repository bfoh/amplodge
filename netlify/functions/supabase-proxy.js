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

        const targetUrl = `${SUPABASE_URL}${supabasePath}${forwardQuery ? '?' + forwardQuery : ''}`

        console.log(`[supabase-proxy] ${event.httpMethod} ${supabasePath}`)

        // Build forwarded headers
        const forwardHeaders = {}
        if (event.headers['content-type'])   forwardHeaders['content-type']   = event.headers['content-type']
        if (event.headers['apikey'])          forwardHeaders['apikey']          = event.headers['apikey']
        if (event.headers['authorization'])   forwardHeaders['authorization']   = event.headers['authorization']
        if (event.headers['x-client-info'])   forwardHeaders['x-client-info']   = event.headers['x-client-info']
        if (event.headers['prefer'])          forwardHeaders['prefer']          = event.headers['prefer']
        if (event.headers['x-upsert'])        forwardHeaders['x-upsert']        = event.headers['x-upsert']

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
