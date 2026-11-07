import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, CircleDashed, CreditCard, KeyRound, Loader2, XCircle } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { subscribeKeyCardPrompt, type KeyCardRequest } from '@/services/key-card-prompt'
import { getEncoderPc, prepareKeyCards, prepareLockoutCard, writeKeyCard, type CardResult, type PreparedCards } from '@/services/lock-bridge'

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
 * It also makes lock-out cards (request.lockoutRoomId): one card per door, to be
 * held to the lock once so that it refuses every older card.
 */
export function KeyCardDialog() {
  const [request, setRequest] = useState<KeyCardRequest | null>(null)
  const [step, setStep] = useState<Step>({ kind: 'choose' })
  const [count, setCount] = useState(1)
  const [prepared, setPrepared] = useState<PreparedCards | null>(null)
  const [results, setResults] = useState<Record<number, CardResult>>({})
  const closed = useRef<(() => void) | null>(null)
  // A lost card replaces the stay's cards once; a retry after that adds to the new set.
  const replaced = useRef(false)

  useEffect(() => {
    subscribeKeyCardPrompt((req, onClosed) => {
      closed.current?.()
      closed.current = onClosed
      setRequest(req)
      setCount(1)
      setPrepared(null)
      setResults({})
      replaced.current = false
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
    const replacing = !!request.replace && !replaced.current
    try {
      const p = request.lockoutRoomId ? await prepareLockoutCard(request.lockoutRoomId) : await prepareKeyCards(request.bookingId, n, replacing)
      if (replacing) replaced.current = true
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

  const lockout = !!request?.lockoutRoomId
  const room = prepared?.room ?? request?.roomNumber ?? '?'
  const guest = lockout ? 'Lock-out card' : prepared?.guest ?? request?.guestName ?? 'Guest'
  const made = prepared ? prepared.cardNos.filter((n) => results[n]?.outcome === 'issued').length : 0
  const remaining = prepared ? prepared.cardNos.length - made : count

  const summary = prepared && (
    <div className="rounded-lg border bg-muted/40 p-3 text-sm">
      <div className="font-semibold">Room {room} · {guest}</div>
      <div className="text-muted-foreground">{lockout ? 'Works' : 'Opens the door'} until <span className="font-medium text-foreground">{hotelTime(prepared.validUntil)}</span></div>
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
      if (lockout) {
        body = (
          <div className="space-y-3 text-sm">
            <p>
              Door locks are not connected to anything: a lock only learns from the cards held to it. A lock-out card tells
              room {room}'s lock to refuse every older card: guest cards from before, cards nobody returned, cards made in
              Joney's program.
            </p>
            <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
              <li>Write the card here.</li>
              <li>Take it to room {room} and hold it to the lock once. The door opens.</li>
              <li>From then on the lock refuses the older cards. The lock-out card stops working by itself a few minutes later.</li>
            </ol>
          </div>
        )
        footer = (
          <>
            <Button variant="outline" onClick={close}>Not now</Button>
            <Button onClick={() => void prepare(1)}><CreditCard className="mr-2 h-4 w-4" />Make the lock-out card</Button>
          </>
        )
        break
      }
      body = (
        <div className="space-y-3">
          {request?.replace && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              A lost card: the new cards replace every card of this stay. Once one of them opens the door, the old ones stop working there, including any the guest still has.
            </p>
          )}
          <p className="text-sm text-muted-foreground">How many {request?.replace ? 'new cards' : 'cards'} for {guest}?</p>
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
          {lockout ? (
            <p className="text-sm">
              Ready. Take {made === 1 ? 'it' : 'them'} to room {room} now and hold {made === 1 ? 'it to the lock' : 'each to its door\'s lock'} once.
              From then on the lock refuses every older card. {made === 1 ? 'It stops working by itself' : 'They stop working by themselves'} at {hotelTime(prepared!.validUntil)}.
            </p>
          ) : (
            <p className="text-sm">{made === 1 ? 'The card is' : `All ${made} cards are`} ready. Take {made === 1 ? 'it' : 'the last one'} off the encoder.</p>
          )}
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
          <DialogTitle className="flex items-center gap-2"><KeyRound className="h-5 w-5 text-primary" />{lockout ? 'Lock-out card' : 'Key cards'} for room {room}</DialogTitle>
          <DialogDescription>{step.kind === 'elsewhere' ? 'This device cannot write key cards.' : guest}</DialogDescription>
        </DialogHeader>
        {body}
        {footer && <DialogFooter className="gap-2 sm:gap-0">{footer}</DialogFooter>}
      </DialogContent>
    </Dialog>
  )
}
