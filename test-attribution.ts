const url = 'https://kfjncxphokthkuwypiea.supabase.co'
const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtmam5jeHBob2t0aGt1d3lwaWVhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU3MTY0NjAsImV4cCI6MjA4MTI5MjQ2MH0.zZwisLZ9FgN3VJydzDx6t5oRSqEmfBlJUpskEIfCobU'

async function sbFetch(table: string, select: string = '*', query: string = '') {
  const fullUrl = `${url}/rest/v1/${table}?select=${select}${query}`
  const res = await fetch(fullUrl, {
    headers: { apikey: key, Authorization: `Bearer ${key}` }
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Fetch failed: ${res.status} ${text}`)
  }
  return res.json()
}

async function run() {
  const bookings = await sbFetch('bookings', 'id,status,check_in,created_by,check_in_by,check_out_by,total_price,special_requests', '&limit=1000')

  const from = new Date('2026-05-04T00:00:00').getTime()
  const to = new Date('2026-05-10T23:59:59').getTime()

  const inWeek = bookings.filter((b: any) => {
    const checkIn = b.check_in ? new Date(b.check_in).getTime() : 0
    return checkIn >= from && checkIn <= to && b.status === 'checked-out'
  })

  console.log(`Found ${inWeek.length} checked-out bookings for last week`)
  
  inWeek.forEach(b => {
    const sr = b.special_requests || ''
    const hasPayData = sr.includes('PAYMENT_DATA')
    const hasPayEvents = sr.includes('PAYMENT_EVENTS')
    console.log(`ID: ${b.id.slice(0, 8)} | CB: ${b.created_by?.slice(0, 8) || 'NONE'} | CIB: ${b.check_in_by?.slice(0, 8) || 'NONE'} | COB: ${b.check_out_by?.slice(0, 8) || 'NONE'} | PayData: ${hasPayData} | PayEvents: ${hasPayEvents} | Price: ${b.total_price}`)
  })
}

run().catch(console.error)
