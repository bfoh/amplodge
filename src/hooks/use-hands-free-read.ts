import { useEffect, useRef, useState } from 'react'
import { bridgeStatus, canWaitForCards, getEncoderPc, readCard, type CardReading } from '@/services/lock-bridge'

/**
 * Hands-free reading at the reception PC: a card laid on the encoder is read without a click
 * (lock bridge 0.1.3 and later; older bridges keep the Read button only).
 *
 * Only one part of the page listens at a time: the one that opened last (a dialog over the
 * Key cards page). A dialog that writes cards claims the encoder too, so nothing underneath
 * reads the blank card laid down for it. After a card is handled, the next one is read only
 * once the first has been lifted, so one card is never handled twice.
 */

const claims: symbol[] = []
const watchers = new Set<() => void>()
const changed = () => watchers.forEach((w) => w())

function useClaim(active: boolean): boolean {
  const [id] = useState(() => Symbol('encoder'))
  const [top, setTop] = useState(false)
  useEffect(() => {
    if (!active) return
    claims.push(id)
    const watch = () => setTop(claims[claims.length - 1] === id)
    watchers.add(watch)
    changed()
    return () => {
      watchers.delete(watch)
      claims.splice(claims.indexOf(id), 1)
      setTop(false)
      changed()
    }
  }, [active, id])
  return active && top
}

/** For a dialog that writes cards: while it is open, no hands-free reading underneath it. */
export function useEncoderClaim(active: boolean) {
  useClaim(active)
}

// One status check serves every dialog for a minute.
let known: { at: number; ok: boolean } | null = null
async function bridgeCanWait(): Promise<boolean> {
  if (!getEncoderPc()) return false
  if (known && Date.now() - known.at < 60_000) return known.ok
  const ok = await bridgeStatus().then((s) => s.paired && canWaitForCards(s.version), () => false)
  known = { at: Date.now(), ok }
  return ok
}

const pause = (ms: number, signal: AbortSignal) => new Promise<void>((resolve) => {
  const t = window.setTimeout(resolve, ms)
  signal.addEventListener('abort', () => { window.clearTimeout(t); resolve() }, { once: true })
})

export interface HandsFree {
  /** A card laid on the encoder now is read by itself. */
  listening: boolean
  /** The encoder cannot be read just now (e.g. Joney's program is closed), in words for staff. */
  problem: string | null
  /** This PC's lock bridge can read hands-free (0.1.3 and later). */
  supported: boolean
}

/** What onCard may answer: "again" when the card is not done with (a blank waiting to be written in Joney's program), so it is looked at again without being lifted. */
export type HandsFreeAnswer = void | 'again'

/**
 * Reads each card laid on the encoder while `open`, and hands it to onCard. `open` is the
 * dialog (or panel) being up; a new opening starts afresh. `paused` is its own work in
 * progress (writing, saving, a read from its button, a card waiting for a click): nothing
 * is read meanwhile, and afterwards the next card is read only once the one on the encoder
 * has been lifted.
 */
export function useHandsFreeRead(open: boolean, paused: boolean, onCard: (reading: CardReading) => HandsFreeAnswer | Promise<HandsFreeAnswer>): HandsFree {
  const onTop = useClaim(open)
  const [supported, setSupported] = useState(false)
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || document.visibilityState !== 'hidden')
  const [problem, setProblem] = useState<string | null>(null)
  const handler = useRef(onCard)
  handler.current = onCard
  const pausedNow = useRef(paused)
  pausedNow.current = paused
  // The card on the encoder has been dealt with: wait for it to be lifted before the next.
  const lift = useRef(false)

  useEffect(() => {
    lift.current = false
    setProblem(null)
    let alive = true
    void bridgeCanWait().then((ok) => { if (alive) setSupported(ok) })
    return () => { alive = false }
  }, [open])

  useEffect(() => {
    const seen = () => setVisible(document.visibilityState !== 'hidden')
    document.addEventListener('visibilitychange', seen)
    return () => document.removeEventListener('visibilitychange', seen)
  }, [])

  const active = open && onTop && supported && visible

  useEffect(() => {
    if (!active) return
    const stop = new AbortController()
    const { signal } = stop
    const untilFree = async () => { while (pausedNow.current && !signal.aborted) await pause(150, signal) }
    let listened = false

    void (async () => {
      while (!signal.aborted) {
        try {
          if (pausedNow.current) {
            await untilFree()
            // Busy after listening: a card was read or written meanwhile, and may still lie there.
            if (listened) lift.current = true
            continue
          }
          listened = true
          if (lift.current) {
            const r = await readCard({ waitFor: 'removed', signal })
            if (signal.aborted) return
            if (r.noCard || r.kind !== 'none') setProblem(null)
            if (pausedNow.current || r.timedOut) continue
            lift.current = false
            if (!r.noCard && r.kind === 'none') { setProblem(r.message || 'The encoder could not be read.'); await pause(5000, signal) }
            continue
          }
          let r = await readCard({ waitFor: 'card', signal })
          if (signal.aborted) return
          if (r.noCard || r.kind !== 'none') setProblem(null)
          if (pausedNow.current || r.timedOut) continue
          if (r.kind === 'none') {
            // Not "no card": the encoder has a problem. Say so, and look again shortly.
            setProblem(r.message || 'The encoder could not be read.')
            await pause(5000, signal)
            continue
          }
          // A card half laid down can read as unreadable: give it a moment, then look again.
          if (r.kind === 'unknown') {
            await pause(700, signal)
            if (signal.aborted) return
            r = await readCard({ signal })
            if (signal.aborted || pausedNow.current || r.kind === 'none') continue
          }
          lift.current = true
          const answer = await handler.current(r)
          // The handler's own busy spell ends with it: that is not someone else's read.
          await untilFree()
          if (answer === 'again') { lift.current = false; await pause(1000, signal) }
        } catch (e) {
          if (signal.aborted) return
          setProblem(e instanceof Error ? e.message : 'The lock bridge could not be reached.')
          await pause(5000, signal)
        }
      }
    })()
    return () => stop.abort()
  }, [active])

  const listening = active && !paused
  return { listening, problem: listening ? problem : null, supported }
}
