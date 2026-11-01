import { useSyncExternalStore } from 'react'

export const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'
export const MOTION_OK = '(prefers-reduced-motion: no-preference)'
/** A mouse or trackpad: hover effects and smooth scrolling apply. */
export const FINE_POINTER = '(hover: hover) and (pointer: fine)'
/** Where layouts switch from stacked to side by side (Tailwind `lg`). */
export const DESKTOP = '(min-width: 64rem)'
export const MOBILE = '(max-width: 63.98rem)'

function subscribeTo(query: string) {
  return (onChange: () => void) => {
    const mql = window.matchMedia(query)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }
}

export function useMediaQuery(query: string, fallback = false): boolean {
  return useSyncExternalStore(
    subscribeTo(query),
    () => window.matchMedia(query).matches,
    () => fallback,
  )
}

export function useReducedMotion(): boolean {
  return useMediaQuery(REDUCED_MOTION, true)
}

/** Read once, outside React — for code inside GSAP callbacks. */
export function prefersReducedMotion(): boolean {
  return typeof window === 'undefined' || window.matchMedia(REDUCED_MOTION).matches
}

/** Save-Data, a slow connection, or a low-power device (set by the head script). */
export function isLiteDevice(): boolean {
  if (typeof document === 'undefined') return true
  if ('lite' in document.documentElement.dataset) return true
  const c = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection
  return !!c && (!!c.saveData || /(^|-)2g$|^3g$/.test(c.effectiveType ?? ''))
}
