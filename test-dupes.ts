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
  const bookings = await sbFetch('bookings', 'id,room_id,guest_id,check_in,check_out,status', '&limit=2000')

  const seen = new Map<string, any[]>()
  bookings.forEach((b: any) => {
    const key = `${b.room_id}|${b.guest_id}|${b.check_in}|${b.check_out}`
    if (!seen.has(key)) seen.set(key, [])
    seen.get(key)!.push(b)
  })

  console.log('--- DUPLICATE BOOKINGS (Same Room, Guest, Dates) ---')
  let dupeCount = 0
  for (const [key, list] of seen.entries()) {
    if (list.length > 1) {
      dupeCount++
      console.log(`Key: ${key}`)
      list.forEach(b => {
        console.log(`  - ID: ${b.id} | Status: ${b.status}`)
      })
    }
  }
  console.log(`Total duplicate sets found: ${dupeCount}`)
}

run().catch(console.error)
