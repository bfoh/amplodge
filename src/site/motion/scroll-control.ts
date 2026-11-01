import type Lenis from 'lenis'

/**
 * One shared handle on the smooth scroller (if any), so dialogs can pause it
 * and in-page links can scroll through it. Falls back to native scrolling.
 */
let lenis: Lenis | null = null
let locks = 0

export function setLenis(instance: Lenis | null) {
  lenis = instance
}

/** Counted, so a dialog opened from the menu doesn't unlock the page when it closes. */
export function lockScroll() {
  locks += 1
  if (locks > 1) return
  lenis?.stop()
  document.documentElement.dataset.scrollLocked = ''
}

export function unlockScroll() {
  locks = Math.max(0, locks - 1)
  if (locks > 0) return
  lenis?.start()
  delete document.documentElement.dataset.scrollLocked
}

export function scrollToTop() {
  if (lenis) {
    lenis.scrollTo(0, { immediate: true })
    return
  }
  window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
}

export function scrollToTarget(target: HTMLElement, offset = 0) {
  if (lenis) {
    lenis.scrollTo(target, { offset })
    return
  }
  const top = target.getBoundingClientRect().top + window.scrollY + offset
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  window.scrollTo({ top, behavior: reduce ? 'auto' : 'smooth' })
}

/** Scrolls to an absolute page offset (used to jump within a scroll-driven track). */
export function scrollToY(top: number) {
  if (lenis) {
    lenis.scrollTo(top)
    return
  }
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  window.scrollTo({ top, behavior: reduce ? 'auto' : 'smooth' })
}
