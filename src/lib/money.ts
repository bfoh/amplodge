/**
 * Money apportionment.
 *
 * Splitting one payment across several rooms has to add back up to the payment.
 * Rounding each share independently does not: three rooms sharing GHS 1,500 by
 * price can land on GHS 1,500.01, and a cent that appears from nowhere in a
 * booking is a cent that has to be explained in a report later.
 */

/** Round to whole cents, the precision every stored money figure uses. */
export function toCents(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100
}

/**
 * Split `collected` across `weights` (room prices), proportionally.
 *
 * Shares are rounded to cents and the rounding residual is given to the largest
 * weight, so the result always adds up to `collected` exactly. A zero or
 * negative total collected gives every entry zero.
 */
export function allocateByWeight(weights: number[], collected: number): number[] {
  const total = weights.reduce((s, w) => s + (Number(w) || 0), 0)
  const amount = toCents(collected)
  if (!weights.length || amount <= 0 || total <= 0) return weights.map(() => 0)

  const shares = weights.map(w => toCents(((Number(w) || 0) / total) * amount))
  const assigned = shares.reduce((s, v) => s + v, 0)
  const residual = toCents(amount - assigned)
  if (residual !== 0) {
    const biggest = weights.reduce((best, w, i) => (w > weights[best] ? i : best), 0)
    shares[biggest] = toCents(shares[biggest] + residual)
  }
  return shares
}
