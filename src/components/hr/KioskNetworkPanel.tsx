/**
 * Kiosk credentials & on-site network — admin panel (migration 20260725).
 *
 *  - Provision entrance kiosks that mint clock nonces with their own device key
 *    (no admin session on the reception screen). The key + ready-to-open kiosk
 *    URL are shown ONCE at creation. Revoke a lost device here.
 *  - Toggle on-site network enforcement + maintain the CIDR allowlist, so a
 *    clock-in must originate from the lodge network (defeats GPS spoofing and
 *    relay-to-a-remote-colleague).
 *  - Rotate the proxy shared secret that lets the DB trust the request IP; the
 *    value must be pasted into the Netlify env var AMP_PROXY_SECRET.
 */

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Plus, Trash2, MonitorSmartphone, ShieldCheck, KeyRound, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from 'sonner'
import {
  listClockKiosks,
  createClockKiosk,
  revokeClockKiosk,
  setOnsiteNetwork,
  rotateProxySecret,
  getAttendanceSettings,
  type ClockKiosk,
} from '@/services/attendance-service'

function copy(text: string, what: string) {
  navigator.clipboard?.writeText(text).then(
    () => toast.success(`${what} copied`),
    () => toast.error('Copy failed'),
  )
}

export function KioskNetworkPanel() {
  const [kiosks, setKiosks] = useState<ClockKiosk[]>([])
  const [loading, setLoading] = useState(true)
  const [label, setLabel] = useState('')
  const [cidr, setCidr] = useState('')
  const [creating, setCreating] = useState(false)
  // Newly minted secrets shown once (never re-fetchable).
  const [newKiosk, setNewKiosk] = useState<{ id: string; key: string } | null>(null)
  const [proxySecret, setProxySecret] = useState<string | null>(null)

  const [onsite, setOnsite] = useState(false)
  const [onsiteCidrs, setOnsiteCidrs] = useState('')
  const [savingNet, setSavingNet] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    const [ks, settings] = await Promise.all([listClockKiosks(), getAttendanceSettings()])
    setKiosks(ks)
    if (settings) {
      setOnsite(settings.requireOnsiteNetwork)
      setOnsiteCidrs(settings.onsiteCidrs.join('\n'))
    }
    setLoading(false)
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const kioskUrl = (id: string, key: string) =>
    `${window.location.origin}/staff/qr-display?kiosk=${encodeURIComponent(id)}&key=${encodeURIComponent(key)}`

  const handleCreate = async () => {
    if (!label.trim()) { toast.error('Give the kiosk a label'); return }
    setCreating(true)
    const res = await createClockKiosk(label.trim(), cidr.trim() || null)
    setCreating(false)
    if (!res.ok) { toast.error(`Could not create kiosk: ${res.error}`); return }
    setNewKiosk({ id: res.kioskId, key: res.kioskKey })
    setLabel(''); setCidr('')
    toast.success('Kiosk provisioned — copy its URL now, the key is shown once')
    refresh()
  }

  const handleRevoke = async (id: string) => {
    const res = await revokeClockKiosk(id)
    if (!res.ok) { toast.error(`Revoke failed: ${res.error}`); return }
    toast.success('Kiosk revoked')
    refresh()
  }

  const handleSaveNetwork = async () => {
    const cidrs = onsiteCidrs.split(/[\s,]+/).map((c) => c.trim()).filter(Boolean)
    setSavingNet(true)
    const res = await setOnsiteNetwork(onsite, cidrs)
    setSavingNet(false)
    if (!res.ok) {
      toast.error(res.error === 'invalid_cidr' ? `Invalid CIDR: ${res.value}` : `Save failed: ${res.error}`)
      return
    }
    toast.success('On-site network settings saved')
  }

  const handleRotate = async () => {
    const res = await rotateProxySecret()
    if (!res.ok) { toast.error(`Rotate failed: ${res.error}`); return }
    setProxySecret(res.secret)
    toast.success('Proxy secret rotated — paste it into AMP_PROXY_SECRET')
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <MonitorSmartphone className="w-4 h-4" /> Kiosks & On-site Network
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* ── Provision a kiosk ─────────────────────────────────────────── */}
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 items-end">
            <div className="space-y-1">
              <Label htmlFor="kiosk-label">Kiosk label</Label>
              <Input id="kiosk-label" placeholder="Front desk tablet" value={label}
                     onChange={(e) => setLabel(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="kiosk-cidr">Egress CIDR (optional)</Label>
              <Input id="kiosk-cidr" placeholder="102.176.94.0/24" value={cidr}
                     onChange={(e) => setCidr(e.target.value)} />
            </div>
            <Button onClick={handleCreate} disabled={creating}>
              {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              <span className="ml-1">Provision</span>
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Binding a CIDR means nonces from this kiosk can only be consumed by a clock-in from that network.
          </p>

          {newKiosk && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 space-y-2 text-sm">
              <p className="font-medium text-amber-800 flex items-center gap-1.5">
                <KeyRound className="w-4 h-4" /> Save this now — the key is shown only once
              </p>
              <div className="flex items-center gap-2">
                <code className="text-xs bg-white rounded px-2 py-1 border break-all flex-1">
                  {kioskUrl(newKiosk.id, newKiosk.key)}
                </code>
                <Button size="sm" variant="outline"
                        onClick={() => copy(kioskUrl(newKiosk.id, newKiosk.key), 'Kiosk URL')}>
                  <Copy className="w-3.5 h-3.5" />
                </Button>
              </div>
              <p className="text-xs text-amber-700">
                Open this URL once on the entrance device — it stores the key locally and scrubs it from the address bar.
              </p>
              <Button size="sm" variant="ghost" onClick={() => setNewKiosk(null)}>Done</Button>
            </div>
          )}

          {/* Kiosk list */}
          {loading ? (
            <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          ) : kiosks.length === 0 ? (
            <p className="text-sm text-muted-foreground">No kiosks registered.</p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {kiosks.map((k) => (
                <li key={k.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">{k.label}</span>
                      {k.active
                        ? <Badge variant="secondary" className="text-[10px]">active</Badge>
                        : <Badge variant="outline" className="text-[10px] text-muted-foreground">revoked</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {k.id}{k.egressCidr ? ` · ${k.egressCidr}` : ''}
                      {k.lastUsedAt ? ` · last used ${new Date(k.lastUsedAt).toLocaleString()}` : ' · never used'}
                    </div>
                  </div>
                  {k.active && (
                    <Button size="sm" variant="ghost" className="text-red-600" onClick={() => handleRevoke(k.id)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* ── On-site network enforcement ───────────────────────────────── */}
        <div className="space-y-3 border-t pt-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="flex items-center gap-1.5"><ShieldCheck className="w-4 h-4" /> Require on-site network</Label>
              <p className="text-xs text-muted-foreground">
                Clock-in must come from an allowlisted network. Needs the proxy secret set (below).
              </p>
            </div>
            <Switch checked={onsite} onCheckedChange={setOnsite} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="onsite-cidrs">Allowed CIDRs (one per line)</Label>
            <textarea id="onsite-cidrs" rows={3} value={onsiteCidrs}
                      onChange={(e) => setOnsiteCidrs(e.target.value)}
                      placeholder={'102.176.94.0/24\n41.66.0.0/16'}
                      className="w-full rounded-md border bg-background px-3 py-2 text-sm font-mono" />
          </div>
          <Button onClick={handleSaveNetwork} disabled={savingNet}>
            {savingNet && <Loader2 className="w-4 h-4 animate-spin mr-1" />} Save network settings
          </Button>
        </div>

        {/* ── Proxy secret ──────────────────────────────────────────────── */}
        <div className="space-y-2 border-t pt-4">
          <Label className="flex items-center gap-1.5"><KeyRound className="w-4 h-4" /> Proxy shared secret</Label>
          <p className="text-xs text-muted-foreground">
            Lets the database trust the request IP. Rotate, then paste the value into the Netlify env var
            <code className="mx-1 px-1 bg-muted rounded">AMP_PROXY_SECRET</code> and redeploy. Until it matches,
            on-site checks fail closed.
          </p>
          {proxySecret && (
            <div className="flex items-center gap-2">
              <code className="text-xs bg-white rounded px-2 py-1 border break-all flex-1">{proxySecret}</code>
              <Button size="sm" variant="outline" onClick={() => copy(proxySecret, 'Secret')}>
                <Copy className="w-3.5 h-3.5" />
              </Button>
            </div>
          )}
          <Button variant="outline" onClick={handleRotate}>Rotate proxy secret</Button>
        </div>
      </CardContent>
    </Card>
  )
}
