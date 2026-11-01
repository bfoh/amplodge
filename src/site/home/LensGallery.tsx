import { useState } from 'react'
import { Link } from 'react-router-dom'

import { cn } from '@/lib/utils'
import { ChapterLabel } from '../components/ChapterLabel'
import { Lightbox } from '../components/Lightbox'
import { Picture } from '../components/Picture'
import { PHOTOS, type Photo } from '../data/photos'
import { ImageReveal } from '../motion/ImageReveal'
import { SplitHeading } from '../motion/SplitHeading'

const PICKS: Array<{ photo: Photo; className: string; direction: 'up' | 'left' | 'right' | 'down' }> = [
  { photo: PHOTOS.exteriorNight, className: 'col-span-6 aspect-[4/3] lg:col-span-7 lg:row-span-2 lg:aspect-auto', direction: 'up' },
  { photo: PHOTOS.suiteLounge, className: 'col-span-3 aspect-[4/5] lg:col-span-5 lg:aspect-[16/10]', direction: 'left' },
  { photo: PHOTOS.bathroomShower, className: 'col-span-3 aspect-[4/5] lg:col-span-5 lg:aspect-[16/10]', direction: 'left' },
  { photo: PHOTOS.corridorMarble, className: 'col-span-3 aspect-[3/4] lg:col-span-3', direction: 'up' },
  { photo: PHOTOS.diningArea, className: 'col-span-3 aspect-[3/4] lg:col-span-4 lg:aspect-auto', direction: 'up' },
  { photo: PHOTOS.bedroomGreen, className: 'col-span-6 aspect-[16/10] lg:col-span-5 lg:aspect-auto', direction: 'right' },
]

/** Chapter 11 — Through the lens. Masked reveals; every photo opens in the viewer. */
export function LensGallery() {
  const [open, setOpen] = useState<number | null>(null)
  const photos = PICKS.map((p) => p.photo)
  return (
    <section className="amp-on-dark relative z-10 bg-amp-charcoal py-24 text-amp-ivory sm:py-32" aria-labelledby="lens-title" data-theme="dark">
      <div className="mx-auto max-w-site px-gutter">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <ChapterLabel no="11" tone="dark">
              Gallery
            </ChapterLabel>
            <SplitHeading id="lens-title" className="amp-display mt-6 text-[clamp(2.6rem,7vw,5.5rem)]">
              Through the lens.
            </SplitHeading>
          </div>
          <Link to="/gallery" className="amp-btn amp-btn--ghost-light self-start sm:self-auto">
            Full gallery <span className="amp-arrow" aria-hidden="true">→</span>
          </Link>
        </div>

        <ul className="mt-14 grid grid-cols-6 gap-3 sm:gap-4 lg:grid-cols-12 lg:gap-5">
          {PICKS.map((p, i) => (
            <li key={p.photo.slug} className={cn('relative', p.className)}>
              <ImageReveal direction={p.direction} delay={(i % 3) * 0.08} className="absolute inset-0 bg-amp-obsidian">
                <button type="button" className="amp-zoom-parent group block h-full w-full text-left" onClick={() => setOpen(i)}>
                  <Picture photo={p.photo} sizes="(min-width: 64rem) 40vw, 50vw" className="h-full" imgClassName="amp-zoom" />
                  <span className="sr-only">Open photo: {p.photo.caption}</span>
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-3 text-xs text-amp-ivory/90 opacity-100 transition-opacity duration-500 lg:p-4 lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-visible:opacity-100"
                  >
                    {p.photo.caption}
                  </span>
                </button>
              </ImageReveal>
            </li>
          ))}
        </ul>
      </div>
      <Lightbox photos={photos} index={open} onIndexChange={setOpen} />
    </section>
  )
}
