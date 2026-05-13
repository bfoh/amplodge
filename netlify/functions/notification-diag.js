/**
 * Notification provider diagnostic.
 *
 * Verifies that RESEND_API_KEY + ARKESEL_API_KEY are present and accepted by
 * the upstream APIs **without** spending a real email or SMS send. The Resend
 * check hits GET /api-keys; the Arkesel check hits GET /v3/balance. Both
 * return 200 on a valid key and 401/403 on a bad one.
 *
 * Admin-only. The point of this endpoint is to verify production config when
 * a "notification failed" toast surfaces; staff don't need to reach it.
 */

import { requireAdmin, jsonResponse, handleCors } from './_lib/auth.js'

export const handler = async (event) => {
  const corsResp = handleCors(event); if (corsResp) return corsResp

  if (event.httpMethod !== 'GET') {
    return jsonResponse(405, { error: 'Method not allowed' })
  }

  try {
    await requireAdmin(event)
  } catch (e) {
    return jsonResponse(e.status, e.body)
  }

  const result = {
    resend: await checkResend(),
    arkesel: await checkArkesel(),
    serverTime: new Date().toISOString(),
  }

  return jsonResponse(200, result)
}

async function checkResend() {
  const key = process.env.RESEND_API_KEY || process.env.VITE_RESEND_API_KEY
  if (!key) {
    return { ok: false, error: 'RESEND_API_KEY env var not set on the server', keyConfigured: false }
  }
  try {
    // GET /api-keys returns 200 with a list when the key is valid; 401/403 otherwise.
    const r = await fetch('https://api.resend.com/api-keys', {
      headers: { Authorization: `Bearer ${key.trim()}` },
    })
    const body = await r.text()
    let parsed = null
    try { parsed = JSON.parse(body) } catch { /* ignore */ }

    if (r.ok) {
      return { ok: true, keyConfigured: true, status: r.status, keyCount: Array.isArray(parsed?.data) ? parsed.data.length : undefined }
    }
    return {
      ok: false,
      keyConfigured: true,
      status: r.status,
      error: parsed?.message || parsed?.error || body.slice(0, 200) || 'Resend rejected the key',
    }
  } catch (e) {
    return { ok: false, keyConfigured: true, error: e.message || 'Network error reaching Resend' }
  }
}

async function checkArkesel() {
  const key = process.env.ARKESEL_API_KEY
  if (!key) {
    return { ok: false, error: 'ARKESEL_API_KEY env var not set on the server', keyConfigured: false }
  }
  const senderId = process.env.ARKESEL_SENDER_ID || 'AMPLodge'

  try {
    // Arkesel v2 balance endpoint: returns 200 with balance JSON on a valid
    // key. Doesn't spend any SMS credits.
    const r = await fetch('https://sms.arkesel.com/api/v2/clients/balance-details', {
      headers: { 'api-key': key.trim() },
    })
    const body = await r.text()
    let parsed = null
    try { parsed = JSON.parse(body) } catch { /* ignore */ }

    if (r.ok) {
      return {
        ok: true,
        keyConfigured: true,
        senderId,
        status: r.status,
        balance: parsed?.data?.balance ?? parsed?.balance ?? undefined,
        currency: parsed?.data?.currency ?? parsed?.currency ?? undefined,
      }
    }
    return {
      ok: false,
      keyConfigured: true,
      senderId,
      status: r.status,
      error: parsed?.message || body.slice(0, 200) || 'Arkesel rejected the key',
    }
  } catch (e) {
    return { ok: false, keyConfigured: true, senderId, error: e.message || 'Network error reaching Arkesel' }
  }
}
