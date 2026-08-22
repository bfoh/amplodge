/** Runs the money invariants over every week of real production data. */
import { calculateStaffWeekResultInternal, calculateCompanyPeriodRevenue, getPastWeeksBounds } from '@/services/revenue-service'

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
  // Every identity that holds revenue, including staff with no row in the staff
  // table — a table-only sweep silently skips their bookings.
  const identities = new Map<string, string>()
  for (const s of staffRows.map(camel)) identities.set(s.userId || s.user_id || s.id, s.name || s.id)
  {
    const probe = calculateCompanyPeriodRevenue('2000-01-01', '2100-01-01', shared)
    for (const s of probe.byStaff) if (!identities.has(s.staffId)) identities.set(s.staffId, s.staffName)
  }
  const staff = [...identities].map(([id, name]) => ({ id, userId: id, name }))
  console.log(`identities holding revenue: ${staff.length} (${staffRows.length} in the staff table)`)
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

  // Nothing recorded from here on may be unattributed. History is allowed its
  // 24 honestly-contested charges; anything created after the day the write
  // paths were fixed means a hole has reopened.
  const ATTRIBUTION_ENFORCED_FROM = '2026-08-23'
  const newOrphans = chargesRaw.filter((c: any) => !c.created_by && (c.created_at || '') >= ATTRIBUTION_ENFORCED_FROM)
  const newOrphanSales = sales.filter((s: any) => !String(s.staff_id || '').trim() && (s.sale_date || '') >= ATTRIBUTION_ENFORCED_FROM)
  if (newOrphans.length || newOrphanSales.length) {
    fail(`${newOrphans.length} charge(s) and ${newOrphanSales.length} sale(s) recorded since ${ATTRIBUTION_ENFORCED_FROM} name no staff member`)
    for (const c of newOrphans.slice(0, 10)) console.log(`    charge ${c.id} ${c.created_at?.slice(0, 10)} GHS ${c.amount} — ${c.description}`)
    for (const s of newOrphanSales.slice(0, 10)) console.log(`    sale   ${s.id} ${s.sale_date} GHS ${s.amount} — ${s.description}`)
  } else {
    console.log(`unattributed since ${ATTRIBUTION_ENFORCED_FROM}: none`)
  }

  console.log(`rows checked        : ${rowsChecked}`)
  console.log(`bookings credited   : ${bookingSeen.size}`)
  console.log(`weeks with revenue  : ${weeksWithRevenue}`)
  console.log(`total revenue (26w) : GHS ${money(grandTotal).toFixed(2)}`)
  console.log(`over-credited       : ${overCredited}`)
  console.log(violations === 0 ? '\nNO INVARIANT VIOLATIONS' : `\n${violations} VIOLATION(S)`)
  process.exit(violations === 0 ? 0 : 1)
})()
