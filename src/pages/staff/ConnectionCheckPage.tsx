import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Loader2 } from 'lucide-react'

/**
 * Measures, from this browser, whether routing through the Netlify proxy is
 * still worth what it costs.
 *
 * Every database request goes through /.netlify/functions/supabase-proxy. It
 * was put there because direct connections from Ghana were timing out, and it
 * costs 0.3–1.2 s per request measured from Europe. Whether that trade is still
 * the right one depends on the network the hotel actually uses, which cannot be
 * answered from a developer's machine — so it is answered here, on the phone or
 * desk computer that has the problem.
 *
 * Read-only: it fetches a handful of rooms a few times and times them.
 */

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string
const RUNS = 5
/** Small, harmless, and the same shape either way. */
const PATH = '/rest/v1/properties?select=id,room_number&limit=10'

interface Result {
  label: string
  times: number[]
  failures: number
  bytes: number
}

const median = (xs: number[]) => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2)
}

async function time(url: string): Promise<{ ms: number; bytes: number } | null> {
  const started = performance.now()
  try {
    const res = await fetch(url, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
      cache: 'no-store',
    })
    const body = await res.text()
    if (!res.ok) return null
    return { ms: Math.round(performance.now() - started), bytes: body.length }
  } catch {
    return null
  }
}

export function ConnectionCheckPage() {
  const [running, setRunning] = useState(false)
  const [results, setResults] = useState<Result[]>([])
  const [progress, setProgress] = useState('')

  const run = async () => {
    setRunning(true)
    setResults([])
    const routes = [
      { label: 'Direct to the database', url: `${SUPABASE_URL}${PATH}` },
      { label: 'Through the proxy', url: `${window.location.origin}/.netlify/functions/supabase-proxy?_sbpath=${encodeURIComponent(PATH.split('?')[0])}&${PATH.split('?')[1]}` },
    ]

    const collected: Result[] = []
    for (const route of routes) {
      const times: number[] = []
      let failures = 0
      let bytes = 0
      for (let i = 0; i < RUNS; i++) {
        setProgress(`${route.label} — attempt ${i + 1} of ${RUNS}`)
        const r = await time(route.url)
        if (r) { times.push(r.ms); bytes = r.bytes } else failures++
      }
      collected.push({ label: route.label, times, failures, bytes })
      setResults([...collected])
    }
    setProgress('')
    setRunning(false)
  }

  const direct = results.find(r => r.label.startsWith('Direct'))
  const proxied = results.find(r => r.label.startsWith('Through'))
  const verdict = (() => {
    if (!direct || !proxied) return null
    if (direct.failures === RUNS) return 'The direct route did not work at all here. Keep the proxy.'
    if (direct.failures > 0) return `The direct route failed ${direct.failures} of ${RUNS} times. Keep the proxy — this is what it is for.`
    const d = median(direct.times)
    const p = median(proxied.times)
    if (d < p) return `Direct is ${p - d} ms faster per request and did not fail. Worth reconsidering the proxy.`
    return 'The proxy is not costing anything here. Leave it as it is.'
  })()

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Connection check</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Every request the app makes goes through a proxy, added because direct connections
          from Ghana were timing out. This measures both routes from this device so we can tell
          whether that is still true. Nothing is changed — it only reads a few room records.
        </p>
      </div>

      <Button onClick={run} disabled={running}>
        {running ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Measuring…</> : `Run ${RUNS} requests each way`}
      </Button>
      {progress && <p className="text-sm text-muted-foreground">{progress}</p>}

      {results.map(r => (
        <Card key={r.label}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{r.label}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p>
              <span className="text-muted-foreground">Typical: </span>
              <span className="font-bold tabular-nums">{median(r.times) || '—'} ms</span>
              {r.times.length > 1 && (
                <span className="text-muted-foreground">
                  {' '}(fastest {Math.min(...r.times)} ms, slowest {Math.max(...r.times)} ms)
                </span>
              )}
            </p>
            <p className="text-muted-foreground">
              {r.times.length} of {RUNS} succeeded
              {r.failures > 0 && <span className="text-red-600 font-medium"> · {r.failures} failed</span>}
              {r.bytes > 0 && ` · ${r.bytes} bytes`}
            </p>
          </CardContent>
        </Card>
      ))}

      {verdict && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm">
          <p className="font-medium text-amber-900">What this says</p>
          <p className="text-amber-800 mt-1">{verdict}</p>
          <p className="text-amber-700 mt-2 text-xs">
            Run it a few times, on the networks staff actually use. One measurement on a good
            connection proves nothing about a bad one.
          </p>
        </div>
      )}
    </div>
  )
}

export default ConnectionCheckPage
