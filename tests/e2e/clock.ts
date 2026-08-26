/**
 * A fixed clock for suites that assert on a particular week.
 *
 * The money suites pin a week — Mon 2026-08-17 to Sun 2026-08-23 — and check
 * what each staff member is credited within it. Revenue is attributed to the
 * period the money was actually collected in, which the code reads from the
 * payment event's `paidAt` and, for a deposit on a booking that has not
 * started, the booking's `created_at`. Both are stamped with `new Date()` at
 * the moment the fixture runs.
 *
 * So the suites passed on the day they were written and reported every figure
 * as zero from the following Monday onwards: the fixtures were being created
 * outside the week they assert about. Nothing was wrong with the code they
 * cover, which is the worst kind of failing test — it goes red on its own and
 * teaches everyone to ignore it.
 *
 * Freezing the clock inside the pinned week makes the fixtures land where the
 * assertions expect, whenever the suite is run. `new Date(...)` with arguments
 * is untouched, so every explicit date in a suite still means what it says.
 */

const RealDate = Date

/** Midday Saturday, inside the week the money suites pin. */
export const FROZEN_NOW = '2026-08-22T12:00:00.000Z'

export function freezeClock(iso: string = FROZEN_NOW): void {
  const fixed = new RealDate(iso).getTime()

  class FrozenDate extends RealDate {
    constructor(...args: any[]) {
      if (args.length === 0) super(fixed)
      // @ts-expect-error — forwarding the real constructor's overloads
      else super(...args)
    }
    static now() { return fixed }
  }

  ;(globalThis as any).Date = FrozenDate
}

/** Put the real clock back. Only needed if a suite wants to measure elapsed time. */
export function restoreClock(): void {
  ;(globalThis as any).Date = RealDate
}
