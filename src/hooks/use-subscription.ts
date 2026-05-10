import { useEffect, useState } from 'react'
import { onTableUpdated } from '@/lib/db'

/**
 * A hook that subscribes to table updates and returns a counter that increments
 * whenever the table is updated. Use this to trigger re-fetches in useEffect.
 * 
 * @param table The table name to subscribe to (e.g., 'bookings', 'inventory')
 * @returns An 'updatedAt' timestamp that changes on every update
 */
export function useSubscription(table: string) {
  const [updatedAt, setUpdatedAt] = useState(Date.now())

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | null = null

    const handleUpdate = () => {
      if (timeout) clearTimeout(timeout)
      timeout = setTimeout(() => {
        setUpdatedAt(Date.now())
      }, 500) // 500ms debounce
    }

    // onTableUpdated returns a cleanup function
    const unsubscribe = onTableUpdated(table, handleUpdate)

    return () => {
      unsubscribe()
      if (timeout) clearTimeout(timeout)
    }
  }, [table])

  return updatedAt
}
