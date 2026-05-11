import { db } from './src/lib/db'

async function run() {
  const allBookings = await db.bookings.list({ limit: 1000 })
  console.log('Total bookings:', allBookings.length)
  const from = new Date('2026-05-04T00:00:00')
  const to = new Date('2026-05-10T23:59:59')
  const inWeek = allBookings.filter(b => {
    const d = new Date(b.createdAt || b.created_at || b.checkIn || b.check_in)
    return d >= from && d <= to
  })
  console.log('Bookings in week 2026-05-04 -> 2026-05-10:', inWeek.length)
  if (inWeek.length > 0) {
    console.log('Sample booking:', {
      id: inWeek[0].id,
      createdAt: inWeek[0].createdAt || inWeek[0].created_at,
      status: inWeek[0].status,
      checkIn: inWeek[0].checkIn,
      createdBy: inWeek[0].createdBy,
      checkInBy: inWeek[0].checkInBy
    })
  }
}
run().catch(console.error)
