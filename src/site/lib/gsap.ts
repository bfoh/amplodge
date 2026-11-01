import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { SplitText } from 'gsap/SplitText'

// Registered once for the public site bundle. Components reach GSAP only
// through this module, so plugins are never registered twice and the defaults
// below apply everywhere.
gsap.registerPlugin(ScrollTrigger, SplitText, useGSAP)

gsap.defaults({ ease: 'expo.out', duration: 1.1 })
// Mobile address bars resize the viewport as they show and hide; re-measuring
// every trigger on each of those makes pinned sections jump.
ScrollTrigger.config({ ignoreMobileResize: true })

/** The motion vocabulary. Three eases cover nearly everything. */
export const ease = {
  /** Arrivals: quick start, long settle. */
  editorial: 'expo.out',
  /** Masks and wipes: symmetrical and deliberate. */
  mask: 'power4.inOut',
  /** Small UI fades. */
  soft: 'power2.out',
} as const

export { gsap, ScrollTrigger, SplitText, useGSAP }
