import { config } from 'dotenv'
config({ path: '.env.local' })
config({ path: '.env' })

// Mock import.meta.env
;(globalThis as any).import = {
  meta: {
    env: { ...process.env }
  }
}

import { db } from './src/lib/db'

async function run() {
  const allBookings = await db.bookings.list({ limit: 1000 })
  console.log('Total bookings:', allBookings.length)
  const from = new Date('2026-05-04T00:00:00')
  const to = new Date('2026-05-10T23:59:59')
  const inWeek = allBookings.filter((b: any) => {
    const d = new Date(b.createdAt || b.created_at || b.checkIn || b.check_in)
    return d >= from && d <= to
  })
  console.log('Bookings in week 2026-05-04 -> 2026-05-10:', inWeek.length)
  if (inWeek.length > 0) {
    console.log('Sample bookings:');
    inWeek.slice(0, 3).forEach((b: any) => {
      console.log({
        id: b.id,
        createdAt: b.createdAt || b.created_at,
        status: b.status,
        checkIn: b.checkIn || b.check_in,
        createdBy: b.createdBy || b.created_by,
        checkInBy: b.checkInBy || b.check_in_by,
        paymentStatus: b.paymentStatus || b.payment_status,
        amountPaid: b.amountPaid || b.amount_paid,
        totalPrice: b.totalPrice || b.total_price
      });
    });
  }
}
run().catch(console.error)
