import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { cn } from '@/lib/utils'
import { Lightbox } from '../components/Lightbox'
import { PageHero } from '../components/PageHero'
import { Picture } from '../components/Picture'
import { GALLERY, PHOTOS, type Photo } from '../data/photos'
import { useDocumentMeta } from '../seo/useDocumentMeta'

const FILTERS = ['All', 'Exterior', 'Rooms', 'Interiors', 'Bathrooms', 'Shared spaces'] as const
type Filter = (typeof FILTERS)[number]

export default function GalleryPage() {
  const [filter, setFilter] = useState<Filter>('All')
  const [open, setOpen] = useState<number | null>(null)
  const photos = useMemo<Photo[]>(() => (filter === 'All' ? GALLERY : GALLERY.filter((p) => p.category === filter)), [filter])

  useDocumentMeta({
    title: 'Gallery | AMP Lodge, Kumasi',
    description: 'Photographs of AMP Lodge in Abuakwa, Kumasi: the stone façade, rooms, suites, bathrooms and shared spaces.',
    path: '/gallery',
  })

  return (
    <>
      <PageHero eyebrow="Gallery" title="Through the lens." intro="The lodge as it is: our own photographs of the building, rooms and shared spaces." photo={PHOTOS.exteriorNight} focus="50% 40%" />

      <section className="bg-amp-ivory py-16 sm:py-24" aria-labelledby="gallery-title">
        <div className="mx-auto max-w-site px-gutter">
          <h2 id="gallery-title" className="sr-only">
            Photographs
          </h2>
          <div role="group" aria-label="Filter photographs" className="-mx-gutter flex gap-2 overflow-x-auto px-gutter pb-2 [scrollbar-width:none]">
            {FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={filter === f}
                onClick={() => setFilter(f)}
                className={cn(
                  'amp-eyebrow min-h-11 shrink-0 border px-4 transition-colors duration-300',
                  filter === f ? 'border-amp-ink bg-amp-ink text-amp-ivory' : 'border-amp-ink/25 text-amp-ink hover:border-amp-ink',
                )}
              >
                {f}
              </button>
            ))}
          </div>
          <p className="sr-only" aria-live="polite">
            {photos.length} photographs shown
          </p>

          <ul className="mt-10 columns-2 gap-3 sm:gap-4 lg:columns-3 lg:gap-6">
            {photos.map((p, i) => (
              <li key={p.slug} className="mb-3 break-inside-avoid sm:mb-4 lg:mb-6">
                <button type="button" onClick={() => setOpen(i)} className="amp-zoom-parent group relative block w-full overflow-hidden bg-amp-limestone text-left">
                  <Picture photo={p} sizes="(min-width: 64rem) 31vw, 50vw" className="h-auto" imgClassName="amp-zoom !h-auto" />
                  <span className="sr-only">Open photo: {p.caption}</span>
                  <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-3 text-xs text-amp-ivory">
                    {p.caption}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <div className="mt-16 flex flex-col gap-3 sm:flex-row">
            <Link to="/virtual-tour" className="amp-btn amp-btn--ghost">
              Walk through the lodge
            </Link>
            <Link to="/booking" className="amp-btn">
              Book Your Stay <span className="amp-arrow" aria-hidden="true">→</span>
            </Link>
          </div>
        </div>
      </section>
      <Lightbox photos={photos} index={open} onIndexChange={setOpen} />
    </>
  )
}
