import { useEffect, useState } from 'react'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useCurrency } from '@/hooks/use-currency'
import { formatCurrencySync } from '@/lib/utils'
import { CHARGE_METHODS, chargeCardFee, loadKeyCardSettings, type ChargeMethod } from '@/services/key-card-stay'

/**
 * Offers the hotel's key card fee (Settings → Door locks) for cards a guest kept or
 * lost. Staff add it or skip it; with no fee set, nothing shows.
 */
export function CardFeeOffer({ bookingId, why, cards, stillStaying }: {
  bookingId: string
  why: 'kept' | 'lost'
  cards: number
  /** The guest is checked in: the fee can go on their bill. */
  stillStaying: boolean
}) {
  const { currency } = useCurrency()
  const [fee, setFee] = useState<number | null>(null)
  const [method, setMethod] = useState<ChargeMethod>(stillStaying ? 'pay_later' : 'cash')
  const [state, setState] = useState<'offer' | 'saving' | 'charged' | 'skipped'>('offer')
  const [error, setError] = useState<string | null>(null)
  const [charged, setCharged] = useState(0)

  useEffect(() => {
    let alive = true
    loadKeyCardSettings().then((s) => { if (alive) setFee(s.fee) }, () => { if (alive) setFee(null) })
    return () => { alive = false }
  }, [])

  if (!fee || state === 'skipped' || cards < 1) return null
  const owed = Math.max(0, cards - charged)
  if (state === 'charged' && owed === 0) {
    return (
      <p className="flex items-start gap-2 text-sm text-emerald-800">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />The card fee ({formatCurrencySync(fee * charged, currency)}) is on the booking.
      </p>
    )
  }

  async function charge() {
    setState('saving')
    setError(null)
    try {
      await chargeCardFee({ bookingId, fee: fee!, cards: owed, why, method })
      setCharged((c) => c + owed)
      setState('charged')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The charge could not be added.')
      setState('offer')
    }
  }

  const methods = CHARGE_METHODS.filter((m) => stillStaying || m.value !== 'pay_later')
  return (
    <div className="space-y-2 rounded-lg border p-3 text-sm">
      <p>
        {why === 'kept'
          ? `${owed === 1 ? 'A card' : `${owed} cards`} the guest kept`
          : `${owed === 1 ? 'A lost card' : `${owed} lost cards`}`}: charge the card fee of {formatCurrencySync(fee * owed, currency)}?
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={method} onValueChange={(v) => setMethod(v as ChargeMethod)}>
          <SelectTrigger className="h-9 w-48" aria-label="How the fee is paid"><SelectValue /></SelectTrigger>
          <SelectContent>
            {methods.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button size="sm" disabled={state === 'saving'} onClick={() => void charge()}>
          {state === 'saving' && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Add the charge
        </Button>
        <Button size="sm" variant="ghost" disabled={state === 'saving'} onClick={() => setState('skipped')}>No charge</Button>
      </div>
      {error && <p className="text-red-700">{error}</p>}
    </div>
  )
}
