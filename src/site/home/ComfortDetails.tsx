import { ChapterLabel } from '../components/ChapterLabel'
import { Picture } from '../components/Picture'
import { PHOTOS, type Photo } from '../data/photos'
import { Parallax } from '../motion/Parallax'
import { Reveal } from '../motion/Reveal'
import { SplitHeading } from '../motion/SplitHeading'

const DETAILS: Array<{ photo: Photo; label: string; aspect: string }> = [
  { photo: PHOTOS.deskOrange, label: 'A desk, a wall-mounted television and air conditioning', aspect: 'aspect-[4/3]' },
  { photo: PHOTOS.bedsideDetail, label: 'A warm lamp at the bedside', aspect: 'aspect-[4/5]' },
  { photo: PHOTOS.bathroomGlass, label: 'A glass-walled shower', aspect: 'aspect-[4/5]' },
  { photo: PHOTOS.bedroomGreenTeal, label: 'Fresh linen and soft evening light', aspect: 'aspect-[4/3]' },
]

/**
 * Chapter 10 — Comfort in the details. Only what the photographs show; the
 * copy says plainly that facilities vary by room.
 */
export function ComfortDetails() {
  return (
    <section className="relative z-10 bg-amp-limestone py-24 sm:py-32 lg:py-40" aria-labelledby="details-title" data-theme="light">
      <div className="mx-auto grid max-w-site gap-14 px-gutter lg:grid-cols-12 lg:gap-10">
        <div className="lg:col-span-4">
          <div className="lg:sticky lg:top-32">
            <ChapterLabel no="10">In the rooms</ChapterLabel>
            <SplitHeading id="details-title" className="amp-display mt-6 text-[clamp(2.6rem,6vw,4.75rem)] text-amp-ink">
              Comfort in the details.
            </SplitHeading>
            <Reveal className="mt-8 max-w-md space-y-5">
              <p className="leading-relaxed text-amp-ink">
                The things that make a night easy: cool air, somewhere to work, a good shower and a lamp by the bed.
              </p>
              <p className="text-sm leading-relaxed text-amp-ink-muted">
                These are photographs of our own rooms. Furnishings differ from room to room, so if something matters to you, ask us
                before you book.
              </p>
            </Reveal>
          </div>
        </div>

        <ul className="grid grid-cols-2 gap-x-3 gap-y-10 sm:gap-x-6 lg:col-span-8 lg:gap-x-8 lg:gap-y-20">
          {DETAILS.map((d, i) => (
            <li key={d.photo.slug} className={i % 2 === 1 ? 'mt-16 lg:mt-28' : ''}>
              <figure>
                <Parallax amount={7} className={`${d.aspect} bg-amp-sand`}>
                  <Picture photo={d.photo} sizes="(min-width: 64rem) 30vw, 48vw" className="h-full" />
                </Parallax>
                <figcaption className="mt-3 flex gap-3 text-sm leading-snug text-amp-ink-muted">
                  <span className="amp-chapter-no pt-0.5 text-amp-bronze">{String(i + 1).padStart(2, '0')}</span>
                  {d.label}
                </figcaption>
              </figure>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
