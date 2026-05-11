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
  const [bookings, staff] = await Promise.all([
    sbFetch('bookings', 'id,created_by,check_in_by,status,created_at,check_in', '&limit=100'),
    sbFetch('staff', 'id,name,user_id')
  ])

  console.log('--- STAFF MAPPING ---')
  staff.forEach((s: any) => {
    console.log(`Name: ${s.name} | StaffID: ${s.id} | UserID: ${s.user_id}`)
  })

  console.log('\n--- SAMPLE BOOKING ATTRIBUTION ---')
  bookings.slice(0, 5).forEach((b: any) => {
    console.log(`Booking ${b.id}: created_by=${b.created_by}, check_in_by=${b.check_in_by}`)
  })
}

run().catch(console.error)
