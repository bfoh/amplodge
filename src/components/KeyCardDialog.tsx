import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, CircleDashed, CreditCard, KeyRound, Loader2, XCircle } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { subscribeKeyCardPrompt, type KeyCardRequest } from '@/services/key-card-prompt'
import { getEncoderPc, prepareKeyCards, writeKeyCard, type CardResult, type PreparedCards } from '@/services/lock-bridge'

type Step =
  | { kind: 'choose' }
  | { kind: 'elsewhere' }
  | { kind: 'preparing' }
  | { kind: 'error'; message: string }
  | { kind: 'card'; index: number }
  | { kind: 'writing'; index: number }
  | { kind: 'done' }

/** Hotel time: Ghana is on GMT all year, so show UTC whatever the PC's own zone. */
const hotelTime = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/**
 * "Make key cards" after a check-in, or from the Key cards page. Mounted once at
 * the app root. On the reception PC it walks staff through each card: lay it on
 * the encoder, write it, take it off. Elsewhere it only says where cards are made.
 */
export function KeyCardDialog() {
  const [request, setRequest] = useState<KeyCardRequest | null>(null)
  const [step, setStep] = useState<Step>({ kind: 'choose' })
  const [count, setCount] = useState(1)
  const [prepared, setPrepared] = useState<PreparedCards | null>(null)
  const [results, setResults] = useState<Record<number, CardResult>>({})
  const closed = useRef<(() => void) | null>(null)

  useEffect(() => {
    subscribeKeyCardPrompt((req, onClosed) => {
      closed.current?.()
      closed.current = onClosed
      setRequest(req)
      setCount(1)
      setPrepared(null)
      setResults({})
      setStep(getEncoderPc() ? { kind: 'choose' } : { kind: 'elsewhere' })
    })
    return () => subscribeKeyCardPrompt(null)
  }, [])

  const busy = step.kind === 'preparing' || step.kind === 'writing'

  function close() {
    if (busy) return
    setRequest(null)
    const done = closed.current
    closed.current = null
    done?.()
  }

  async function prepare(n: number) {
    if (!request) return
    setStep({ kind: 'preparing' })
    try {
      const p = await prepareKeyCards(request.bookingId, n)
      setPrepared(p)
      setResults({})
      setStep({ kind: 'card', index: 0 })
    } catch (e) {
      setStep({ kind: 'error', message: e instanceof Error ? e.message : 'Could not prepare the key cards.' })
    }
  }

  async function write(index: number) {
    if (!prepared) return
    const cardNo = prepared.cardNos[index]
    setStep({ kind: 'writing', index })
    let result: CardResult
    try {
      result = await writeKeyCard(prepared, cardNo)
    } catch (e) {
      result = { outcome: 'failed', error: e instanceof Error ? e.message : 'The lock bridge could not be reached.' }
    }
    setResults((r) => ({ ...r, [cardNo]: result }))
    if (result.outcome === 'issued' || result.outcome === 'unknown') {
      if (result.outcome === 'issued' && index + 1 >= prepared.cardNos.length) setStep({ kind: 'done' })
      else setStep({ kind: 'card', index: result.outcome === 'issued' ? index + 1 : index })
    } else {
      setStep({ kind: 'card', index })
    }
  }

  function next(index: number) {
    if (!prepared) return
    if (index + 1 >= prepared.cardNos.length) setStep({ kind: 'done' })
    else setStep({ kind: 'card', index: index + 1 })
  }

  const room = prepared?.room ?? request?.roomNumber ?? '?'
  const guest = prepared?.guest ?? request?.guestName ?? 'Guest'
  const made = prepared ? prepared.cardNos.filter((n) => results[n]?.outcome === 'issued').length : 0
  const remaining = prepared ? prepared.cardNos.length - made : count

  const summary = prepared && (
    <div className="rounded-lg border bg-muted/40 p-3 text-sm">
      <div className="font-semibold">Room {room} · {guest}</div>
      <div className="text-muted-foreground">Opens the door until <span className="font-medium text-foreground">{hotelTime(prepared.validUntil)}</span></div>
      {prepared.capped && <div className="mt-1 text-amber-700">The stay is longer than a card may run, so these cards stop sooner. Make new ones before then.</div>}
      <ul className="mt-2 space-y-1">
        {prepared.cardNos.map((n, i) => {
          const r = results[n]
          const current = (step.kind === 'card' || step.kind === 'writing') && step.index === i
          const icon = r?.outcome === 'issued' ? <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            : r?.outcome === 'unknown' ? <AlertTriangle className="h-4 w-4 text-amber-600" />
            : r ? <XCircle className="h-4 w-4 text-red-600" />
            : current && step.kind === 'writing' ? <Loader2 className="h-4 w-4 animate-spin" />
            : <CircleDashed className="h-4 w-4 text-muted-foreground" />
          const label = r?.outcome === 'issued' ? 'done' : r?.outcome === 'unknown' ? 'check at the door' : r ? 'not written' : current ? 'next' : ''
          return (
            <li key={n} className={`flex items-center gap-2 ${current ? 'font-medium' : ''}`}>
              {icon} Card {i + 1}{label && <span className="text-muted-foreground font-normal">· {label}</span>}
            </li>
          )
        })}
      </ul>
    </div>
  )

  let body: ReactNode = null
  let footer: ReactNode = null

  switch (step.kind) {
    case 'elsewhere':
      body = (
        <p className="text-sm text-muted-foreground">
          Key cards are made at the reception PC with the card encoder. Room {room} is listed on the{' '}
          <Link to="/staff/key-cards" className="underline" onClick={close}>Key cards page</Link> until it has one.
        </p>
      )
      footer = <Button onClick={close}>OK</Button>
      break

    case 'choose':
      body = (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">How many cards for {guest}?</p>
          <div className="flex gap-2" role="radiogroup" aria-label="Number of cards">
            {[1, 2, 3, 4].map((n) => (
              <Button key={n} type="button" role="radio" aria-checked={count === n} variant={count === n ? 'default' : 'outline'} className="w-12" onClick={() => setCount(n)}>
                {n}
              </Button>
            ))}
          </div>
        </div>
      )
      footer = (
        <>
          <Button variant="outline" onClick={close}>Not now</Button>
          <Button onClick={() => void prepare(count)}><CreditCard className="mr-2 h-4 w-4" />Make {count === 1 ? 'the card' : `${count} cards`}</Button>
        </>
      )
      break

    case 'preparing':
      body = <p className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" /> Getting the card details…</p>
      break

    case 'error':
      body = <p className="text-sm text-red-700">{step.message}</p>
      footer = (
        <>
          <Button variant="outline" onClick={close}>Close</Button>
          <Button onClick={() => void prepare(remaining)}>Try again</Button>
        </>
      )
      break

    case 'card': {
      const cardNo = prepared!.cardNos[step.index]
      const last = results[cardNo]
      body = (
        <div className="space-y-3">
          {summary}
          {last?.outcome === 'unknown' ? (
            <p className="text-sm text-amber-800">{last.error ?? 'Writing was cut off.'} It is listed under "Check these cards" on the Key cards page.</p>
          ) : last?.outcome === 'expired' || last?.outcome === 'refused' ? (
            <p className="text-sm text-amber-800">
              {last.outcome === 'expired' ? 'This took a while, so the order ran out.' : last.error ?? 'The lock bridge would not take this order.'}{' '}
              Start again for the cards still to make.
            </p>
          ) : (
            <>
              {last && <p className="text-sm text-red-700">{last.error ?? 'The card was not written.'}</p>}
              {step.index > 0 && !last && <p className="text-sm text-muted-foreground">Take the finished card off the encoder.</p>}
              <p className="text-sm font-medium">Lay card {step.index + 1} of {prepared!.cardNos.length} flat on the encoder.</p>
            </>
          )}
        </div>
      )
      footer = last?.outcome === 'unknown' ? (
        <>
          <Button variant="outline" onClick={close}>Close</Button>
          {step.index + 1 < prepared!.cardNos.length && <Button onClick={() => next(step.index)}>Go on to card {step.index + 2}</Button>}
        </>
      ) : last?.outcome === 'expired' || last?.outcome === 'refused' ? (
        <>
          <Button variant="outline" onClick={close}>Close</Button>
          <Button onClick={() => void prepare(remaining)}>Start again</Button>
        </>
      ) : (
        <>
          <Button variant="outline" onClick={close}>Stop</Button>
          <Button onClick={() => void write(step.index)}><KeyRound className="mr-2 h-4 w-4" />{last ? 'Try again' : `Write card ${step.index + 1}`}</Button>
        </>
      )
      break
    }

    case 'writing':
      body = (
        <div className="space-y-3">
          {summary}
          <p className="flex items-center gap-2 text-sm font-medium"><Loader2 className="h-4 w-4 animate-spin" /> Writing card {step.index + 1}. Keep it on the encoder.</p>
        </div>
      )
      break

    case 'done':
      body = (
        <div className="space-y-3">
          {summary}
          <p className="text-sm">{made === 1 ? 'The card is' : `All ${made} cards are`} ready. Take {made === 1 ? 'it' : 'the last one'} off the encoder.</p>
        </div>
      )
      footer = <Button onClick={close}>Done</Button>
      break
  }

  return (
    <Dialog open={!!request} onOpenChange={(open) => { if (!open) close() }}>
      <DialogContent
        className="sm:max-w-md"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => { if (busy) e.preventDefault() }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><KeyRound className="h-5 w-5 text-primary" />Key cards for room {room}</DialogTitle>
          <DialogDescription>{step.kind === 'elsewhere' ? 'This device cannot write key cards.' : guest}</DialogDescription>
        </DialogHeader>
        {body}
        {footer && <DialogFooter className="gap-2 sm:gap-0">{footer}</DialogFooter>}
      </DialogContent>
    </Dialog>
  )
}
