/**
 * Safe date parsing helpers.
 *
 * Wraps date-fns `parseISO` + `format` so passing `undefined`/`null`/empty
 * input never throws. The native `parseISO(undefined)` call internally does
 * `dateString.split(...)` which raises:
 *
 *     Cannot read properties of undefined (reading 'split')
 *
 * This module exists so render code can write
 *
 *     safeFormatDate(b.checkIn, 'MMM dd')
 *
 * instead of repeating ternary guards (`b.checkIn ? format(parseISO(...)) : '—'`)
 * at every call site. Use it anywhere a value typed as `string` may be
 * `undefined` at runtime — typical for legacy DB rows, partially-loaded
 * objects, and unioned record shapes.
 */

import { parseISO, format } from 'date-fns'

/**
 * Parse an ISO date string. Returns `null` on missing/empty/invalid input
 * instead of throwing. Use when the caller wants to branch on validity.
 */
export function safeParseISO(value: string | null | undefined): Date | null {
  if (!value || typeof value !== 'string') return null
  try {
    const d = parseISO(value)
    return isNaN(d.getTime()) ? null : d
  } catch {
    return null
  }
}

/**
 * Format an ISO date string with a date-fns pattern. Returns `fallback`
 * (default `'—'`) when the input is missing or unparsable.
 */
export function safeFormatDate(
  value: string | null | undefined,
  pattern: string,
  fallback: string = '—'
): string {
  const d = safeParseISO(value)
  if (!d) return fallback
  try {
    return format(d, pattern)
  } catch {
    return fallback
  }
}

/**
 * Return a yyyy-MM-dd ISO date string from a Date | string | undefined input.
 * Empty string on failure — matches the legacy ad-hoc `(d || '').split('T')[0]`
 * idiom littered across the code, but rejects bad Date objects too.
 */
export function safeToISODate(value: Date | string | null | undefined): string {
  if (!value) return ''
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? '' : value.toISOString().split('T')[0]
  }
  if (typeof value === 'string') {
    // Already an ISO date or ISO date-time — strip the time portion.
    return value.split('T')[0] || ''
  }
  return ''
}
