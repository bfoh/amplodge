const url = 'https://kfjncxphokthkuwypiea.supabase.co'
const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtmam5jeHBob2t0aGt1d3lwaWVhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU3MTY0NjAsImV4cCI6MjA4MTI5MjQ2MH0.zZwisLZ9FgN3VJydzDx6t5oRSqEmfBlJUpskEIfCobU'

async function sbFetch(table: string, select: string = '*', query: string = '') {
  const fullUrl = `${url}/rest/v1/${table}?select=${select}${query}`
  const res = await fetch(fullUrl, {
    headers: { apikey: key, Authorization: `Bearer ${key}` }
  })
  return res.json()
}

async function run() {
  const bookings = await sbFetch('bookings', 'id,status,created_at,check_in,total_price,created_by', '&limit=2000')

  const from = new Date('2026-05-04T00:00:00').getTime()
  const to = new Date('2026-05-10T23:59:59').getTime()

  const inWeek = bookings.filter((b: any) => {
    const checkIn = b.check_in ? new Date(b.check_in).getTime() : 0
    return checkIn >= from && checkIn <= to
  })

  console.log(`Found ${inWeek.length} bookings with check-in last week`)
  
  const statusCounts: Record<string, number> = {}
  inWeek.forEach((b: any) => {
    statusCounts[b.status] = (statusCounts[b.status] || 0) + 1
  })
  
  console.log('Status breakdown:', statusCounts)
  
  if (inWeek.length > 0) {
    console.log('Sample bookings in week:')
    inWeek.slice(0, 10).forEach(b => {
        console.log(`ID: ${b.id} | Status: ${b.status} | CheckIn: ${b.check_in} | Price: ${b.total_price}`)
    })
  }
}

run().catch(console.error)
