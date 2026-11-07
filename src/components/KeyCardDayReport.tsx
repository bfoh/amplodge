import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, ClipboardList, Loader2 } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { STATUS_LABEL } from '@/services/key-cards'
import { loadKeyCardDay, type KeyCardDay } from '@/services/key-card-report'
import { useTableChanges } from '@/hooks/use-table-changes'

const todayInHotel = () => new Date().toISOString().slice(0, 10)

/**
 * The day's key cards, for managers: what was written and by whom, cards
 * returned, kept and lost, lock-outs, and anything out of the ordinary.
 */
export function KeyCardDayReport() {
  const [day, setDay] = useState(todayInHotel)
  const [report, setReport] = useState<KeyCardDay | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async (d: string) => {
    setLoading(true)
    setFailed(null)
    try {
      setReport(await loadKeyCardDay(d))
    } catch (e) {
      console.error('[KeyCardDayReport]', e)
      setFailed('The day\'s key cards could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load(day) }, [day, load])
  useTableChanges('key_cards', () => { if (day === todayInHotel()) void load(day) }, { delay: 1500 })

  const tiles: Array<[string, number, string?]> = report ? [
    ['Cards written', report.written, report.updated ? `${report.updated} updated` : undefined],
    ['Returned', report.returned],
    ['Kept by guests', report.kept],
    ['Lost', report.lost],
    ['Lock-outs', report.lockouts],
    ['Failed writes', report.failed],
  ] : []

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg"><ClipboardList className="h-5 w-5 text-primary" />The day's key cards</CardTitle>
            <CardDescription>Every card written and who made it, cards back and missing, and what looks out of the ordinary.</CardDescription>
          </div>
          <div className="space-y-1">
            <Label htmlFor="card-day" className="text-xs">Day</Label>
            <Input id="card-day" type="date" className="h-9 w-40" value={day} max={todayInHotel()} onChange={(e) => e.target.value && setDay(e.target.value)} />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading && !report ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading…</p>
        ) : failed ? (
          <p className="text-sm text-red-700">{failed}</p>
        ) : report && (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {tiles.map(([label, n, sub]) => (
                <div key={label} className="rounded-lg border bg-card p-3">
                  <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
                  <div className="text-xl font-semibold tabular-nums">{n}</div>
                  {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
                </div>
              ))}
            </div>

            {report.alerts.length > 0 && (
              <div className="space-y-1 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                {report.alerts.map((a) => (
                  <p key={a} className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{a}</p>
                ))}
              </div>
            )}

            {report.byStaff.length > 0 && (
              <p className="text-sm text-muted-foreground">
                Made by: {report.byStaff.map((s) => `${s.name} (${s.cards})`).join(', ')}
              </p>
            )}

            {report.cards.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="py-2 pr-3 font-medium">Time</th>
                      <th className="py-2 pr-3 font-medium">Room</th>
                      <th className="py-2 pr-3 font-medium">What</th>
                      <th className="py-2 pr-3 font-medium">By</th>
                      <th className="py-2 font-medium">Now</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {report.cards.map((c) => (
                      <tr key={c.id}>
                        <td className="py-2 pr-3 tabular-nums">{c.time}</td>
                        <td className="py-2 pr-3">{c.roomNumber}{c.guestName ? <span className="text-muted-foreground"> · {c.guestName}</span> : null}</td>
                        <td className="py-2 pr-3">{c.what}</td>
                        <td className="py-2 pr-3">{c.by}</td>
                        <td className="py-2"><Badge variant="outline" className="font-normal">{STATUS_LABEL[c.status]}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No cards were written on this day.</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
