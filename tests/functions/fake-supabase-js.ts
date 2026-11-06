/**
 * Stand-in for @supabase/supabase-js in the Netlify function suites: a small
 * PostgREST query builder over in-memory tables.
 *
 * It enforces the two database rules a booking depends on, so a function that
 * skips a step fails here as it would in production:
 *  - bookings.room_id must name a row of `rooms` (23503), and
 *  - bookings_no_room_overlap: no two reserved/confirmed/checked-in bookings
 *    of one room may overlap (23P01).
 */
type Row = Record<string, any>

export const tables: Record<string, Row[]> = {}
export const writes: Array<{ table: string; op: 'insert' | 'update'; row: Row }> = []
/** Return an error object to make an insert into that table fail. */
export const failInsert: Record<string, (row: Row) => any> = {}

const ACTIVE = ['reserved', 'confirmed', 'checked-in']

function databaseRules(table: string, row: Row) {
  if (table !== 'bookings') return null
  if (!(tables.rooms || []).some((r) => r.id === row.room_id)) {
    return { code: '23503', message: 'insert or update on table "bookings" violates foreign key constraint "bookings_room_id_fkey"' }
  }
  const overlap = (tables.bookings || []).some(
    (b) => b.room_id === row.room_id && ACTIVE.includes(b.status) && ACTIVE.includes(row.status) && b.check_in < row.check_out && row.check_in < b.check_out,
  )
  return overlap ? { code: '23P01', message: 'conflicting key value violates exclusion constraint "bookings_no_room_overlap"' } : null
}

class Query {
  private filters: Array<(r: Row) => boolean> = []
  private op: 'select' | 'insert' | 'update' = 'select'
  private payload: any
  private wanted: 'single' | 'maybe' | null = null
  private max = Infinity

  constructor(private table: string) {}

  select() { return this }
  insert(row: any) { this.op = 'insert'; this.payload = row; return this }
  /** Insert, or merge into the row with the same id. */
  upsert(row: Row) {
    const rows = (tables[this.table] ||= [])
    const existing = rows.find((r) => r.id === row.id)
    if (existing) { this.op = 'update'; this.payload = row; this.filters.push((r) => r.id === row.id); return this }
    return this.insert(row)
  }
  update(values: Row) { this.op = 'update'; this.payload = values; return this }
  eq(c: string, v: any) { this.filters.push((r) => String(r[c]) === String(v)); return this }
  neq(c: string, v: any) { this.filters.push((r) => String(r[c]) !== String(v)); return this }
  in(c: string, vs: any[]) { const set = vs.map(String); this.filters.push((r) => set.includes(String(r[c]))); return this }
  lt(c: string, v: any) { this.filters.push((r) => String(r[c]) < String(v)); return this }
  gt(c: string, v: any) { this.filters.push((r) => String(r[c]) > String(v)); return this }
  order() { return this }
  limit(n: number) { this.max = n; return this }
  single() { this.wanted = 'single'; return this }
  maybeSingle() { this.wanted = 'maybe'; return this }

  then(resolve: (v: any) => any, reject?: (e: any) => any) {
    return Promise.resolve().then(() => this.run()).then(resolve, reject)
  }

  private run() {
    const rows = (tables[this.table] ||= [])
    if (this.op === 'insert') {
      const list = (Array.isArray(this.payload) ? this.payload : [this.payload]).map((r: Row) => ({ id: r.id ?? `${this.table}-${rows.length + 1}`, ...r }))
      for (const row of list) {
        const error = failInsert[this.table]?.(row) || databaseRules(this.table, row)
        if (error) return { data: null, error }
      }
      rows.push(...list)
      list.forEach((row: Row) => writes.push({ table: this.table, op: 'insert', row }))
      return { data: this.wanted ? list[0] : list, error: null }
    }
    const matched = rows.filter((r) => this.filters.every((f) => f(r)))
    if (this.op === 'update') {
      matched.forEach((r) => { Object.assign(r, this.payload); writes.push({ table: this.table, op: 'update', row: r }) })
      return { data: matched, error: null }
    }
    const out = matched.slice(0, this.max)
    if (this.wanted === 'single') return out.length === 1 ? { data: out[0], error: null } : { data: null, error: { code: 'PGRST116', message: 'no rows' } }
    if (this.wanted === 'maybe') return { data: out[0] ?? null, error: null }
    return { data: out, error: null }
  }
}

/**
 * Auth users, and the bearer tokens that sign them in. `auth.getUser(token)`
 * resolves a token here, so `_lib/auth.js` (requireStaff/requireAdmin) runs for
 * real against `tables.staff`.
 */
export const authUsers: Array<{ id: string; email: string }> = []
export const tokens: Record<string, string> = {}
/** Accounts whose password was changed through the admin API. */
export const passwordResets: string[] = []

const auth = {
  async getUser(token: string) {
    const user = authUsers.find((u) => u.id === tokens[token])
    return user ? { data: { user }, error: null } : { data: { user: null }, error: { message: 'invalid token' } }
  },
  admin: {
    async createUser({ email }: { email: string }) {
      if (authUsers.some((u) => u.email === email)) {
        return { data: { user: null }, error: { message: 'A user with this email address has already been registered' } }
      }
      const user = { id: `auth-${authUsers.length + 1}`, email }
      authUsers.push(user)
      return { data: { user }, error: null }
    },
    async listUsers() { return { data: { users: [...authUsers] }, error: null } },
    async updateUserById(id: string, attrs: { password?: string }) {
      if (attrs?.password) passwordResets.push(id)
      return { data: {}, error: null }
    },
  },
}

export function createClient() {
  return {
    from: (table: string) => new Query(table),
    rpc: async () => ({ data: true, error: null }), // rate limit: allowed
    auth,
  }
}
