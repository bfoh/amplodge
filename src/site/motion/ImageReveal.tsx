import { useRef, type ReactNode } from 'react'

import { cn } from '@/lib/utils'
import { ease, gsap, useGSAP } from '../lib/gsap'
import { onIntro } from './intro-state'
import { prefersReducedMotion } from './prefs'

const FROM = {
  up: 'inset(100% 0% 0% 0%)',
  down: 'inset(0% 0% 100% 0%)',
  left: 'inset(0% 0% 0% 100%)',
  right: 'inset(0% 100% 0% 0%)',
} as const

interface ImageRevealProps {
  children: ReactNode
  className?: string
  /** Direction the mask opens towards. */
  direction?: keyof typeof FROM
  delay?: number
  play?: 'intro' | 'scroll'
  /** Scale of the inner media at the start of the reveal. */
  scale?: number
}

/**
 * The frame opens with a clip-path while the photograph inside settles from a
 * slight zoom, like a print drawn from a sleeve. Nothing is pre-hidden by CSS
 * for the scroll variant, so without JS the photograph simply shows.
 */
export function ImageReveal({ children, className, direction = 'up', delay = 0, play = 'scroll', scale = 1.18 }: ImageRevealProps) {
  const ref = useRef<HTMLDivElement>(null)

  useGSAP(
    () => {
      const el = ref.current
      if (!el || prefersReducedMotion()) return
      const inner = el.firstElementChild
      const tl = gsap.timeline({
        delay,
        paused: play === 'intro',
        scrollTrigger: play === 'scroll' ? { trigger: el, start: 'top 90%', once: true } : undefined,
      })
      tl.set(el, { opacity: 1 })
      tl.fromTo(el, { clipPath: FROM[direction] }, { clipPath: 'inset(0% 0% 0% 0%)', duration: 1.5, ease: ease.mask })
      if (inner) tl.fromTo(inner, { scale }, { scale: 1, duration: 1.9, ease: ease.editorial }, 0)
      tl.set(el, { clearProps: 'clipPath' })
      if (play === 'intro') return onIntro(() => tl.play())
    },
    { scope: ref },
  )

  return (
    <div ref={ref} className={cn('overflow-hidden', className)} data-intro={play === 'intro' ? '' : undefined}>
      {children}
    </div>
  )
}
