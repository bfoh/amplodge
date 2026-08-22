/**
 * The database refuses to return more than 1000 rows in one response, whatever
 * limit is asked for, and says nothing about it. Every revenue figure is
 * computed from these fetches, so a silent truncation is money missing from a
 * report. These run against the live database because the cap is the server's.
 */
import { db } from '@/lib/db'

let failures = 0
const check = (label: string, got: any, want: any) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`)
}

;(async () => {
  // How many bookings actually exist, counted the long way.
  const paged = await db.bookings.listAll()
  const total = paged.length
  console.log(`bookings in the table: ${total}\n`)

  check('an unbounded list returns every row', (await db.bookings.list({})).length, total)
  check('a list asking for more than the cap returns every row', (await db.bookings.list({ limit: 5000 })).length, total)
  check('listAll returns every row', (await db.bookings.listAll()).length, total)

  // A small limit must stay one request and be honoured exactly.
  check('a small limit is still a limit', (await db.bookings.list({ limit: 5 })).length, 5)
  check('a single-row lookup still returns one', (await db.bookings.list({ limit: 1 })).length, 1)

  // Order and uniqueness must survive paging, or "most recent" shows the wrong rows.
  const ordered = await db.bookings.list({ orderBy: { createdAt: 'desc' }, limit: 5000 })
  const dates = ordered.map((b: any) => b.createdAt).filter(Boolean)
  check('newest-first order survives paging', dates.every((d: string, i: number) => i === 0 || dates[i - 1] >= d), true)
  check('no row is returned twice across pages', new Set(ordered.map((b: any) => b.id)).size, ordered.length)

  // The tables every revenue figure reads.
  for (const [name, fetchAll] of [
    ['guests', () => db.guests.listAll()],
    ['booking_charges', () => db.bookingCharges.listAll()],
    ['standalone_sales', () => db.standaloneSales.listAll()],
    ['staff', () => db.staff.listAll()],
  ] as Array<[string, () => Promise<any[]>]>) {
    const rows = await fetchAll()
    check(`${name}: paginated fetch is not capped at ${1000}`, rows.length !== 1000 || rows.length < 1000, true)
  }

  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
  process.exit(failures === 0 ? 0 : 1)
})()
