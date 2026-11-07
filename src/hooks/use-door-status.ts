import { useCallback, useEffect, useState } from 'react'
import { loadKeyCardBoard } from '@/services/key-cards'
import { doorStatuses, type DoorStatus } from '@/services/door-status'
import { useTableChanges } from '@/hooks/use-table-changes'

export interface DoorStatusMap {
  /** False until an admin has set at least one lock number: nothing to show then. */
  configured: boolean
  byRoomId: Map<string, DoorStatus>
  byRoomNumber: Map<string, DoorStatus>
  reload: () => void
}

/**
 * Each locked door's state, kept up to date as cards are made and marked, and
 * every few minutes (cards stop by themselves at their end time). Null while
 * loading; a page shows nothing extra when it cannot be loaded.
 */
export function useDoorStatus(): DoorStatusMap | null {
  const [state, setState] = useState<Omit<DoorStatusMap, 'reload'> | null>(null)

  const load = useCallback(async () => {
    try {
      const board = await loadKeyCardBoard()
      const byRoomId = doorStatuses(board)
      const byRoomNumber = new Map([...byRoomId.values()].map((s) => [s.roomNumber, s]))
      setState({ configured: board.configured, byRoomId, byRoomNumber })
    } catch (e) {
      console.warn('[door-status] could not load the key cards', e)
    }
  }, [])

  useEffect(() => {
    void load()
    const timer = setInterval(() => { void load() }, 5 * 60_000)
    return () => clearInterval(timer)
  }, [load])
  useTableChanges('key_cards', () => { void load() }, { delay: 800 })
  useTableChanges('bookings', () => { void load() }, { delay: 2000 })

  return state ? { ...state, reload: () => { void load() } } : null
}
