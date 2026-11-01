import { useRef, type ReactNode } from 'react'

import { cn } from '@/lib/utils'
import { gsap, useGSAP } from '../lib/gsap'
import { prefersReducedMotion } from './prefs'

interface ParallaxProps {
  children: ReactNode
  className?: string
  /** Travel as a percentage of the frame height, each direction. */
  amount?: number
}

/**
 * The photograph drifts inside a fixed frame as the page scrolls. The inner
 * layer is oversized by `amount` so the edges never show.
 */
export function Parallax({ children, className, amount = 8 }: ParallaxProps) {
  const ref = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)

  useGSAP(
    () => {
      if (!ref.current || !innerRef.current || prefersReducedMotion()) return
      // yPercent is relative to the oversized inner layer, so scale the travel
      // down to exactly `amount`% of the frame.
      const travel = amount / (1 + (2 * amount) / 100)
      gsap.fromTo(
        innerRef.current,
        { yPercent: -travel },
        {
          yPercent: travel,
          ease: 'none',
          scrollTrigger: { trigger: ref.current, start: 'top bottom', end: 'bottom top', scrub: true },
        },
      )
    },
    { scope: ref },
  )

  return (
    <div ref={ref} className={cn('relative overflow-hidden', className)}>
      <div ref={innerRef} className="absolute inset-x-0 will-change-transform" style={{ top: `-${amount}%`, bottom: `-${amount}%` }}>
        {children}
      </div>
    </div>
  )
}
