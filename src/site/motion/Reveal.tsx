import { useRef, type ElementType, type ReactNode } from 'react'

import { ease, gsap, useGSAP } from '../lib/gsap'
import { onIntro } from './intro-state'
import { prefersReducedMotion } from './prefs'

interface RevealProps {
  as?: ElementType
  id?: string
  children: ReactNode
  className?: string
  /** Animate `[data-reveal-item]` descendants in sequence instead of the wrapper. */
  stagger?: number
  y?: number
  delay?: number
  play?: 'intro' | 'scroll'
  start?: string
}

/** A quiet rise-and-fade as content enters the viewport. */
export function Reveal({
  as: Tag = 'div',
  id,
  children,
  className,
  stagger,
  y = 28,
  delay = 0,
  play = 'scroll',
  start = 'top 88%',
}: RevealProps) {
  const ref = useRef<HTMLElement>(null)

  useGSAP(
    () => {
      const el = ref.current
      if (!el) return
      if (prefersReducedMotion()) {
        gsap.set(el, { opacity: 1 })
        return
      }
      const items = stagger !== undefined ? gsap.utils.toArray<HTMLElement>('[data-reveal-item]', el) : [el]
      if (stagger !== undefined) gsap.set(el, { opacity: 1 })
      // fromTo, not from: intro elements are held at opacity 0 by CSS, so "from"
      // would animate 0 → 0. Opacity only, never visibility: waiting content
      // stays in the accessibility tree and the tab order.
      const tween = gsap.fromTo(
        items,
        { opacity: 0, y },
        {
          opacity: 1,
          y: 0,
          duration: 1.2,
          stagger: stagger ?? 0,
          delay,
          ease: ease.editorial,
          paused: play === 'intro',
          scrollTrigger: play === 'scroll' ? { trigger: el, start, once: true } : undefined,
        },
      )
      if (play === 'intro') return onIntro(() => tween.play())
    },
    { scope: ref },
  )

  return (
    <Tag ref={ref} id={id} className={className} data-intro={play === 'intro' ? '' : undefined}>
      {children}
    </Tag>
  )
}
