/**
 * Kiosk QR display — fullscreen, self-rotating staff clock-in code for a
 * dedicated screen at the hotel entrance (tablet / spare phone / monitor).
 *
 * Deliberately shows NOTHING else: no dashboard, no navigation, no data.
 * The page still requires an admin session (the get_clock_token RPC is
 * admin-only), but leaving it open at reception exposes no controls.
 *
 * Route: /staff/qr-display (owner/admin only, outside AppLayout).
 */

import { QRCodeSVG } from 'qrcode.react'
import { Loader2 } from 'lucide-react'
import { useClockToken } from '@/hooks/use-clock-token'
import { buildClockUrl } from '@/services/attendance-service'

export function QRDisplayPage() {
  const { token, secondsLeft, windowSecs, error } = useClockToken()
  const url = token ? buildClockUrl(token) : ''
  const pct = windowSecs > 0 ? Math.max(0, Math.min(100, (secondsLeft / windowSecs) * 100)) : 0

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center gap-8 p-8 select-none">
      <div className="text-center space-y-1">
        <h1 className="text-3xl font-bold tracking-tight">AMP Lodge — Staff Clock-In</h1>
        <p className="text-muted-foreground">Scan with your phone camera to clock in or out</p>
      </div>

      <div className="bg-white p-6 rounded-2xl border-2 shadow-sm">
        {token ? (
          <QRCodeSVG value={url} size={380} level="M" style={{ width: 'min(70vw, 380px)', height: 'auto' }} />
        ) : (
          <div className="w-[min(70vw,380px)] aspect-square flex items-center justify-center">
            <Loader2 className="w-10 h-10 animate-spin text-muted-foreground" />
          </div>
        )}
      </div>

      <div className="w-full max-w-md space-y-2">
        <div className="h-2.5 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-[width] duration-1000 ease-linear"
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="text-center text-sm text-muted-foreground">
          {error ? error : `New code in ${secondsLeft}s`}
        </p>
      </div>
    </div>
  )
}
