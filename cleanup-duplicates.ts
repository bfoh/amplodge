const url = 'https://kfjncxphokthkuwypiea.supabase.co'
const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtmam5jeHBob2t0aGt1d3lwaWVhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU3MTY0NjAsImV4cCI6MjA4MTI5MjQ2MH0.zZwisLZ9FgN3VJydzDx6t5oRSqEmfBlJUpskEIfCobU'

async function sbFetch(table: string, select: string = '*', query: string = '', method: string = 'GET', body: any = null) {
  const fullUrl = `${url}/rest/v1/${table}?${query}`
  const headers: any = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' }
  const res = await fetch(fullUrl, {
    method,
    headers,
    body: body ? JSON.stringify(body) : null
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`HTTP ${res.status}: ${text}`)
  }
  return res.status === 204 ? null : res.json()
}

const statusPriority: Record<string, number> = {
  'checked-out': 4,
  'checked-in': 3,
  'confirmed': 2,
  'reserved': 1,
  'cancelled': 0
}

async function run() {
  console.log('🔍 Fetching all bookings for cleanup...')
  const bookings = await sbFetch('bookings', 'id,room_id,guest_id,check_in,check_out,status,created_at', 'select=id,room_id,guest_id,check_in,check_out,status,created_at&limit=2000')

  const seen = new Map<string, any[]>()
  bookings.forEach((b: any) => {
    const key = `${b.room_id}|${b.guest_id}|${b.check_in}|${b.check_out}`
    if (!seen.has(key)) seen.set(key, [])
    seen.get(key)!.push(b)
  })

  const idsToDelete: string[] = []
  
  for (const [key, list] of seen.entries()) {
    if (list.length > 1) {
      console.log(`Duplicate set found for ${key}:`)
      
      // Sort: highest priority status first, then newest created_at
      list.sort((a, b) => {
        const pa = statusPriority[a.status] ?? -1
        const pb = statusPriority[b.status] ?? -1
        if (pa !== pb) return pb - pa
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      })

      const winner = list[0]
      console.log(`  ✅ KEEP: ${winner.id} (${winner.status})`)
      
      for (let i = 1; i < list.length; i++) {
        console.log(`  ❌ DELETE: ${list[i].id} (${list[i].status})`)
        idsToDelete.push(list[i].id)
      }
    }
  }

  if (idsToDelete.length === 0) {
    console.log('No duplicates found to delete.')
    return
  }

  console.log(`\nDeleting ${idsToDelete.length} duplicate bookings...`)
  
  // Supabase REST delete doesn't support IN with many items easily in one request if too long,
  // but for 20-30 IDs it's fine with .in() equivalent in query string.
  for (const id of idsToDelete) {
    process.stdout.write(`Deleting ${id}... `)
    await sbFetch('bookings', '', `id=eq.${id}`, 'DELETE')
    console.log('Done.')
  }

  console.log('\nCleanup complete!')
}

run().catch(console.error)
