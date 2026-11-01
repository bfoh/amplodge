import { useEffect, useState } from 'react'

import { db } from '@/lib/db'

export interface PublicReview {
  id: string
  name: string
  rating: number
  comment: string
  date: string
}

/** Below this, a "review" is a rating with no words (or a test entry): not shown as a testimonial. */
const MIN_COMMENT = 30

function displayName(raw: unknown): string {
  const parts = String(raw ?? '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return 'A guest'
  const first = parts[0][0].toUpperCase() + parts[0].slice(1)
  return parts[1] ? `${first} ${parts[1][0].toUpperCase()}.` : first
}

/**
 * Approved guest reviews with a written comment, newest and featured first.
 * Names are shortened to first name and initial. Nothing is ever padded with
 * invented quotes: if no review qualifies, the list is empty.
 */
export function useApprovedReviews(limit = 3) {
  const [reviews, setReviews] = useState<PublicReview[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  useEffect(() => {
    let alive = true
    db.reviews
      .list({ where: { status: 'approved' }, orderBy: { createdAt: 'desc' }, limit: 30 })
      .then((rows: Array<Record<string, unknown>>) => {
        if (!alive) return
        const list = rows
          .filter((r) => String(r.comment ?? '').trim().length >= MIN_COMMENT && Number(r.rating) > 0)
          .sort((a, b) => Number(!!b.isFeatured) - Number(!!a.isFeatured))
          .slice(0, limit)
          .map((r) => ({
            id: String(r.id),
            name: displayName(r.guest_name ?? r.guestName),
            rating: Math.max(1, Math.min(5, Math.round(Number(r.rating)))),
            comment: String(r.comment).trim(),
            date: String(r.createdAt ?? r.created_at ?? ''),
          }))
        setReviews(list)
        setStatus('ready')
      })
      .catch(() => alive && setStatus('error'))
    return () => {
      alive = false
    }
  }, [limit])
  return { reviews, status }
}
