import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'
import type { Photo } from '../data/photos'
import { Reveal } from '../motion/Reveal'
import { SplitHeading } from '../motion/SplitHeading'
import { Picture } from './Picture'

interface PageHeroProps {
  eyebrow: string
  title: string
  intro?: ReactNode
  photo: Photo
  children?: ReactNode
  className?: string
  /** CSS object-position for the photograph. */
  focus?: string
}

/**
 * Inner-page opening: a photograph that settles from a slight zoom (CSS, held
 * until the app has booted), with the title rising through a mask.
 */
export function PageHero({ eyebrow, title, intro, photo, children, className, focus = '50% 50%' }: PageHeroProps) {
  return (
    <section className={cn('amp-on-dark relative flex min-h-[68svh] items-end overflow-hidden bg-amp-obsidian text-amp-ivory lg:min-h-[74svh]', className)} data-theme="dark">
      <div className="absolute inset-0">
        <div className="amp-page-hero__media absolute inset-0">
          <Picture photo={photo} sizes="100vw" priority className="h-full" style={{ objectPosition: focus }} />
        </div>
        <div className="absolute inset-0 bg-[linear-gradient(to_top,rgba(10,10,9,0.88)_0%,rgba(10,10,9,0.45)_45%,rgba(10,10,9,0.25)_100%)]" />
      </div>
      <div className="relative mx-auto w-full max-w-site px-gutter pb-14 pt-[calc(var(--amp-header-h)+4rem)] lg:pb-20">
        <Reveal play="intro" y={14}>
          <p className="amp-eyebrow text-amp-gold-soft">{eyebrow}</p>
        </Reveal>
        <SplitHeading as="h1" play="intro" delay={0.05} className="amp-display mt-5 max-w-4xl text-[clamp(2.8rem,8vw,6.5rem)]">
          {title}
        </SplitHeading>
        {intro && (
          <Reveal play="intro" delay={0.35} className="mt-6 max-w-2xl">
            <div className="amp-lede text-amp-ivory/85">{intro}</div>
          </Reveal>
        )}
        {children}
      </div>
    </section>
  )
}
