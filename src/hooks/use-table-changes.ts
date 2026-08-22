import { useEffect, useRef } from 'react'
import { onTableUpdated, type TableChange } from '@/lib/db'

/**
 * Run a handler for each change to a table, with the row that changed.
 *
 * The counterpart to useSubscription, which only says "something moved" and
 * leaves the page to reload everything to find out what. When a page can patch
 * the single row that changed, that reload is the difference between one small
 * request and re-reading the table.
 *
 * Changes are batched briefly: a check-out writes the booking and its room in
 * quick succession, and handling that as one pass avoids two renders.
 */
export function useTableChanges(
  table: string,
  handler: (changes: TableChange[]) => void,
  { delay = 250 }: { delay?: number } = {}
) {
  // Kept in a ref so a handler that closes over state does not need to be
  // memoised by every caller to avoid resubscribing.
  const handlerRef = useRef(handler)
  handlerRef.current = handler

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    let pending: TableChange[] = []

    const flush = () => {
      timer = null
      const batch = pending
      pending = []
      if (batch.length) handlerRef.current(batch)
    }

    const unsubscribe = onTableUpdated(table, (change) => {
      // No payload means the change came from somewhere that cannot say what
      // moved; the caller decides what to do with an empty batch.
      pending.push(change ?? { eventType: 'UPDATE' })
      if (timer) clearTimeout(timer)
      timer = setTimeout(flush, delay)
    })

    return () => {
      unsubscribe()
      if (timer) clearTimeout(timer)
    }
  }, [table, delay])
}
