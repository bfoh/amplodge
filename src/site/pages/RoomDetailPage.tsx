import { useState } from 'react'
import { useParams } from 'react-router-dom'

import { BookingPanel } from '../components/BookingPanel'
import { Lightbox } from '../components/Lightbox'
import { PageHero } from '../components/PageHero'
import { Picture } from '../components/Picture'
import { RoomCard } from '../components/RoomCard'
import { findKnownRoom, formatRate, useRooms } from '../data/rooms'
import { ImageReveal } from '../motion/ImageReveal'
import { Reveal } from '../motion/Reveal'
import { useDocumentMeta } from '../seo/useDocumentMeta'
import NotFoundPage from './NotFoundPage'

/**
 * One page per live room type (/rooms/:slug). The list comes from the booking
 * system, so a type added there gets its page too; while it loads, a known
 * type renders at once and an unknown slug waits rather than showing "not
 * found" too early.
 */
export default function RoomDetailPage() {
  const { slug } = useParams()
  const { rooms, status } = useRooms()
  const room = rooms.find((r) => r.slug === slug)
  const entry = room ?? findKnownRoom(slug)
  const [open, setOpen] = useState<number | null>(null)

  useDocumentMeta({
    title: entry ? `${entry.name} | AMP Lodge, Kumasi` : 'Room not found | AMP Lodge',
    description: entry
      ? `The ${entry.name} at AMP Lodge, Abuakwa, Kumasi: photographs, live nightly rate and direct booking.`
      : 'This room could not be found.',
    path: entry ? `/rooms/${entry.slug}` : '/rooms',
    image: entry ? `/images/property/${entry.hero.slug}-${entry.hero.jpg}.jpg` : undefined,
    noindex: !entry,
  })

  if (!room && status === 'loading') return <div className="min-h-[100svh] bg-amp-obsidian" aria-busy="true" />
  if (!room) return <NotFoundPage />

  const rate = formatRate(room.price)
  const others = rooms.filter((r) => r.slug !== room.slug).slice(0, 3)
  const intro = room.description || (room.maxGuests ? `A private room for up to ${room.maxGuests} guests.` : 'A private room at AMP Lodge.')

  return (
    <>
      <PageHero eyebrow="Rooms & suites" title={room.name} intro={intro} photo={room.hero} focus="50% 55%">
        <Reveal play="intro" delay={0.5} className="mt-8 flex flex-wrap items-center gap-x-8 gap-y-3 text-sm text-amp-ivory/85">
          <p>
            {rate ? (
              <>
                <span className="amp-display text-3xl text-amp-ivory">{rate}</span> / night
              </>
            ) : status === 'loading' ? (
              <span className="inline-block h-6 w-28 animate-pulse bg-amp-ivory/15"><span className="sr-only">Loading rate</span></span>
            ) : (
              'Rate shown when you choose dates'
            )}
          </p>
          {room.maxGuests && <p>Up to {room.maxGuests} guests</p>}
        </Reveal>
      </PageHero>

      <section className="bg-amp-ivory py-20 sm:py-28" aria-labelledby="room-book">
        <div className="mx-auto grid max-w-site gap-14 px-gutter lg:grid-cols-12 lg:gap-12">
          <div className="lg:col-span-7">
            <h2 className="sr-only">Photographs</h2>
            {room.gallery.length === 0 && (
              <div className="aspect-[16/10] overflow-hidden bg-amp-limestone">
                <Picture photo={room.hero} sizes="(min-width: 64rem) 55vw, 100vw" className="h-full" />
              </div>
            )}
            <ul className="grid grid-cols-2 gap-3 sm:gap-4">
              {room.gallery.map((p, i) => (
                <li key={p.slug} className={i === 0 ? 'col-span-2' : ''}>
                  <ImageReveal className={i === 0 ? 'aspect-[16/10] bg-amp-limestone' : 'aspect-[4/5] bg-amp-limestone'} delay={i * 0.08}>
                    <button type="button" className="amp-zoom-parent block h-full w-full" onClick={() => setOpen(i)}>
                      <Picture photo={p} sizes={i === 0 ? '(min-width: 64rem) 55vw, 100vw' : '(min-width: 64rem) 27vw, 50vw'} className="h-full" imgClassName="amp-zoom" />
                      <span className="sr-only">Open photo: {p.caption}</span>
                    </button>
                  </ImageReveal>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-sm text-amp-ink-muted">
              {room.photoNote}
              {room.photographed ? ' Furnishings can differ between rooms of the same type.' : ''}
            </p>
            <Lightbox photos={room.gallery} index={open} onIndexChange={setOpen} />
          </div>

          <div className="lg:col-span-5">
            <div className="lg:sticky lg:top-28">
              <h2 id="room-book" className="amp-display text-[clamp(2rem,4vw,3rem)] text-amp-ink">
                Check your dates
              </h2>
              <BookingPanel rooms={[room]} className="mt-6" />
              <dl className="mt-10 divide-y divide-amp-ink/10 border-y border-amp-ink/10 text-sm">
                <div className="flex justify-between gap-4 py-3">
                  <dt className="text-amp-ink-muted">Nightly rate</dt>
                  <dd className="font-semibold text-amp-ink">{rate ?? '—'}</dd>
                </div>
                <div className="flex justify-between gap-4 py-3">
                  <dt className="text-amp-ink-muted">Guests</dt>
                  <dd className="font-semibold text-amp-ink">{room.maxGuests ? `Up to ${room.maxGuests}` : '—'}</dd>
                </div>
                <div className="flex justify-between gap-4 py-3">
                  <dt className="text-amp-ink-muted">Booking</dt>
                  <dd className="font-semibold text-amp-ink">Online or by phone</dd>
                </div>
              </dl>
              <p className="mt-4 text-xs leading-relaxed text-amp-ink-muted">Rates come from our booking system and are confirmed before you pay.</p>
            </div>
          </div>
        </div>
      </section>

      {others.length > 0 && (
        <section className="bg-amp-limestone py-20 sm:py-28" aria-labelledby="other-rooms">
          <div className="mx-auto max-w-site px-gutter">
            <h2 id="other-rooms" className="amp-display text-[clamp(2.2rem,5vw,3.75rem)] text-amp-ink">
              Other rooms
            </h2>
            <ul className="mt-12 grid gap-x-8 gap-y-14 sm:grid-cols-2 lg:grid-cols-3">
              {others.map((r) => (
                <li key={r.slug}>
                  <RoomCard room={r} loading={status === 'loading'} sizes="(min-width: 64rem) 30vw, (min-width: 40rem) 46vw, 100vw" />
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
    </>
  )
}
