import { useSyncExternalStore } from 'react'

/**
 * The room the visitor last looked at in the film or picked in the navigator.
 * The booking panel at the end of the journey opens on it, so "this one"
 * carries through from the film to the dates. Session-only and in memory:
 * nothing is stored.
 */
let current: string | null = null
const listeners = new Set<() => void>()

export function setRoomChoice(slug: string | null) {
  if (slug === current) return
  current = slug
  listeners.forEach((fn) => fn())
}

export function useRoomChoice(): string | null {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    () => current,
    () => null,
  )
}
