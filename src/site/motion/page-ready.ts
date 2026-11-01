/**
 * "The page behind the intro is ready to be seen": the hero has mounted and
 * its poster has loaded (or failed). BrandIntro waits for this, with a cap, so
 * the curtain never opens on an empty frame.
 */
let ready = false
const listeners = new Set<() => void>()

export function markPageReady() {
  if (ready) return
  ready = true
  for (const fn of listeners) fn()
  listeners.clear()
}

export function whenPageReady(fn: () => void): () => void {
  if (ready) {
    fn()
    return () => {}
  }
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
