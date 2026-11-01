import { Link } from 'react-router-dom'

import { cn } from '@/lib/utils'
import { PageHero } from '../components/PageHero'
import { Picture } from '../components/Picture'
import { PHOTOS, type Photo } from '../data/photos'
import { ImageReveal } from '../motion/ImageReveal'
import { Reveal } from '../motion/Reveal'
import { useDocumentMeta } from '../seo/useDocumentMeta'

const STOPS: Array<{ photo: Photo; title: string; line: string }> = [
  { photo: PHOTOS.exteriorNight, title: 'Arrive', line: 'The gate on the Kumasi–Sunyani Road, lit after dark.' },
  { photo: PHOTOS.exteriorDay, title: 'The façade', line: 'Three storeys of stone behind a gravel forecourt.' },
  { photo: PHOTOS.corridorMarble, title: 'Inside', line: 'Polished marble floors in the hallway.' },
  { photo: PHOTOS.stairwell, title: 'Upstairs', line: 'A bright stair landing between the floors.' },
  { photo: PHOTOS.corridor, title: 'To your room', line: 'A long, warm corridor to the guest rooms.' },
  { photo: PHOTOS.roomStandard, title: 'A Standard Room', line: 'Green walls, a double bed and a reading chair.' },
  { photo: PHOTOS.deskGreen, title: 'Work and unwind', line: 'A desk and a wall-mounted television.' },
  { photo: PHOTOS.bathroomGlass, title: 'Bathroom', line: 'A glass-walled shower.' },
  { photo: PHOTOS.suiteLounge, title: 'The suite lounge', line: 'Red leather recliners and marble floors.' },
  { photo: PHOTOS.eventHall, title: 'The hall', line: 'A large open hall with exposed beams.' },
]

/**
 * "Virtual tour": a guided walk through the lodge in photographs, from the
 * gate to the room. (There is no 360° footage; this page doesn't pretend
 * otherwise.)
 */
export default function VirtualTourPage() {
  useDocumentMeta({
    title: 'Virtual Tour | AMP Lodge, Kumasi',
    description: 'Walk through AMP Lodge in photographs, from the gate on the Kumasi–Sunyani Road to your room.',
    path: '/virtual-tour',
  })
  return (
    <>
      <PageHero eyebrow="Virtual tour" title="A walk through the lodge." intro="From the gate to your room, in ten photographs." photo={PHOTOS.corridor} focus="50% 50%" />
      <section className="bg-amp-ivory py-20 sm:py-28" aria-label="Tour">
        <ol className="mx-auto max-w-site space-y-20 px-gutter sm:space-y-28">
          {STOPS.map((s, i) => {
            const flip = i % 2 === 1
            const portrait = s.photo.height > s.photo.width
            return (
              <li key={s.photo.slug} className="grid items-center gap-6 lg:grid-cols-12 lg:gap-12">
                <ImageReveal
                  direction={flip ? 'left' : 'right'}
                  className={cn(
                    'bg-amp-limestone',
                    portrait ? 'aspect-[3/4] lg:col-span-5' : 'aspect-[3/2] lg:col-span-7',
                    flip ? 'lg:order-2' : '',
                    flip && portrait ? 'lg:col-start-7' : flip ? 'lg:col-start-6' : '',
                  )}
                >
                  <Picture photo={s.photo} sizes="(min-width: 64rem) 58vw, 100vw" className="h-full" />
                </ImageReveal>
                <Reveal className={cn('lg:col-span-4', flip ? 'lg:order-1 lg:col-start-1' : 'lg:col-start-9')}>
                  <p className="amp-chapter-no text-amp-bronze">
                    {String(i + 1).padStart(2, '0')} / {String(STOPS.length).padStart(2, '0')}
                  </p>
                  <h2 className="amp-display mt-3 text-[clamp(2rem,4.5vw,3.25rem)] text-amp-ink">{s.title}</h2>
                  <p className="mt-3 text-amp-ink-muted">{s.line}</p>
                </Reveal>
              </li>
            )
          })}
        </ol>
        <div className="mx-auto mt-24 flex max-w-site flex-col gap-3 px-gutter sm:flex-row">
          <Link to="/rooms" className="amp-btn amp-btn--ghost">
            Explore Our Rooms
          </Link>
          <Link to="/booking" className="amp-btn">
            Book Your Stay <span className="amp-arrow" aria-hidden="true">→</span>
          </Link>
        </div>
      </section>
    </>
  )
}
