import { allocateByWeight } from '@/lib/money'

/** The app's own apportionment rule, exercised directly. */
const allocate = (roomTotals: number[], collectedTotal: number) => allocateByWeight(roomTotals, collectedTotal)

let failures = 0
const check = (label: string, got: any, want: any) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) console.log(`      got ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`)
}
const sum = (a: number[]) => Math.round(a.reduce((s, v) => s + v, 0) * 100) / 100

// GRP-2026-YCEA: 6 rooms at 700 + one at 2400 = 6600, less a 200 group
// discount = 6400 actually collected.
{
  const rooms = [700, 700, 700, 700, 700, 700, 2400]
  const got = allocate(rooms, 6400)
  check('YCEA shape adds up to the money collected', sum(got), 6400)
  check('no room is credited its gross price', got.every((v, i) => v < rooms[i]), true)
}

// Single room: the whole collected figure, charges and discount included.
check('single room takes the whole payment', allocate([350], 400), [400])
check('single room part payment', allocate([350], 120), [120])

// No discount, no charges: each room gets its own price back exactly.
check('undiscounted group is unchanged', allocate([350, 450, 700], 1500), [350, 450, 700])

// Rounding residual must land somewhere, not vanish.
{
  const got = allocate([100, 100, 100], 100)
  check('thirds still add up exactly', sum(got), 100)
  check('residual goes to a real room', got.filter(v => v > 0).length, 3)
}

// Part payment across an awkward split.
{
  const rooms = [333, 333, 334]
  const got = allocate(rooms, 500)
  check('awkward split adds up', sum(got), 500)
}

// Nothing collected: nothing allocated.
check('pending payment allocates nothing', allocate([350, 700], 0), [0, 0])

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
