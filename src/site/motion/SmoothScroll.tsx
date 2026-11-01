import Lenis from 'lenis'
import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

import { gsap, ScrollTrigger } from '../lib/gsap'
import { FINE_POINTER, isLiteDevice, prefersReducedMotion } from './prefs'
import { scrollToTarget, scrollToTop, setLenis } from './scroll-control'

/**
 * If the app took longer than this to boot, the CSS failsafes (6 s) may
 * already be showing content, so the motion system stays out of the way.
 */
const FAILSAFE_MARGIN_MS = 5500

/**
 * Boots the motion system for the public site. Render once, inside the layout.
 * - flags html[data-motion-ready] so the CSS failsafes stand down;
 * - runs Lenis only for fine-pointer devices without reduced motion and not in
 *   lite mode. Touch keeps native momentum scrolling, and nothing scroll-jacks:
 *   Lenis only smooths wheel input, it never snaps or hijacks sections;
 * - drives Lenis from GSAP's ticker so ScrollTrigger stays in lockstep;
 * - resets scroll on navigation and re-measures every trigger.
 */
export function SmoothScroll() {
  const { pathname, hash } = useLocation()

  useEffect(() => {
    if (performance.now() < FAILSAFE_MARGIN_MS) document.documentElement.dataset.motionReady = ''
    // Webfonts change line lengths; re-measure once they're in.
    document.fonts?.ready.then(() => ScrollTrigger.refresh()).catch(() => {})
    if (prefersReducedMotion() || isLiteDevice() || !window.matchMedia(FINE_POINTER).matches) return

    const lenis = new Lenis({ lerp: 0.1, autoRaf: false })
    const tick = (time: number) => lenis.raf(time * 1000)
    lenis.on('scroll', ScrollTrigger.update)
    gsap.ticker.add(tick)
    gsap.ticker.lagSmoothing(0)
    setLenis(lenis)

    return () => {
      gsap.ticker.remove(tick)
      gsap.ticker.lagSmoothing(500, 33)
      lenis.destroy()
      setLenis(null)
    }
  }, [])

  // New route content mounts after navigation: go to the top (or the hash
  // target) and re-measure every trigger once it has laid out.
  useEffect(() => {
    let raf2 = 0
    const raf = requestAnimationFrame(() => {
      const target = hash ? document.getElementById(decodeURIComponent(hash.slice(1))) : null
      if (target) scrollToTarget(target, -80)
      else scrollToTop()
      raf2 = requestAnimationFrame(() => ScrollTrigger.refresh())
    })
    return () => {
      cancelAnimationFrame(raf)
      cancelAnimationFrame(raf2)
    }
  }, [pathname, hash])

  return null
}
