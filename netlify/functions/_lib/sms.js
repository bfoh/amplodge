/**
 * SMS through Arkesel (V1), as send-sms.js does it, for functions that run on their own
 * (scheduled ones). The API key never reaches a log.
 */

/** A Ghana number in Arkesel's form (233…), or null. */
export function ghanaNumber(phone) {
  let n = String(phone ?? '').replace(/[^\d]/g, '')
  if (n.startsWith('0')) n = '233' + n.slice(1)
  if (!n.startsWith('233') && n.length === 9) n = '233' + n
  return n.length >= 11 && n.length <= 15 ? n : null
}

/** Sends one SMS. Resolves { ok, error }; never throws for a refused message. */
export async function sendSms(to, message, fetchImpl = fetch) {
  const apiKey = process.env.ARKESEL_API_KEY ? process.env.ARKESEL_API_KEY.trim() : ''
  if (!apiKey) return { ok: false, error: 'SMS is not set up on the server (ARKESEL_API_KEY).' }
  const recipient = ghanaNumber(to)
  if (!recipient) return { ok: false, error: 'Not a phone number SMS can go to.' }
  const params = new URLSearchParams({ action: 'send-sms', api_key: apiKey, to: recipient, from: process.env.ARKESEL_SENDER_ID || 'AMPLodge', sms: message })
  try {
    const res = await fetchImpl(`https://sms.arkesel.com/sms/api?${params.toString()}`)
    const text = await res.text()
    const ok = res.ok && !/error|invalid/i.test(text)
    return { ok, error: ok ? null : String(text).replaceAll(apiKey, '***').slice(0, 200) }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'The SMS service could not be reached.' }
  }
}
