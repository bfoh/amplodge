import { useId, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { Lightbox } from '../components/Lightbox'
import { PageHero } from '../components/PageHero'
import { Picture } from '../components/Picture'
import { RoomCard } from '../components/RoomCard'
import { bookingHref, findRoom, formatRate, useRooms } from '../data/rooms'
import { SITE } from '../data/site'
import { ImageReveal } from '../motion/ImageReveal'
import { Reveal } from '../motion/Reveal'
import { useDocumentMeta } from '../seo/useDocumentMeta'
import NotFoundPage from './NotFoundPage'

const iso = (d: Date) => {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
  return z.toISOString().slice(0, 10)
}

export default function RoomDetailPage() {
  const { slug } = useParams()
  const entry = findRoom(slug)
  const { rooms, status } = useRooms()
  const room = rooms.find((r) => r.slug === slug)
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

  if (!entry || !room) return <NotFoundPage />

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
              <span className="inline-block h-6 w-28 animate-pulse bg-amp-ivory/15" aria-label="Loading rate" />
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
            <p className="mt-4 text-sm text-amp-ink-muted">{room.photoNote} Furnishings can differ between rooms of the same type.</p>
            <Lightbox photos={room.gallery} index={open} onIndexChange={setOpen} />
          </div>

          <div className="lg:col-span-5">
            <div className="lg:sticky lg:top-28">
              <h2 id="room-book" className="amp-display text-[clamp(2rem,4vw,3rem)] text-amp-ink">
                {room.bookable ? 'Check your dates' : 'Book by enquiry'}
              </h2>
              {room.bookable ? (
                <BookingForm roomTypeId={room.typeId} maxGuests={room.maxGuests ?? 4} />
              ) : (
                <div className="mt-6 space-y-4">
                  <p className="text-amp-ink-muted">
                    The {room.name} isn't available to book online. Send us your dates and we'll confirm availability and the rate with you
                    directly.
                  </p>
                  <Link to={`/contact?room=${room.slug}`} className="amp-btn amp-btn--block">
                    Enquire about this suite
                  </Link>
                  <a href={SITE.phone.href} className="amp-btn amp-btn--ghost amp-btn--block">
                    Call {SITE.phone.display}
                  </a>
                </div>
              )}
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
                  <dd className="font-semibold text-amp-ink">{room.bookable ? 'Online or by phone' : 'By enquiry'}</dd>
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

function BookingForm({ roomTypeId, maxGuests }: { roomTypeId: string | null; maxGuests: number }) {
  const navigate = useNavigate()
  const id = useId()
  const today = useMemo(() => iso(new Date()), [])
  const [checkIn, setCheckIn] = useState('')
  const [checkOut, setCheckOut] = useState('')
  const [guests, setGuests] = useState(Math.min(2, maxGuests))
  const [error, setError] = useState('')

  const minOut = checkIn ? iso(new Date(new Date(`${checkIn}T00:00:00`).getTime() + 86400000)) : today

  return (
    <form
      className="mt-6 space-y-5"
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        if (checkIn && checkOut && checkOut <= checkIn) {
          setError('Check-out must be after check-in.')
          return
        }
        setError('')
        navigate(bookingHref({ typeId: roomTypeId }, { checkIn: checkIn || undefined, checkOut: checkOut || undefined, guests }))
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor={`${id}-in`} className="amp-eyebrow block text-amp-ink-muted">
            Check-in
          </label>
          <input
            id={`${id}-in`}
            type="date"
            min={today}
            value={checkIn}
            onChange={(e) => {
              setCheckIn(e.target.value)
              if (checkOut && e.target.value && checkOut <= e.target.value) setCheckOut('')
            }}
            className="mt-2 h-12 w-full border border-amp-ink/30 bg-amp-ivory px-3 text-base text-amp-ink"
          />
        </div>
        <div>
          <label htmlFor={`${id}-out`} className="amp-eyebrow block text-amp-ink-muted">
            Check-out
          </label>
          <input
            id={`${id}-out`}
            type="date"
            min={minOut}
            value={checkOut}
            onChange={(e) => setCheckOut(e.target.value)}
            aria-invalid={!!error}
            aria-describedby={error ? `${id}-err` : undefined}
            className="mt-2 h-12 w-full border border-amp-ink/30 bg-amp-ivory px-3 text-base text-amp-ink"
          />
        </div>
      </div>
      <div>
        <label htmlFor={`${id}-guests`} className="amp-eyebrow block text-amp-ink-muted">
          Guests
        </label>
        <select
          id={`${id}-guests`}
          value={guests}
          onChange={(e) => setGuests(Number(e.target.value))}
          className="mt-2 h-12 w-full border border-amp-ink/30 bg-amp-ivory px-3 text-base text-amp-ink"
        >
          {Array.from({ length: maxGuests }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {n} {n === 1 ? 'guest' : 'guests'}
            </option>
          ))}
        </select>
      </div>
      {error && (
        <p id={`${id}-err`} role="alert" className="text-sm font-medium text-[#8a1c1c]">
          {error}
        </p>
      )}
      <button type="submit" className="amp-btn amp-btn--block">
        Continue to booking <span className="amp-arrow" aria-hidden="true">→</span>
      </button>
      <p className="text-xs text-amp-ink-muted">Next you'll see availability for your dates. Nothing is booked until you confirm.</p>
    </form>
  )
}
