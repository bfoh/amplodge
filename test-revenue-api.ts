const url = 'https://kfjncxphokthkuwypiea.supabase.co'
const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtmam5jeHBob2t0aGt1d3lwaWVhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU3MTY0NjAsImV4cCI6MjA4MTI5MjQ2MH0.zZwisLZ9FgN3VJydzDx6t5oRSqEmfBlJUpskEIfCobU'

async function sbFetch(table: string, select: string = '*', query: string = '') {
  const fullUrl = `${url}/rest/v1/${table}?select=${select}${query}`
  const res = await fetch(fullUrl, {
    headers: { apikey: key, Authorization: `Bearer ${key}` }
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Failed to fetch ${table}: ${res.status} ${text}`)
  }
  return res.json()
}

async function run() {
  console.log('--- DATA AUDIT FOR 2026-05-04 -> 2026-05-10 ---')
  
  const [bookings, charges, sales, staff] = await Promise.all([
    sbFetch('bookings', '*', '&limit=3000'),
    sbFetch('booking_charges', '*', '&limit=5000'),
    sbFetch('standalone_sales', '*', '&limit=2000'),
    sbFetch('staff', '*')
  ])

  console.log(`Loaded ${bookings.length} bookings, ${charges.length} charges, ${sales.length} sales, ${staff.length} staff`)

  const from = new Date('2026-05-04T00:00:00').getTime()
  const to = new Date('2026-05-10T23:59:59').getTime()

  // Find all staff IDs
  const staffMap = new Map()
  staff.forEach((s: any) => {
    const sid = s.id
    const uid = s.userId || s.user_id
    const name = s.name || s.staffName || 'Unknown'
    if (sid) staffMap.set(sid, { sid, uid, name })
    if (uid) staffMap.set(uid, { sid, uid, name })
  })

  // Filter bookings in range
  const inWeekBookings = bookings.filter((b: any) => {
    const checkIn = b.check_in ? new Date(b.check_in).getTime() : 0
    const createdAt = b.created_at ? new Date(b.created_at).getTime() : 0
    // Based on revenue-service.ts:
    // For checked-in/out: use check-in date
    // For confirmed: use created_at date
    if (['checked-in', 'checked-out'].includes(b.status)) {
        return checkIn >= from && checkIn <= to
    }
    if (b.status === 'confirmed') {
        return createdAt >= from && createdAt <= to
    }
    return false
  })

  console.log(`Found ${inWeekBookings.length} relevant bookings for the week`)

  // Calculate revenue per staff
  const staffRevenue = new Map()

  inWeekBookings.forEach((b: any) => {
    const creators = [b.created_by, b.check_in_by, b.check_out_by].filter(Boolean)
    const uniqueCreators = [...new Set(creators)]
    
    // Simple attribution for audit: if you are in any of these fields, we look at you
    // Real logic in revenue-service is more complex (payment events), but let's see raw data first
    uniqueCreators.forEach((uid: any) => {
        if (!staffRevenue.has(uid)) staffRevenue.set(uid, { bookings: [], total: 0 })
        staffRevenue.get(uid).bookings.push(b.id)
        staffRevenue.get(uid).total += Number(b.total_price || 0)
    })
  })

  console.log('--- REVENUE CALCULATION (BOOKINGS) ---')
  staffRevenue.forEach((data, uid) => {
    const s = staffMap.get(uid)
    console.log(`Staff: ${s?.name || uid} (${uid}) -> ${data.bookings.length} bookings, Room Revenue: GHS ${data.total}`)
  })

  // Check charges
  const inWeekCharges = charges.filter((c: any) => {
    const d = new Date(c.created_at).getTime()
    return d >= from && d <= to
  })
  console.log(`Found ${inWeekCharges.length} charges created last week`)

  // Check sales
  const inWeekSales = sales.filter((s: any) => {
    const d = new Date(s.sale_date || s.created_at).getTime()
    return d >= from && d <= to
  })
  console.log(`Found ${inWeekSales.length} standalone sales last week`)
}

run().catch(console.error)
