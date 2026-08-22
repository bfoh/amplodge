/**
 * Patching the rows that changed, instead of reloading the page.
 *
 * Mirrors ReservationsPage.patchRows. The cases that matter are the ones that
 * are not a simple in-place update: a row that no longer comes back, and a row
 * that was not on screen before.
 */
let failures = 0
const check = (label: string, got: any, want: any) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`)
}

/** The page's reducer, given what came back for the ids it asked about. */
const patch = (prev: any[], wanted: string[], fresh: any[]) => {
  const byId = new Map(fresh.map(r => [r.id, r]))
  const next = prev.map(b => byId.get(b.id) ?? b)
  const gone = new Set(wanted.filter(id => !byId.has(id)))
  const kept = gone.size ? next.filter(b => !gone.has(b.id)) : next
  const known = new Set(kept.map(b => b.id))
  const added = [...byId.values()].filter(r => !known.has(r.id))
  return added.length ? [...added, ...kept] : kept
}

const rows = [
  { id: 'a', status: 'confirmed', total: 350 },
  { id: 'b', status: 'checked-in', total: 700 },
  { id: 'c', status: 'checked-out', total: 200 },
]

check('an updated row is replaced in place',
  patch(rows, ['b'], [{ id: 'b', status: 'checked-out', total: 700 }]).map(r => r.status),
  ['confirmed', 'checked-out', 'checked-out'])

check('the others are untouched',
  patch(rows, ['b'], [{ id: 'b', status: 'checked-out', total: 700 }]).map(r => r.id),
  ['a', 'b', 'c'])

check('a deleted row is dropped',
  patch(rows, ['b'], []).map(r => r.id), ['a', 'c'])

check('a row that fell outside the window is dropped too',
  patch(rows, ['a', 'c'], [{ id: 'a', status: 'cancelled', total: 350 }]).map(r => r.id), ['a', 'b'])

check('a new row lands at the top, where newest-first belongs',
  patch(rows, ['d'], [{ id: 'd', status: 'confirmed', total: 500 }]).map(r => r.id),
  ['d', 'a', 'b', 'c'])

check('asking about nothing changes nothing', patch(rows, [], []).map(r => r.id), ['a', 'b', 'c'])

check('several rows at once, as a group edit does',
  patch(rows, ['a', 'b'], [
    { id: 'a', status: 'checked-in', total: 350 },
    { id: 'b', status: 'checked-out', total: 700 },
  ]).map(r => r.status),
  ['checked-in', 'checked-out', 'checked-out'])

// A patched row must keep the shape the table draws from — this is what broke
// when a refetch replaced view rows with raw ones and charge totals vanished.
const fromListRow = (r: any): any => ({
  ...r,
  guestNameSnapshot: r.guestName || undefined,
  chargesTotal: Number(r.chargesTotal || 0),
})
const patched = patch(
  [fromListRow({ id: 'a', guestName: 'Ama', chargesTotal: 20 })],
  ['a'],
  [fromListRow({ id: 'a', guestName: 'Ama', chargesTotal: 45 })]
)
check('a patched row still carries the display fields', patched[0].guestNameSnapshot, 'Ama')
check('and its refreshed charge total', patched[0].chargesTotal, 45)

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
