/**
 * The company total must equal the staff totals it is made of, and the rows
 * shown under it must add up to the total. Run against real production data.
 */
import {
  calculateCompanyPeriodRevenue,
  calculateStaffWeekResultInternal,
  getPastWeeksBounds,
  type StaffRevenueSharedData,
} from '@/services/revenue-service'

const U = process.env.SUPABASE_URL!, K = process.env.SUPABASE_SERVICE_ROLE_KEY!
const H = { apikey: K, Authorization: `Bearer ${K}` }
const get = async (path: string) => {
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

let failures = 0
const check = (label: string, got: any, want: any) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`)
}

;(async () => {
  const [bookings, properties, guests, chargesRaw, staffRows, sales] = await Promise.all([
    get('bookings?select=*'), get('properties?select=*'), get('guests?select=*'),
    get('booking_charges?select=*'), get('staff?select=*'), get('standalone_sales?select=*'),
  ])
  const shared: StaffRevenueSharedData = {
    bookings: bookings.map(camel), properties: properties.map(camel), guests: guests.map(camel),
    chargesRaw: chargesRaw.map(camel), staffRows: staffRows.map(camel), standaloneSales: sales.map(camel),
  }
  const staff = staffRows.map(camel)
  const chargesRaw2 = chargesRaw, salesRaw2 = sales

  const weeks = getPastWeeksBounds(12)
  let weeksChecked = 0
  for (const w of weeks) {
    const company = calculateCompanyPeriodRevenue(w.weekStart, w.weekEnd, shared)
    if (company.grandRevenue === 0) continue
    weeksChecked++

    // What a staff-table-driven total would show. It can be LOWER than the
    // company figure, because people who took money without a row in the staff
    // table still hold revenue — the company calculation finds them by the ids
    // on the bookings themselves. Every penny of the difference must be
    // accounted for by one of those identities; none may go missing.
    const tableIds = new Set(staff.flatMap((s: any) => [s.userId || s.user_id, s.id].filter(Boolean)))
    const tableTotal = staff.reduce((sum, s) => {
      const id = s.userId || s.user_id || s.id
      return sum + calculateStaffWeekResultInternal(id, w.weekStart, w.weekEnd, shared).grandRevenue
    }, 0)
    const offTable = company.byStaff
      .filter(x => !tableIds.has(x.staffId))
      .reduce((sum, x) => sum + x.grandRevenue, 0)
    check(`${w.weekStart}: company total = staff-table total + off-table staff + unassigned`,
      money(company.grandRevenue), money(tableTotal + offTable + company.unassignedRevenue))

    // The rows the breakdown card renders must add up to the room revenue above them.
    const rowsTotal = company.bookings.reduce((s, b) => s + b.amount, 0)
    check(`${w.weekStart}: breakdown rows add up to room revenue`, money(rowsTotal), money(company.roomRevenue))

    // Per-method figures must add up to the same room revenue.
    const methodTotal = company.bookings.reduce(
      (s, b) => s + Object.values(b.byMethod).reduce((x, v) => x + v, 0), 0)
    check(`${w.weekStart}: payment methods add up to room revenue`, money(methodTotal), money(company.roomRevenue))

    // And the components must make the grand total.
    check(`${w.weekStart}: grand = rooms + charges + sales + unassigned`,
      money(company.grandRevenue),
      money(company.roomRevenue + company.additionalRevenue + company.standaloneSalesRevenue + company.unassignedRevenue))

    // Nothing the hotel took may fall outside the total. Every charge and sale
    // in the period is either against a staff member or in the unassigned
    // bucket — never in neither.
    const inPeriod = (raw: string) => { const d = (raw || '').slice(0, 10); return !!d && d >= w.weekStart && d <= w.weekEnd }
    const chargesInWeek = chargesRaw2
      .filter((c: any) => inPeriod(c.created_at) && c.category !== 'room_extension')
      .reduce((s: number, c: any) => s + Number(c.amount || 0), 0)
    const salesInWeek = salesRaw2
      .filter((x: any) => inPeriod(x.sale_date))
      .reduce((s: number, x: any) => s + Number(x.amount || 0), 0)
    const countedExtras = company.additionalRevenue + company.standaloneSalesRevenue + company.unassignedRevenue
    check(`${w.weekStart}: every charge and sale is counted somewhere`,
      money(countedExtras) >= money(chargesInWeek + salesInWeek) - 0.02, true)

    // byStaff plus the unassigned bucket must explain the total. Money with no
    // staff recorded on it belongs to the hotel but to nobody in particular.
    check(`${w.weekStart}: byStaff + unassigned explains the total`,
      money(company.byStaff.reduce((s, x) => s + x.grandRevenue, 0) + company.unassignedRevenue),
      money(company.grandRevenue))

    // No booking may be credited beyond what it is worth once every identity
    // has had its share — the test that a person appearing under two ids would
    // fail.
    const overCredited = company.bookings.filter(b => {
      const row: any = shared.bookings.find((x: any) => x.id === b.id)
      if (!row) return false
      const disc = Number(row.discountAmount || row.discount_amount || 0)
      const worth = disc > 0 && (row.finalAmount ?? row.final_amount) != null
        ? Number(row.finalAmount ?? row.final_amount)
        : Number(row.totalPrice || row.total_price || 0) - disc
      return b.amount > worth + 0.02
    })
    check(`${w.weekStart}: no booking credited twice`, overCredited.length, 0)
  }

  console.log(`\n${weeksChecked} weeks with revenue checked`)
  console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`)
  process.exit(failures === 0 ? 0 : 1)
})()
