// GRP-2026-YCEA: rooms total GHS 6,600, group discount GHS 200, guest paid GHS
// 6,400. The discount sits on booking f9068ad9 (2400 room → final 2200), but
// that row's recorded payment still says 2400 because the booking form wrote
// each room's gross price for a full payment. Bring the recorded payment down
// to what that room actually took, so the group's recorded payment equals the
// money collected.
const APPLY = process.argv.includes('--apply')
const U = process.env.SUPABASE_URL, K = process.env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' }
const TARGET_PREFIX = 'f9068ad9'
const NEW_AMOUNT = 2200

const rows = await (await fetch(`${U}/rest/v1/bookings?select=id,total_price,discount_amount,final_amount,special_requests&special_requests=like.*YCEA*`, { headers: H })).json()
const p = (s, t) => { const m = (s || '').match(new RegExp(`<!-- ${t}:(.*?) -->`)); if (!m) return null; try { return JSON.parse(m[1]) } catch { return null } }

const before = rows.reduce((s, b) => s + (Number(p(b.special_requests, 'PAYMENT_DATA')?.amountPaid) || 0), 0)
const effective = rows.reduce((s, b) => s + (Number(b.discount_amount) > 0 ? Number(b.final_amount) : Number(b.total_price)), 0)
console.log(`recorded paid across group : ${before.toFixed(2)}`)
console.log(`what the rooms are worth   : ${effective.toFixed(2)}  (6600 rooms − 200 group discount)`)

const target = rows.find(b => b.id.startsWith(TARGET_PREFIX))
if (!target) { console.error('target row not found'); process.exit(1) }

let sr = target.special_requests
const pd = p(sr, 'PAYMENT_DATA')
const events = p(sr, 'PAYMENT_EVENTS') || []
console.log(`\nrow ${TARGET_PREFIX}: room ${target.total_price}, discount ${target.discount_amount}, final ${target.final_amount}`)
console.log(`  PAYMENT_DATA.amountPaid ${pd?.amountPaid} -> ${NEW_AMOUNT}`)
for (const e of events) if (e.stage === 'booking') console.log(`  booking event amount    ${e.amount} -> ${NEW_AMOUNT}`)

const newEvents = events.map(e => e.stage === 'booking'
  ? { ...e, amount: NEW_AMOUNT, splits: (e.splits || []).map(s => ({ ...s, amount: NEW_AMOUNT })) }
  : e)
sr = sr.replace(/<!-- PAYMENT_EVENTS:.*? -->/, `<!-- PAYMENT_EVENTS:${JSON.stringify(newEvents)} -->`)
sr = sr.replace(/<!-- PAYMENT_DATA:.*? -->/, `<!-- PAYMENT_DATA:${JSON.stringify({ ...pd, amountPaid: NEW_AMOUNT, perRoom: true })} -->`)

console.log(`\nafter this change recorded paid = ${(before - Number(pd?.amountPaid || 0) + NEW_AMOUNT).toFixed(2)} (target ${effective.toFixed(2)})`)

if (!APPLY) { console.log('\nDRY RUN — pass --apply to write.'); process.exit(0) }
const res = await fetch(`${U}/rest/v1/bookings?id=eq.${target.id}`, {
  method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify({ special_requests: sr }),
})
console.log(res.ok ? 'APPLIED' : `FAILED ${res.status}: ${await res.text()}`)
