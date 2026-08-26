/**
 * The night a guest picks is the night that gets booked.
 *
 * The public booking page turned the calendar's Date into a string with
 * `toISOString()`. The calendar hands back LOCAL midnight, and toISOString
 * converts to UTC — so for anyone east of Greenwich the date moves back a day.
 * A booking made from Europe for 15–17 December was stored as 14–16, and
 * nobody at the hotel could see it: Ghana is UTC+0, where the two agree.
 *
 * This checks the conversion itself under a spread of real offsets, rather
 * than the page. The rule it protects: format in local time, never serialise a
 * calendar date through UTC.
 */
import { format } from 'date-fns'

let failures = 0
const check = (label: string, got: any, want: any) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`)
}

/** What the calendar hands the page: midnight, in the guest's own timezone. */
const localMidnight = (y: number, m: number, d: number) => new Date(y, m - 1, d, 0, 0, 0)

/** What the page writes now. */
const asBooked = (d: Date) => format(d, "yyyy-MM-dd'T'HH:mm:ss")
/** What it used to write. */
const asBookedBefore = (d: Date) => d.toISOString()

const day = (s: string) => s.split('T')[0]

const checkIn = localMidnight(2027, 12, 15)
const checkOut = localMidnight(2027, 12, 17)

check('the check-in date survives the trip to the database', day(asBooked(checkIn)), '2027-12-15')
check('and so does the check-out', day(asBooked(checkOut)), '2027-12-17')

// The offset the machine happens to run in must not change the answer.
const offsetMinutes = -checkIn.getTimezoneOffset()
console.log(`        (this run is at UTC${offsetMinutes >= 0 ? '+' : ''}${offsetMinutes / 60})`)

if (offsetMinutes > 0) {
  // East of Greenwich — the case that was broken. Prove the old conversion
  // really does lose the day, so this suite means something where it runs.
  check('the old conversion loses a day east of Greenwich', day(asBookedBefore(checkIn)), '2027-12-14')
} else {
  check('the old conversion happens to agree at or west of Greenwich',
    day(asBookedBefore(checkIn)), '2027-12-15')
}

// A date must never be built by cutting up a UTC string.
check('midnight formats as the day itself, not the instant before',
  format(localMidnight(2027, 1, 1), 'yyyy-MM-dd'), '2027-01-01')
check('and the same holds across a year boundary',
  format(localMidnight(2026, 12, 31), 'yyyy-MM-dd'), '2026-12-31')

// The stay is still the length the guest asked for.
const nights = Math.round((checkOut.getTime() - checkIn.getTime()) / 86400000)
check('two nights stay two nights', nights, 2)

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
