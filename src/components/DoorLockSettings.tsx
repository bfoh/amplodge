import { useCallback, useEffect, useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { KeyRound, Loader2, MonitorSmartphone, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { callFunction } from '@/lib/api'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useCurrency } from '@/hooks/use-currency'
import { STAY_RULES_MIGRATION, loadKeyCardSettings, saveKeyCardSettings, type KeyCardSettings } from '@/services/key-card-stay'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  UPKEEP_MIGRATION, createCardStockItem, loadCardStock, loadStockItems, saveCardStockItem, type CardStock, type StockItem,
} from '@/services/lock-upkeep'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  adoptPairedBridge, bridgeStatus, forgetEncoderPc, getEncoderPc, pairThisPc,
  type BridgeStatus, type EncoderPc,
} from '@/services/lock-bridge'

interface Encoder {
  id: string
  label: string
  state: 'paired' | 'waiting' | 'expired' | 'revoked'
  pairedAt: string | null
  lastSeenAt: string | null
  bridgeVersion: string | null
  dllVersion: string | null
  revokedAt: string | null
}

const STATE: Record<Encoder['state'], { label: string; tone: string }> = {
  paired: { label: 'Paired', tone: 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200' },
  waiting: { label: 'Waiting for the PC', tone: 'bg-blue-50 text-blue-800 ring-1 ring-blue-200' },
  expired: { label: 'Code expired', tone: 'bg-gray-50 text-gray-700' },
  revoked: { label: 'Removed', tone: 'bg-gray-50 text-gray-700' },
}

async function pairCall<T>(body: Record<string, unknown>): Promise<T> {
  const res = await callFunction('lock-encoder-pair', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.error || `The server answered ${res.status}.`)
  return data as T
}

const ago = (iso: string | null) => (iso ? formatDistanceToNow(new Date(iso), { addSuffix: true }) : 'never')

/**
 * Settings → Door locks (admins). Pairs the reception PC's lock bridge with
 * the server, shows the paired PCs and removes one. Pairing has to be done on
 * the reception PC itself: this browser hands the one-time code to the bridge
 * running next to it.
 */
export function DoorLockSettings() {
  const [encoders, setEncoders] = useState<Encoder[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [label, setLabel] = useState('Reception PC')
  const [pairing, setPairing] = useState<{ code: string; expiresAt: string } | null>(null)
  const [pairError, setPairError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [thisPc, setThisPc] = useState<EncoderPc | null>(() => getEncoderPc())
  const [status, setStatus] = useState<BridgeStatus | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [confirmRevoke, setConfirmRevoke] = useState<Encoder | null>(null)

  const load = useCallback(async () => {
    try {
      const { encoders } = await pairCall<{ encoders: Encoder[] }>({ action: 'list' })
      setEncoders(encoders)
      setLoadError(null)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load the encoder PCs.')
    }
  }, [])

  useEffect(() => { void load() }, [load])

  async function sendCode(code: string) {
    setBusy(true)
    setPairError(null)
    try {
      const pc = await pairThisPc(code)
      setThisPc(pc)
      setPairing(null)
      toast.success(`This PC is paired as "${pc.label}"`)
      await load()
    } catch (e) {
      setPairError(e instanceof Error ? e.message : 'Pairing failed.')
    } finally {
      setBusy(false)
    }
  }

  async function startPairing() {
    setBusy(true)
    setPairError(null)
    try {
      const r = await pairCall<{ code: string; expiresAt: string }>({ action: 'start', label: label.trim() || 'Reception PC' })
      setPairing(r)
      setBusy(false)
      await sendCode(r.code)
    } catch (e) {
      setPairError(e instanceof Error ? e.message : 'Could not start pairing.')
      setBusy(false)
    }
  }

  async function checkBridge() {
    setStatusError(null)
    try {
      setStatus(await bridgeStatus())
    } catch (e) {
      setStatus(null)
      setStatusError(e instanceof Error ? e.message : 'The lock bridge could not be reached.')
    }
  }

  async function adopt() {
    setStatusError(null)
    try {
      const pc = await adoptPairedBridge()
      setThisPc(pc)
      toast.success(`This browser makes key cards again, as "${pc.label}"`)
    } catch (e) {
      setStatusError(e instanceof Error ? e.message : 'The lock bridge could not be reached.')
    }
  }

  async function revoke(encoder: Encoder) {
    try {
      await pairCall({ action: 'revoke', encoderId: encoder.id })
      if (thisPc?.encoderId === encoder.id) { forgetEncoderPc(); setThisPc(null) }
      toast.success(`"${encoder.label}" can no longer make key cards`)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not remove the PC')
    }
  }

  const active = (encoders ?? []).filter((e) => e.state !== 'revoked' && e.state !== 'expired')

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><KeyRound className="h-5 w-5 text-primary" />Door locks</CardTitle>
        <CardDescription>
          Key cards are written by the lock bridge app on the reception PC that has the card encoder.
          Pair it here, on that PC. Lock numbers for each room are set on the Rooms page.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <section className="space-y-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold"><MonitorSmartphone className="h-4 w-4" />This PC</h3>
          {thisPc ? (
            <>
              <p className="text-sm text-muted-foreground">This browser makes key cards, as <span className="font-medium text-foreground">"{thisPc.label}"</span>.</p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => void checkBridge()}><RefreshCw className="mr-2 h-4 w-4" />Check the lock bridge</Button>
                <Button size="sm" variant="outline" onClick={() => { forgetEncoderPc(); setThisPc(null); setStatus(null) }}>Stop making cards in this browser</Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">This browser does not make key cards. On the reception PC, with the lock bridge running, pair it below.</p>
              <Button size="sm" variant="outline" onClick={() => void adopt()}>The lock bridge here is already paired</Button>
            </>
          )}
          {status && (
            <div className="rounded-md border p-3 text-sm space-y-1">
              <div>Lock bridge {status.version}: {status.paired ? `paired as "${status.label}"` : 'not paired'}</div>
              <div className={status.encoder.ready ? 'text-emerald-700' : 'text-amber-800'}>Encoder: {status.encoder.message}</div>
              {status.unsentResults > 0 && <div className="text-amber-800">{status.unsentResults} card result(s) not sent to the server yet{status.serverError ? `: ${status.serverError}` : ''}.</div>}
              {status.revoked && <div className="text-red-700">This PC was removed. To pair it again, choose "Unpair this PC" on the lock bridge's tray icon, then "Stop making cards in this browser" here.</div>}
            </div>
          )}
          {statusError && <p className="text-sm text-red-700">{statusError}</p>}
        </section>

        {!thisPc && <section className="space-y-2">
          <h3 className="text-sm font-semibold">Pair this PC</h3>
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="encoder-label">Name</Label>
              <Input id="encoder-label" className="w-56" value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} />
            </div>
            <Button onClick={() => void startPairing()} disabled={busy}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Pair this PC
            </Button>
          </div>
          {pairing && (
            <div className="rounded-md border p-3 text-sm space-y-2">
              <div>One-time code, valid until {new Date(pairing.expiresAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}:</div>
              <code className="block font-mono text-base tracking-wider">{pairing.code}</code>
              {pairError && <p className="text-red-700">{pairError}</p>}
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void sendCode(pairing.code)}>Send the code to the lock bridge again</Button>
            </div>
          )}
          {!pairing && pairError && <p className="text-sm text-red-700">{pairError}</p>}
        </section>}

        <KeyCardMoneySettings />

        <CardStockSettings />

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Encoder PCs</h3>
          {loadError ? (
            <p className="text-sm text-red-700">{loadError}</p>
          ) : !encoders ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : active.length === 0 ? (
            <p className="text-sm text-muted-foreground">None paired yet.</p>
          ) : (
            <div className="divide-y rounded-md border">
              {active.map((e) => (
                <div key={e.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <div className="font-medium">{e.label}{thisPc?.encoderId === e.id && <span className="font-normal text-muted-foreground"> · this PC</span>}</div>
                    <div className="text-xs text-muted-foreground">
                      Last heard from {ago(e.lastSeenAt)}
                      {e.bridgeVersion ? ` · bridge ${e.bridgeVersion}` : ''}
                      {e.dllVersion ? ` · ${e.dllVersion}` : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={STATE[e.state].tone}>{STATE[e.state].label}</Badge>
                    <Button size="sm" variant="outline" onClick={() => setConfirmRevoke(e)}>Remove</Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </CardContent>

      <AlertDialog open={!!confirmRevoke} onOpenChange={(open) => !open && setConfirmRevoke(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove "{confirmRevoke?.label}"?</AlertDialogTitle>
            <AlertDialogDescription>
              That PC will no longer make key cards until it is paired again. Cards it already made keep working until they expire.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={() => { const e = confirmRevoke; setConfirmRevoke(null); if (e) void revoke(e) }}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}

/** The card fee and the check-out morning SMS (20261109120000). */
function KeyCardMoneySettings() {
  const { currency } = useCurrency()
  const [settings, setSettings] = useState<KeyCardSettings | null>(null)
  const [fee, setFee] = useState('')
  const [sms, setSms] = useState(false)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)

  useEffect(() => {
    loadKeyCardSettings().then((s) => {
      setSettings(s)
      setFee(s.fee ? String(s.fee) : '')
      setSms(s.morningSms)
    }, (e) => setFailed(e instanceof Error ? e.message : 'The settings could not be loaded.'))
  }, [])

  const amount = fee.trim() === '' ? null : Number(fee)
  const valid = amount === null || (Number.isFinite(amount) && amount >= 0)
  const changed = !!settings && ((amount || null) !== settings.fee || sms !== settings.morningSms)

  async function save() {
    if (!settings?.id || !valid) return
    setSaving(true)
    try {
      await saveKeyCardSettings(settings.id, amount, sms)
      const fresh = await loadKeyCardSettings()
      setSettings(fresh)
      setFee(fresh.fee ? String(fresh.fee) : '')
      setSms(fresh.morningSms)
      toast.success('Door lock settings saved')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">Card fee and guest SMS</h3>
      {failed ? <p className="text-sm text-red-700">{failed}</p>
        : !settings ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        : !settings.ready ? (
          <p className="text-sm text-amber-800">
            These need a database update first: run <code className="text-xs">{STAY_RULES_MIGRATION}</code> in the Supabase SQL editor, then reload this page.
          </p>
        ) : (
          <>
            <div className="space-y-1">
              <Label htmlFor="key-card-fee">Fee for a key card kept or lost ({currency})</Label>
              <Input id="key-card-fee" className="w-40" inputMode="decimal" placeholder="No fee" value={fee} onChange={(e) => setFee(e.target.value)} />
              <p className="text-xs text-muted-foreground">
                When a guest keeps a card at check-out or loses one, staff are offered this charge, and can skip it. Leave it empty for no fee.
              </p>
              {!valid && <p className="text-xs text-red-700">Enter an amount, such as 20.</p>}
            </div>
            <div className="flex items-start gap-3">
              <Switch id="checkout-sms" checked={sms} onCheckedChange={setSms} className="mt-0.5" />
              <div className="space-y-0.5">
                <Label htmlFor="checkout-sms">Check-out morning SMS</Label>
                <p className="text-xs text-muted-foreground">
                  At 7:30 on check-out day, guests leaving today get an SMS with their check-out time and when their key card stops, asking them to hand the cards in.
                </p>
              </div>
            </div>
            <Button size="sm" disabled={!changed || !valid || saving} onClick={() => void save()}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save
            </Button>
          </>
        )}
    </section>
  )
}

const NONE = 'none'

/**
 * Which inventory item counts the blank key cards. A card a guest keeps, or a lost
 * card, is taken off it; a kept card brought back is put back.
 */
function CardStockSettings() {
  const [stock, setStock] = useState<CardStock | null>(null)
  const [items, setItems] = useState<StockItem[]>([])
  const [chosen, setChosen] = useState(NONE)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [s, list] = await Promise.all([loadCardStock(), loadStockItems()])
      setStock(s)
      setItems(list)
      setChosen(s.item?.id ?? NONE)
    } catch (e) {
      setFailed(e instanceof Error ? e.message : 'The inventory could not be loaded.')
    }
  }, [])
  useEffect(() => { void load() }, [load])

  async function save(itemId: string | null) {
    if (!stock?.settingsId) return
    setSaving(true)
    try {
      await saveCardStockItem(stock.settingsId, itemId)
      await load()
      toast.success(itemId ? 'Blank cards are counted in Inventory now' : 'Blank cards are no longer counted')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  async function createItem() {
    if (!stock?.settingsId) return
    setSaving(true)
    try {
      const item = await createCardStockItem()
      await saveCardStockItem(stock.settingsId, item.id)
      await load()
      toast.success('"Blank key cards" added to Inventory: count the pile and restock it there')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not add the item')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">Blank card stock</h3>
      {failed ? <p className="text-sm text-red-700">{failed}</p>
        : !stock ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        : !stock.ready ? (
          <p className="text-sm text-amber-800">
            This needs a database update first: run <code className="text-xs">{UPKEEP_MIGRATION}</code> in the Supabase SQL editor, then reload this page.
          </p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              Count the blank key cards in Inventory. A card a guest keeps, or loses, is taken off the count; a kept card
              brought back is put back. Restock it in Inventory when you buy cards; it warns when few are left.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={chosen} onValueChange={setChosen} disabled={saving}>
                <SelectTrigger className="w-full sm:w-64" aria-label="Inventory item for blank key cards"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Not counted</SelectItem>
                  {items.map((i) => <SelectItem key={i.id} value={i.id}>{i.name} ({i.stock})</SelectItem>)}
                </SelectContent>
              </Select>
              <Button size="sm" disabled={saving || chosen === (stock.item?.id ?? NONE)} onClick={() => void save(chosen === NONE ? null : chosen)}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save
              </Button>
              {!stock.item && !items.some((i) => /key ?card/i.test(i.name)) && (
                <Button size="sm" variant="outline" disabled={saving} onClick={() => void createItem()}>Add "Blank key cards" to Inventory</Button>
              )}
            </div>
            {stock.item && (
              <p className={`text-xs ${stock.item.stock <= stock.item.min ? 'text-amber-800' : 'text-muted-foreground'}`}>
                {stock.item.stock} blank card{stock.item.stock === 1 ? '' : 's'} in stock (Inventory warns at {stock.item.min} or fewer){stock.item.stock <= stock.item.min ? ': time to count the pile or buy more' : ''}.
              </p>
            )}
          </>
        )}
    </section>
  )
}
