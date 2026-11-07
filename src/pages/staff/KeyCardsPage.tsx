import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, CreditCard, DoorClosed, KeyRound, Loader2, MonitorSmartphone, RefreshCw, SearchX, UserX } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { format } from 'date-fns'
import { toast } from 'sonner'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useTableChanges } from '@/hooks/use-table-changes'
import { useIsAdmin } from '@/hooks/use-is-admin'
import {
  STATUS_LABEL, loadKeyCardBoard, markCard,
  type CardMark, type KeyCard, type KeyCardBoard,
} from '@/services/key-cards'
import { promptKeyCards, promptLockoutCard, type KeyCardRequest } from '@/services/key-card-prompt'
import { bridgeStatus, getEncoderPc, type BridgeStatus } from '@/services/lock-bridge'
import { ReadCardPanel } from '@/components/ReadCardPanel'

const when = (iso: string) => format(new Date(iso), 'EEE d MMM, HH:mm')

const STATUS_TONE: Partial<Record<KeyCard['status'], string>> = {
  issued: 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200',
  unknown: 'bg-amber-50 text-amber-900 ring-1 ring-amber-200',
  not_returned: 'bg-amber-50 text-amber-900 ring-1 ring-amber-200',
  pending: 'bg-blue-50 text-blue-800 ring-1 ring-blue-200',
}

/**
 * Reception's list of key cards that need doing: guests without a card, cards
 * that still open a door after the stay ended or the guest moved, and cards
 * whose writing was cut off. Every card the system writes is recorded here.
 */
export default function KeyCardsPage() {
  const { isAdmin } = useIsAdmin()
  const [board, setBoard] = useState<KeyCardBoard | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [lockoutRoom, setLockoutRoom] = useState('')
  const [confirmLost, setConfirmLost] = useState<KeyCard | null>(null)
  const [encoderPc] = useState(() => getEncoderPc())
  const [bridge, setBridge] = useState<{ status: BridgeStatus | null; error: string | null } | null>(null)

  // Only the paired reception PC ever calls the lock bridge on 127.0.0.1.
  const checkBridge = useCallback(async () => {
    if (!getEncoderPc()) return
    try {
      setBridge({ status: await bridgeStatus(), error: null })
    } catch (e) {
      setBridge({ status: null, error: e instanceof Error ? e.message : 'The lock bridge could not be reached.' })
    }
  }, [])
  useEffect(() => { void checkBridge() }, [checkBridge])

  async function makeCards(n: KeyCardRequest) {
    await promptKeyCards(n)
    await reload()
    void checkBridge()
  }

  async function lockOut(roomId: string, roomNumber: string | null) {
    await promptLockoutCard(roomId, roomNumber)
    await reload()
    void checkBridge()
  }

  const reload = useCallback(async () => {
    try {
      setBoard(await loadKeyCardBoard())
    } catch (e) {
      console.error('[KeyCardsPage] load failed', e)
      toast.error('Could not load the key cards')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void reload() }, [reload])
  useTableChanges('key_cards', () => { void reload() })
  useTableChanges('bookings', () => { void reload() }, { delay: 1500 })

  async function mark(card: KeyCard, status: CardMark) {
    setBusy(card.id)
    try {
      await markCard(card.id, status)
      toast.success(`Room ${card.roomNumber ?? '?'}, card ${card.cardNo + 1}: ${STATUS_LABEL[status].toLowerCase()}`)
      await reload()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update the card')
    } finally {
      setBusy(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    )
  }

  const header = (
    <div className="flex items-start justify-between gap-4">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <div className="p-1.5 rounded-lg bg-primary/10"><KeyRound className="w-5 h-5 text-primary" /></div>
          <h1 className="text-2xl font-bold tracking-tight">Key cards</h1>
        </div>
        <p className="text-sm text-muted-foreground">Which guests need a card, and which cards still open a door they should not.</p>
      </div>
      <Button variant="outline" size="sm" onClick={() => { setLoading(true); void reload(); void checkBridge() }}>
        <RefreshCw className="w-4 h-4 mr-2" /> Refresh
      </Button>
    </div>
  )

  const s = bridge?.status
  const bridgeLine = !encoderPc ? (
    <p className="flex items-center gap-2 text-sm text-muted-foreground">
      <MonitorSmartphone className="w-4 h-4" /> Cards are made at the reception PC with the card encoder.
    </p>
  ) : (
    <p className={`flex items-center gap-2 text-sm ${bridge?.error || (s && (!s.encoder.ready || s.revoked)) ? 'text-amber-800' : 'text-muted-foreground'}`}>
      <MonitorSmartphone className="w-4 h-4 shrink-0" />
      {!bridge ? 'Checking the lock bridge…'
        : bridge.error ? bridge.error
        : s!.revoked ? 'This PC was removed in Settings. An admin can pair it again.'
        : !s!.encoder.ready ? `This PC makes key cards, but the encoder is not ready: ${s!.encoder.message}`
        : s!.unsentResults > 0 ? `Encoder ready. ${s!.unsentResults} card result(s) are still to reach the server.`
        : `This PC makes key cards ("${encoderPc.label}"). Encoder ready.`}
    </p>
  )

  if (!board?.configured) {
    return (
      <div className="space-y-6 animate-fade-in">
        {header}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Door locks are not set up yet</CardTitle>
            <CardDescription>
              Key cards appear here once each room has its lock number.
              {isAdmin
                ? <> Add them under <Link to="/staff/properties" className="underline">Rooms → Door lock numbers</Link>: each door's 6-character code from Joney's Lock Management System.</>
                : ' An admin adds them on the Rooms page.'}
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  // Cards of a stay still under way in their own room: those a lost card can replace.
  const current = new Set(board.live.filter((c) => c.bookingId && !board.shouldBeGone.includes(c) && !board.wrongRoom.includes(c)).map((c) => c.id))

  const cardActions = (card: KeyCard) => (
    <div className="flex flex-wrap gap-2">
      {card.status !== 'returned' && (
        <Button size="sm" variant="outline" disabled={busy === card.id} onClick={() => void mark(card, 'returned')}>
          <CheckCircle2 className="w-4 h-4 mr-1" /> Returned
        </Button>
      )}
      {card.status !== 'not_returned' && (
        <Button size="sm" variant="outline" disabled={busy === card.id} onClick={() => void mark(card, 'not_returned')}>
          <UserX className="w-4 h-4 mr-1" /> Guest kept it
        </Button>
      )}
      {encoderPc && !current.has(card.id) && card.roomId && (
        <Button size="sm" variant="outline" disabled={busy === card.id} onClick={() => void lockOut(card.roomId!, card.roomNumber)}>
          <DoorClosed className="w-4 h-4 mr-1" /> Lock out the door
        </Button>
      )}
      {encoderPc && current.has(card.id) && (
        <Button size="sm" variant="outline" disabled={busy === card.id} onClick={() => setConfirmLost(card)}>
          <SearchX className="w-4 h-4 mr-1" /> Card lost
        </Button>
      )}
    </div>
  )

  const cardRow = (card: KeyCard, withActions = true) => (
    <div key={card.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <div className="font-semibold">
          Room {card.roomNumber ?? '?'} <span className="font-normal text-muted-foreground">· {card.kind === 'lockout' ? 'Lock-out card' : card.guestName ?? 'Guest'} · card {card.cardNo + 1}</span>
        </div>
        <div className="text-xs text-muted-foreground">
          {card.kind === 'lockout' ? 'Works' : 'Opens'} until {when(card.validUntil)}
          {card.note ? ` · ${card.note}` : ''}
          {card.error ? ` · ${card.error}` : ''}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge className={STATUS_TONE[card.status] ?? 'bg-gray-50 text-gray-700'} variant="outline">{STATUS_LABEL[card.status]}</Badge>
        {withActions && cardActions(card)}
      </div>
    </div>
  )

  const section = (title: string, description: string, icon: ReactNode, count: number, body: ReactNode, tone = '') => (
    <Card className={tone}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-lg">{icon}{title}<Badge variant="secondary">{count}</Badge></CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="divide-y">{body}</CardContent>
    </Card>
  )

  const { needsCard, shouldBeGone, wrongRoom, unknown, live, lockouts, doors } = board
  const nothing = <p className="py-3 text-sm text-muted-foreground">Nothing here.</p>

  return (
    <div className="space-y-6 animate-fade-in">
      {header}
      {bridgeLine}

      {shouldBeGone.length > 0 && section(
        'Still opens a door after the stay',
        'The guest has checked out or the booking was cancelled, but this card still opens the door until its end time. Take it back. If the guest kept it, mark it so: the next guest\'s card locks it out the first time it opens the door. To stop it now, make a lock-out card at the reception PC ("Lock out the door") and hold it to the lock once.',
        <AlertTriangle className="w-5 h-5 text-red-600" />, shouldBeGone.length,
        <>{shouldBeGone.map((c) => cardRow(c))}</>, 'border-red-200',
      )}

      {wrongRoom.length > 0 && section(
        'Opens a room the guest has left',
        'The booking moved to another room. This card still opens the old room\'s door. To stop it, lock out that door from the reception PC, or take the card back.',
        <AlertTriangle className="w-5 h-5 text-amber-600" />, wrongRoom.length,
        <>{wrongRoom.map((c) => cardRow(c))}</>, 'border-amber-200',
      )}

      {unknown.length > 0 && section(
        'Check these cards',
        'Writing was cut off (a power cut or the card moved). Try the card at the door, or read it at the reception PC (Read a card, below).',
        <AlertTriangle className="w-5 h-5 text-amber-600" />, unknown.length,
        <>{unknown.map((c) => cardRow(c))}</>,
      )}

      {section(
        'Needs a card',
        'Checked in, or arriving today, with no working card. Cards are made at the reception PC that has the card encoder.',
        <CreditCard className="w-5 h-5 text-primary" />, needsCard.length,
        needsCard.length ? (
          <>{needsCard.map((n) => (
            <div key={n.bookingId} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div>
                <div className="font-semibold">Room {n.roomNumber} <span className="font-normal text-muted-foreground">· {n.guestName}</span></div>
                <div className="text-xs text-muted-foreground">Check-out {format(new Date(`${n.checkOut}T00:00:00`), 'EEE d MMM')}</div>
              </div>
              <div className="flex items-center gap-2">
                {n.arrivingToday && <Badge variant="outline">Arriving today</Badge>}
                {encoderPc && (
                  <Button size="sm" onClick={() => void makeCards(n)}>
                    <CreditCard className="w-4 h-4 mr-1" /> Make cards
                  </Button>
                )}
              </div>
            </div>
          ))}</>
        ) : nothing,
      )}

      {section(
        'Working cards',
        'Every guest card that opens a door right now.',
        <KeyRound className="w-5 h-5 text-emerald-600" />, live.length,
        live.length ? <>{live.map((c) => cardRow(c))}</> : nothing,
      )}

      {lockouts.length > 0 && section(
        'Lock-out cards',
        'Each one is to be held to its door\'s lock once: from then on the lock refuses every older card. It stops working by itself at its end time.',
        <DoorClosed className="w-5 h-5 text-primary" />, lockouts.length,
        <>{lockouts.map((c) => cardRow(c, false))}</>,
      )}

      {encoderPc && <ReadCardPanel isAdmin={isAdmin} onChanged={reload} />}

      {encoderPc && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-lg"><DoorClosed className="w-5 h-5 text-primary" />Lock out a door</CardTitle>
            <CardDescription>
              Door locks are not connected to anything: a card keeps opening its door until its end time, unless the lock is told
              otherwise at the door. A lock-out card does that. Held to the lock once, it makes the lock refuse every older card for
              that door, including cards made in Joney's program. Use it for an empty room: after an early check-out, a cancelled
              booking, or a card nobody returned.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-2">
            <Select value={lockoutRoom} onValueChange={setLockoutRoom}>
              <SelectTrigger className="w-full sm:w-56" aria-label="Room to lock out">
                <SelectValue placeholder="Choose a room" />
              </SelectTrigger>
              <SelectContent>
                {doors.map((d) => <SelectItem key={d.roomId} value={d.roomId}>Room {d.roomNumber}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="outline" disabled={!lockoutRoom} onClick={() => void lockOut(lockoutRoom, doors.find((d) => d.roomId === lockoutRoom)?.roomNumber ?? null)}>
              <DoorClosed className="w-4 h-4 mr-1" /> Make a lock-out card
            </Button>
          </CardContent>
        </Card>
      )}

      <AlertDialog open={!!confirmLost} onOpenChange={(open) => !open && setConfirmLost(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Make new cards for room {confirmLost?.roomNumber}?</AlertDialogTitle>
            <AlertDialogDescription>
              For a lost card. The new cards replace every card of {confirmLost?.guestName ?? 'this guest'}'s stay: once one of them
              opens the door, all the old cards stop working there, including the ones the guest still has. Make a card for each
              one the guest needs, and take the old ones back.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Not now</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              const c = confirmLost
              setConfirmLost(null)
              if (c?.bookingId) void makeCards({ bookingId: c.bookingId, guestName: c.guestName, roomNumber: c.roomNumber, replace: true })
            }}>
              Make new cards
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
