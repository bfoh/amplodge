/**
 * In-memory stand-in for src/lib/db, matching the wrapper's surface so the real
 * services run against it unchanged. Rows are stored camelCase and mirrored to
 * snake_case on read, exactly as the app sees Supabase data.
 */
const store: Record<string, any[]> = {}
let seq = 0
const uid = (p: string) => `${p}-${String(++seq).padStart(4, '0')}`

const snakeify = (row: any) => {
  const out: any = { ...row }
  for (const [k, v] of Object.entries(row)) {
    const snake = k.replace(/([A-Z])/g, '_$1').toLowerCase()
    if (snake !== k) out[snake] = v
  }
  return out
}
const camelKey = (k: string) => k.replace(/_([a-z])/g, (_m, c) => c.toUpperCase())

function table(name: string) {
  if (!store[name]) store[name] = []
  const rows = () => store[name]
  return {
    async list(options: any = {}) {
      let out = rows().slice()
      const where = options.where || {}
      for (const [k, v] of Object.entries(where)) {
        const key = camelKey(k)
        out = out.filter(r => r[key] === v || r[k] === v)
      }
      if (options.orderBy?.column) {
        const col = camelKey(options.orderBy.column)
        out.sort((a, b) => String(a[col] ?? '').localeCompare(String(b[col] ?? '')))
        if (options.orderBy.ascending === false) out.reverse()
      }
      if (options.limit) out = out.slice(0, options.limit)
      return out.map(snakeify)
    },
    async listAll(options: any = {}) { return this.list({ ...options, limit: undefined }) },
    async get(id: string) {
      const row = rows().find(r => r.id === id)
      return row ? snakeify(row) : null
    },
    async create(data: any) {
      const row = { id: data.id || uid(name), createdAt: new Date().toISOString(), ...data }
      rows().push(row)
      return snakeify(row)
    },
    async update(id: string, data: any) {
      const row = rows().find(r => r.id === id)
      if (!row) throw new Error(`${name}: no row ${id}`)
      for (const [k, v] of Object.entries(data)) row[camelKey(k)] = v
      row.updatedAt = new Date().toISOString()
      return snakeify(row)
    },
    async delete(id: string) {
      const i = rows().findIndex(r => r.id === id)
      if (i >= 0) rows().splice(i, 1)
      return true
    },
  }
}

const handler: ProxyHandler<any> = { get: (_t, prop: string) => table(prop) }
export const db: any = new Proxy({}, handler)

export const auth = {
  async me() { return (globalThis as any).__TEST_USER__ || null },
  async signInWithEmail() { return null },
  async logout() { return null },
  onAuthStateChanged() { return () => {} },
}
export const onTableUpdated = () => () => {}
export const initRealtimeUpdates = async () => {}

/** Test helpers */
export const __store = store
export const __reset = () => { for (const k of Object.keys(store)) delete store[k]; seq = 0 }
