/**
 * Device fingerprint for attendance device-binding.
 *
 * Composite SHA-256 hash of stable browser/device signals plus a persisted
 * random salt. Truncated to 16 hex chars to keep it readable in admin UIs.
 *
 * The persisted salt makes the fingerprint stable across normal sessions but
 * resettable by clearing localStorage. This is intentional — we want a
 * fingerprint that survives reloads but doesn't try to defeat a determined
 * user clearing their storage (admin reset is the trust anchor for that case).
 */

const SALT_KEY = 'amp_device_salt'

function getOrCreateSalt(): string {
  try {
    let s = localStorage.getItem(SALT_KEY)
    if (!s) {
      const bytes = new Uint8Array(16)
      crypto.getRandomValues(bytes)
      s = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
      localStorage.setItem(SALT_KEY, s)
    }
    return s
  } catch {
    // Private mode or storage blocked — degrade to non-persistent salt
    return 'volatile-' + Math.random().toString(36).slice(2)
  }
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const buf = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')
}

function describeDevice(): string {
  const ua = navigator.userAgent
  const platform =
    /iPhone|iPad/.test(ua) ? 'iPhone'
    : /Android/.test(ua) ? 'Android'
    : /Mac/.test(ua) ? 'Mac'
    : /Windows/.test(ua) ? 'Windows'
    : /Linux/.test(ua) ? 'Linux'
    : 'Device'
  const browser =
    /Edg\//.test(ua) ? 'Edge'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /Safari\//.test(ua) ? 'Safari'
    : 'Browser'
  return `${platform} · ${browser}`
}

export async function getDeviceFingerprint(): Promise<{ fp: string; label: string }> {
  const parts = [
    navigator.userAgent,
    `${screen.width}x${screen.height}@${window.devicePixelRatio || 1}`,
    Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown-tz',
    String(navigator.hardwareConcurrency || 0),
    getOrCreateSalt(),
  ].join('|')
  const hash = await sha256Hex(parts)
  return { fp: hash.slice(0, 16), label: describeDevice() }
}
