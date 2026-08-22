/** Runs the money invariants over every week of real production data. */
import { calculateStaffWeekResultInternal, getPastWeeksBounds } from '@/services/revenue-service'

const U = process.env.SUPABASE_URL!, K = process.env.SUPABASE_SERVICE_ROLE_KEY!
const H = { apikey: K, Authorization: `Bearer ${K}` }
const get = async (path: string) => {
  // PostgREST caps a response at 1000 rows, so page through with Range headers.
  const out: any[] = []
  for (let from = 0; ; from += 1000) {
    const r = await fetch(`${U}/rest/v1/${path}`, { headers: { ...H, Range: `${from}-${from + 999}` } })
    const j = await r.json()
    if (!Array.isArray(j) || j.length === 0) break
    out.push(...j)
    if (j.length < 1000) break
  }
  return out
}
const camel = (row: any) => { const o: any = {}; for (const [k, v] of Object.entries(row)) { o[k] = v; o[k.replace(/_([a-z])/g, (_m, c) => c.toUpperCase())] = v } return o }
const money = (n: number) => Math.round(n * 100) / 100

let violations = 0
const fail = (msg: string) => { violations++; console.log('  VIOLATION ' + msg) }

;(async () => {
  const [bookings, properties, guests, chargesRaw, staffRows, sales] = await Promise.all([
    get('bookings?select=*&limit=3000'), get('properties?select=*&limit=500'), get('guests?select=*&limit=3000'),
    get('booking_charges?select=*&limit=5000'), get('staff?select=*&limit=200'), get('standalone_sales?select=*&limit=3000'),
  ])
  const shared: any = {
    bookings: bookings.map(camel), properties: properties.map(camel), guests: guests.map(camel),
    chargesRaw: chargesRaw.map(camel), staffRows: staffRows.map(camel), standaloneSales: sales.map(camel),
  }
  const staff = staffRows.map(camel)
  const weeks = getPastWeeksBounds(26)
  console.log(`Auditing ${weeks.length} weeks × ${staff.length} staff over ${bookings.length} bookings\n`)

  let weeksWithRevenue = 0, grandTotal = 0, rowsChecked = 0
  const bookingSeen = new Map<string, number>()

  for (const w of weeks) {
    let weekTotal = 0
    for (const s of staff) {
      const id = s.userId || s.user_id || s.id
      const r = calculateStaffWeekResultInternal(id, w.weekStart, w.weekEnd, shared)
      weekTotal += r.grandRevenue

      for (const b of r.bookings) {
        rowsChecked++
        const byMethod = money(Object.values(b.attributedByMethod || {}).reduce((x, v) => x + v, 0))
        if (byMethod !== money(b.staffAttributedRevenue))
          fail(`${w.weekStart} ${s.name}: ${b.id.slice(0,8)} methods ${byMethod} != attributed ${money(b.staffAttributedRevenue)}`)
        if (money(b.staffAttributedRevenue) > money(b.effectivePrice) + 0.01)
          fail(`${w.weekStart} ${s.name}: ${b.id.slice(0,8)} attributed ${b.staffAttributedRevenue} > worth ${b.effectivePrice}`)
        if (b.staffAttributedRevenue < 0 || b.effectivePrice < 0)
          fail(`${w.weekStart} ${s.name}: ${b.id.slice(0,8)} negative figure`)
        // Across all staff and weeks, one booking must never be credited beyond its value.
        const key = b.id
        bookingSeen.set(key, money((bookingSeen.get(key) || 0) + b.staffAttributedRevenue))
      }
      if (money(r.grandRevenue) !== money(r.totalRevenue + r.additionalRevenue + r.standaloneSalesRevenue))
        fail(`${w.weekStart} ${s.name}: grand != rooms + charges + sales`)
    }
    if (weekTotal > 0) { weeksWithRevenue++; grandTotal += weekTotal }
  }

  // Total credited for each booking, across every staff member and week.
  const priceOf = new Map<string, number>()
  for (const b of bookings) {
    const disc = Number(b.discount_amount || 0)
    const eff = disc > 0 && b.final_amount != null ? Number(b.final_amount) : Number(b.total_price || 0) - disc
    priceOf.set(b.id, money(eff))
  }
  let overCredited = 0
  for (const [id, credited] of bookingSeen) {
    const worth = priceOf.get(id) ?? 0
    if (credited > worth + 0.02) { overCredited++; fail(`booking ${id.slice(0,8)} credited ${credited} across staff/weeks but is worth ${worth}`) }
  }

  console.log(`rows checked        : ${rowsChecked}`)
  console.log(`bookings credited   : ${bookingSeen.size}`)
  console.log(`weeks with revenue  : ${weeksWithRevenue}`)
  console.log(`total revenue (26w) : GHS ${money(grandTotal).toFixed(2)}`)
  console.log(`over-credited       : ${overCredited}`)
  console.log(violations === 0 ? '\nNO INVARIANT VIOLATIONS' : `\n${violations} VIOLATION(S)`)
  process.exit(violations === 0 ? 0 : 1)
})()
