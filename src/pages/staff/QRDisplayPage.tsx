/**
 * Kiosk QR display — fullscreen, self-rotating staff clock-in code for a
 * dedicated screen at the hotel entrance (tablet / spare phone / monitor).
 *
 * Deliberately shows NOTHING else: no dashboard, no navigation, no data.
 *
 * Two modes:
 *  - KIOSK CREDENTIAL (preferred): open once with ?kiosk=<id>&key=<key> (from
 *    HR → Kiosks → "Provision kiosk"). The creds are saved to localStorage and
 *    stripped from the URL; the page then mints via the anon kiosk RPC and needs
 *    NO user session — so a public reception device holds no admin login.
 *  - ADMIN FALLBACK: opened without creds by a logged-in admin, it uses the
 *    admin-only mint (legacy behaviour).
 *
 * Route: /staff/qr-display (outside AppLayout).
 */

import { useMemo } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Loader2, AlertTriangle } from 'lucide-react'
import { useClockToken, type KioskCreds } from '@/hooks/use-clock-token'
import { buildClockUrl } from '@/services/attendance-service'

const KIOSK_STORAGE_KEY = 'amp_kiosk_creds'

/** Read kiosk creds from the URL (once), persist them, and scrub the URL so the
 *  key isn't left in the address bar / history. Falls back to any stored creds. */
function resolveKioskCreds(): KioskCreds | null {
  try {
    const params = new URLSearchParams(window.location.search)
    const id = params.get('kiosk')
    const key = params.get('key')
    if (id && key) {
      const creds = { id, key }
      window.localStorage.setItem(KIOSK_STORAGE_KEY, JSON.stringify(creds))
      params.delete('kiosk')
      params.delete('key')
      const clean = window.location.pathname + (params.toString() ? `?${params}` : '')
      window.history.replaceState(null, '', clean)
      return creds
    }
    const stored = window.localStorage.getItem(KIOSK_STORAGE_KEY)
    return stored ? (JSON.parse(stored) as KioskCreds) : null
  } catch {
    return null
  }
}

export function QRDisplayPage() {
  // Memoized so the creds reference is stable across renders (keeps the token
  // hook's rotation interval from resetting).
  const kioskCreds = useMemo(resolveKioskCreds, [])
  const { token, secondsLeft, windowSecs, error, detail, failures } = useClockToken(kioskCreds)
  const url = token ? buildClockUrl(token) : ''
  const pct = windowSecs > 0 ? Math.max(0, Math.min(100, (secondsLeft / windowSecs) * 100)) : 0

  // Fit both narrow portrait phones and short landscape tablets: cap by
  // viewport width AND height so the code never overflows the screen.
  const qrSize = 'min(70vw, 42vh, 380px)'

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center gap-6 p-6 pb-10 select-none">
      <div className="text-center space-y-1">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">AMP Lodge — Staff Clock-In</h1>
        <p className="text-sm sm:text-base text-muted-foreground">
          Scan with your phone camera to clock in or out
        </p>
      </div>

      <div className="bg-white p-4 sm:p-6 rounded-2xl border-2 shadow-sm">
        {token ? (
          <QRCodeSVG value={url} size={380} level="M" style={{ width: qrSize, height: 'auto' }} />
        ) : (
          <div style={{ width: qrSize, height: qrSize }} className="flex items-center justify-center">
            <Loader2 className="w-10 h-10 animate-spin text-muted-foreground" />
          </div>
        )}
      </div>

      <div className="w-full max-w-md space-y-2">
        <div className="h-2.5 rounded-full bg-muted overflow-hidden">
          <div
            className={`h-full rounded-full transition-[width] duration-1000 ease-linear ${error ? 'bg-amber-500' : 'bg-primary'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        {error ? (
          <div className="text-center space-y-1">
            <p className="text-sm text-amber-700 flex items-center justify-center gap-1.5">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              {error} {failures > 0 && `(attempt ${failures}, retry in ${secondsLeft}s)`}
            </p>
            {detail && failures >= 3 && (
              <p className="text-[11px] text-muted-foreground break-all px-4">{detail}</p>
            )}
          </div>
        ) : (
          <p className="text-center text-sm text-muted-foreground">New code in {secondsLeft}s</p>
        )}
      </div>
    </div>
  )
}
