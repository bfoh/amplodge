/**
 * What the Reservations header says when the total is known, unknown, or wrong.
 * "250 of 0" reached production because a failed count was read as zero and the
 * page did arithmetic on it.
 */
let failures = 0
const check = (label: string, got: any, want: any) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`)
}

// Mirrors the page.
const render = (rows: number, totalCount: number | null, showOlder: boolean) => {
  const showTotal = !showOlder && totalCount !== null && totalCount >= rows
  return {
    badge: showTotal ? `${rows} of ${totalCount!.toLocaleString()}` : String(rows),
    older: showTotal ? `${(totalCount! - rows).toLocaleString()} older ones are not loaded` : null,
    button: showOlder ? 'Show recent only' : showTotal ? `Load all ${totalCount!.toLocaleString()}` : 'Show older reservations',
  }
}

check('known total reads plainly', render(250, 1005, false).badge, '250 of 1,005')
check('and says how many are held back', render(250, 1005, false).older, '755 older ones are not loaded')
check('the button names the number', render(250, 1005, false).button, 'Load all 1,005')

// The bug that shipped.
check('a failed count shows no total at all', render(250, null, false).badge, '250')
check('and claims nothing about older rows', render(250, null, false).older, null)
check('the button stays vague rather than wrong', render(250, null, false).button, 'Show older reservations')

// A count smaller than what is on screen is not to be believed either.
check('an impossible total is ignored', render(250, 0, false).badge, '250')
check('never a negative remainder', render(250, 0, false).older, null)

// Everything loaded: no window to explain.
check('showing everything needs no total', render(1005, 1005, true).badge, '1005')
check('and offers the way back', render(1005, 1005, true).button, 'Show recent only')

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
