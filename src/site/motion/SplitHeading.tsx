import { useRef, type ElementType, type ReactNode } from 'react'

import { ease, gsap, SplitText, useGSAP } from '../lib/gsap'
import { onIntro } from './intro-state'
import { prefersReducedMotion } from './prefs'

interface SplitHeadingProps {
  as?: ElementType
  children: ReactNode
  className?: string
  id?: string
  /** "intro": plays on page entry (pre-hidden by CSS). "scroll": plays when scrolled into view. */
  play?: 'intro' | 'scroll'
  split?: 'lines' | 'words'
  delay?: number
  stagger?: number
}

/**
 * Masked line (or word) reveal. The text stays real, selectable text; screen
 * readers get the original string through SplitText's aria handling.
 */
export function SplitHeading({
  as: Tag = 'h2',
  children,
  className,
  id,
  play = 'scroll',
  split = 'lines',
  delay = 0,
  stagger = 0.085,
}: SplitHeadingProps) {
  const ref = useRef<HTMLElement>(null)

  useGSAP(
    () => {
      const el = ref.current
      if (!el) return
      if (prefersReducedMotion()) {
        gsap.set(el, { opacity: 1 })
        return
      }
      let stop = () => {}
      SplitText.create(el, {
        type: split === 'lines' ? 'lines' : 'words,lines',
        mask: split,
        aria: 'auto',
        autoSplit: true,
        onSplit(self) {
          gsap.set(el, { opacity: 1 })
          const targets = split === 'lines' ? self.lines : self.words
          const tween = gsap.from(targets, {
            yPercent: 115,
            rotate: 1.5,
            duration: 1.35,
            stagger,
            ease: ease.editorial,
            delay,
            paused: play === 'intro',
            scrollTrigger: play === 'scroll' ? { trigger: el, start: 'top 88%', once: true } : undefined,
          })
          if (play === 'intro') stop = onIntro(() => tween.play())
          return tween
        },
      })
      return () => stop()
    },
    { scope: ref },
  )

  return (
    <Tag ref={ref} id={id} className={className} data-intro={play === 'intro' ? '' : undefined}>
      {children}
    </Tag>
  )
}
