import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { bridgeStatus, getEncoderPc } from '@/services/lock-bridge'

type Tone = 'ok' | 'warn' | 'bad'
interface Shown { tone: Tone; text: string; detail: string }

const DOT: Record<Tone, string> = { ok: 'bg-emerald-500', warn: 'bg-amber-500', bad: 'bg-red-500' }
const RING: Record<Tone, string> = {
  ok: 'border-emerald-200 text-emerald-800',
  warn: 'border-amber-300 text-amber-900 bg-amber-50',
  bad: 'border-red-300 text-red-800 bg-red-50',
}

/**
 * The card encoder's state, in the staff header of the reception PC only (the
 * PC paired in Settings → Door locks). A problem shows before someone needs a
 * card, not when a guest is waiting. Links to the Key cards page.
 */
export function EncoderStatusPill({ compact = false }: { compact?: boolean }) {
  const [pc] = useState(() => getEncoderPc())
  const [shown, setShown] = useState<Shown | null>(null)

  useEffect(() => {
    if (!pc) return
    let alive = true
    const check = async () => {
      try {
        const s = await bridgeStatus()
        if (!alive) return
        setShown(s.revoked ? { tone: 'bad', text: 'PC unpaired', detail: 'This PC was removed in Settings. An admin can pair it again.' }
          : !s.encoder.ready ? { tone: 'warn', text: 'Encoder not ready', detail: s.encoder.message }
          : s.unsentResults > 0 ? { tone: 'warn', text: `${s.unsentResults} unsent`, detail: `Encoder ready. ${s.unsentResults} card result(s) are still to reach the server.` }
          : { tone: 'ok', text: 'Encoder ready', detail: `This PC makes key cards (lock bridge ${s.version}).` })
      } catch (e) {
        if (alive) setShown({ tone: 'bad', text: 'Lock bridge off', detail: e instanceof Error ? e.message : 'The lock bridge could not be reached.' })
      }
    }
    void check()
    const timer = window.setInterval(() => void check(), 60_000)
    const onFocus = () => void check()
    window.addEventListener('focus', onFocus)
    return () => { alive = false; window.clearInterval(timer); window.removeEventListener('focus', onFocus) }
  }, [pc])

  if (!pc || !shown) return null
  return (
    <Link
      to="/staff/key-cards"
      title={shown.detail}
      aria-label={`Card encoder: ${shown.text}. ${shown.detail}`}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium hover:opacity-80 ${RING[shown.tone]}`}
    >
      <span className={`h-2 w-2 rounded-full ${DOT[shown.tone]}`} aria-hidden="true" />
      {compact ? (shown.tone === 'ok' ? null : shown.text) : shown.text}
    </Link>
  )
}
