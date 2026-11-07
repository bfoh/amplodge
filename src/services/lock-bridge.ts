/**
 * The lock bridge: a small app on the reception PC (tools/lock-bridge) that
 * writes guest key cards on the door-lock encoder.
 *
 * Only the browser on that PC talks to it, at http://127.0.0.1:47123, and only
 * once pairing has marked this browser as the encoder PC. Other devices never
 * call 127.0.0.1, so they never see Chrome's "access other apps on this
 * device" prompt.
 *
 * A card is written only from an order the server signed (key-card-order),
 * made against a one-time challenge from this bridge.
 */
import { callFunction } from '@/lib/api'

export const BRIDGE_URL = 'http://127.0.0.1:47123'
const ENCODER_PC_KEY = 'amp.lockBridge.encoderPc'

export interface EncoderPc {
  encoderId: string
  label: string
}

export interface BridgeStatus {
  ok: boolean
  version: string
  paired: boolean
  encoderId: string | null
  label: string | null
  encoder: { name: string; ready: boolean; message: string; dllVersion: string | null }
  busy: boolean
  unsentResults: number
  serverError: string | null
  revoked: boolean
}

export type BridgeErrorKind = 'unreachable' | 'blocked' | 'timeout' | 'refused'

export class BridgeError extends Error {
  constructor(message: string, readonly kind: BridgeErrorKind, readonly status?: number) {
    super(message)
    this.name = 'BridgeError'
  }
}

const BLOCKED_HELP =
  'Chrome is blocking this page from reaching the lock bridge. Click the icon left of the web address, ' +
  'set "Apps on this device" (or "Local network access") to Allow, then reload the page.'

// ---- this browser -----------------------------------------------------------

/** Set when this browser paired the lock bridge on this PC. Only then do pages call 127.0.0.1. */
export function getEncoderPc(): EncoderPc | null {
  try {
    const raw = localStorage.getItem(ENCODER_PC_KEY)
    if (!raw) return null
    const v = JSON.parse(raw)
    return typeof v?.encoderId === 'string' && typeof v?.label === 'string' ? { encoderId: v.encoderId, label: v.label } : null
  } catch {
    return null
  }
}

export function setEncoderPc(pc: EncoderPc): void {
  try { localStorage.setItem(ENCODER_PC_KEY, JSON.stringify(pc)) } catch { /* private window: works until reload */ }
}

export function forgetEncoderPc(): void {
  try { localStorage.removeItem(ENCODER_PC_KEY) } catch { /* nothing stored */ }
}

/** Chrome's permission for this site to reach apps on this PC, where the browser can tell. */
export async function localAccessPermission(): Promise<PermissionState | 'unsupported'> {
  if (!navigator.permissions?.query) return 'unsupported'
  // Chrome 142 shipped 'local-network-access'; later builds split out 'loopback-network'.
  for (const name of ['loopback-network', 'local-network-access']) {
    try {
      return (await navigator.permissions.query({ name } as unknown as PermissionDescriptor)).state
    } catch { /* this browser does not know the name */ }
  }
  return 'unsupported'
}

// ---- talking to the bridge ------------------------------------------------------

type LocalRequestInit = RequestInit & { targetAddressSpace?: 'loopback' }

async function send(path: string, opts: { method?: 'GET' | 'POST'; body?: unknown; timeoutMs?: number } = {}): Promise<{ status: number; data: any }> {
  const init: LocalRequestInit = {
    method: opts.method ?? 'GET',
    mode: 'cors',
    cache: 'no-store',
    credentials: 'omit',
    targetAddressSpace: 'loopback',
    signal: AbortSignal.timeout(opts.timeoutMs ?? 8000),
  }
  if (opts.body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' }
    init.body = JSON.stringify(opts.body)
  }
  let res: Response
  try {
    res = await fetch(`${BRIDGE_URL}${path}`, init)
  } catch (e) {
    if (e instanceof DOMException && e.name === 'TimeoutError') throw new BridgeError('The lock bridge did not answer in time.', 'timeout')
    if ((await localAccessPermission()) === 'denied') throw new BridgeError(BLOCKED_HELP, 'blocked')
    throw new BridgeError('The lock bridge is not running on this PC. Start "AMP Lock Bridge" (its icon sits by the clock), then try again.', 'unreachable')
  }
  const data = await res.json().catch(() => ({}))
  return { status: res.status, data }
}

async function call<T>(path: string, opts: Parameters<typeof send>[1] = {}): Promise<T> {
  const { status, data } = await send(path, opts)
  if (status < 200 || status >= 300) throw new BridgeError(data?.error || `The lock bridge answered ${status}.`, 'refused', status)
  return data as T
}

export function bridgeStatus(): Promise<BridgeStatus> {
  return call<BridgeStatus>('/status', { timeoutMs: 8000 })
}

/** Sends a one-time pairing code (from lock-encoder-pair) to the bridge on this PC, and marks this browser. */
export async function pairThisPc(code: string): Promise<EncoderPc> {
  const r = await call<{ encoderId: string; label: string }>('/pair', { method: 'POST', body: { code }, timeoutMs: 30000 })
  const pc = { encoderId: r.encoderId, label: r.label }
  setEncoderPc(pc)
  return pc
}

/** For a browser that lost its mark (cleared data): adopt the pairing the bridge already has. */
export async function adoptPairedBridge(): Promise<EncoderPc> {
  const s = await bridgeStatus()
  if (!s.paired || !s.encoderId) throw new BridgeError('The lock bridge on this PC is not paired yet.', 'refused')
  const pc = { encoderId: s.encoderId, label: s.label || 'Reception PC' }
  setEncoderPc(pc)
  return pc
}

// ---- making cards ---------------------------------------------------------------

export interface PreparedCards {
  order: string
  signature: string
  nonce: string
  guest: string | null
  room: string | null
  /** When the cards stop opening the door (ISO, UTC: Ghana is on GMT). */
  validUntil: string
  cardNos: number[]
  /** The stay is longer than the longest a card may run; the cards stop sooner. */
  capped: boolean
}

/**
 * Gets a signed order for `count` cards: a challenge from the bridge, then the
 * server's decision. What is shown to staff is read from the signed order
 * itself, so it is exactly what the bridge will write.
 */
/** replace: a card was lost, so the new cards replace all of the stay's cards (a new DAI). */
export async function prepareKeyCards(bookingId: string, count: number, replace = false): Promise<PreparedCards> {
  const { challenge } = await call<{ challenge: string }>('/challenge', { method: 'POST', body: {} })
  const res = await callFunction('key-card-order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bookingId, count, challenge, ...(replace ? { replace: true } : {}) }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.error || 'Could not prepare the key cards.')
  const order = JSON.parse(data.order)
  return {
    order: data.order,
    signature: data.signature,
    nonce: order.nonce,
    guest: order.guest ?? null,
    room: order.room != null ? String(order.room) : null,
    validUntil: order.validUntil,
    cardNos: (order.cards as Array<{ cardNo: number }>).map((c) => c.cardNo),
    capped: !!data.summary?.capped,
  }
}

export type CardOutcome =
  | 'issued'   // written and read back
  | 'failed'   // not written: safe to try again
  | 'unknown'  // cut off: try the card at the door
  | 'busy'     // the encoder is doing another card
  | 'expired'  // the order is too old: start again
  | 'refused'  // the bridge would not take the order

export interface CardResult {
  outcome: CardOutcome
  error: string | null
}

const OUTCOMES: CardOutcome[] = ['issued', 'failed', 'unknown', 'busy']

/** What the bridge recorded for one card of an order (after a lost answer), or null if it never started it. */
async function cardState(nonce: string, cardNo: number): Promise<CardResult | 'writing' | null> {
  const { status, data } = await send(`/orders/${encodeURIComponent(nonce)}`)
  if (status === 404) return null
  if (status !== 200) throw new BridgeError(data?.error || `The lock bridge answered ${status}.`, 'refused', status)
  const card = (data.cards as Array<{ cardNo: number; status: string; error: string | null }>).find((c) => c.cardNo === cardNo)
  if (!card) return null
  if (card.status === 'writing') return 'writing'
  return { outcome: OUTCOMES.includes(card.status as CardOutcome) ? (card.status as CardOutcome) : 'unknown', error: card.error }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Writes one card of a prepared order. Asking again for a card that was
 * written returns its stored result; the bridge never writes it twice.
 */
export async function writeKeyCard(prepared: PreparedCards, cardNo: number): Promise<CardResult> {
  let status: number
  let data: any
  try {
    ;({ status, data } = await send('/cards/issue', {
      method: 'POST',
      body: { order: prepared.order, signature: prepared.signature, cardNo },
      timeoutMs: 60000,
    }))
  } catch (e) {
    // No answer. If the bridge cannot even be reached, say so: trying again is safe, because
    // a card it did start is answered from its journal instead of being written twice.
    if (!(e instanceof BridgeError) || e.kind !== 'timeout') {
      const state = await cardState(prepared.nonce, cardNo).catch(() => null)
      if (!state) throw e
      if (state !== 'writing') return state
    }
    // It took the request and went quiet: ask what happened.
    for (let i = 0; i < 20; i++) {
      const state = await cardState(prepared.nonce, cardNo).catch(() => undefined)
      if (state === null) throw e
      if (state && state !== 'writing') return state
      await sleep(1500)
    }
    return { outcome: 'unknown', error: 'The lock bridge stopped answering while writing. Try the card at the door.' }
  }

  if (status === 410) return { outcome: 'expired', error: data?.error ?? 'This order has expired.' }
  if (data?.status === 'writing') {
    // Another tab started this very card: wait for its result.
    for (let i = 0; i < 40; i++) {
      await sleep(1500)
      const state = await cardState(prepared.nonce, cardNo)
      if (state && state !== 'writing') return state
    }
    return { outcome: 'unknown', error: 'The card took too long. Try it at the door.' }
  }
  if (OUTCOMES.includes(data?.status)) return { outcome: data.status, error: data.error ?? null }
  return { outcome: 'refused', error: data?.error ?? `The lock bridge answered ${status}.` }
}
