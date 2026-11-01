import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { cn } from '@/lib/utils'
import { ChapterLabel } from '../components/ChapterLabel'
import { Picture } from '../components/Picture'
import { bookingHref, formatRate, useRooms, type LiveRoom } from '../data/rooms'
import { ROOMS_ANCHOR } from '../film/ArrivalFilm'
import { FILM_ROOMS } from '../film/film-data'
import { Reveal } from '../motion/Reveal'
import { SplitHeading } from '../motion/SplitHeading'

const TAGLINES = new Map(FILM_ROOMS.map((f) => [f.slug, f.tagline]))

function tagline(room: LiveRoom) {
  return TAGLINES.get(room.slug) ?? (room.description || (room.maxGuests ? `A private room for up to ${room.maxGuests} guests.` : 'A private room at AMP Lodge.'))
}

/**
 * Chapter 09 — Choose your stay. Where the film hands over to the booking.
 *
 * Desktop: a room navigator. The large print on the right starts on the
 * Executive Suite, where the film ends, and follows whichever room is hovered
 * or focused in the list. Phones and tablets: every room stacked with its own
 * photograph, so nothing depends on hover and nothing is hidden.
 *
 * All five live room types are listed: the three from the film first, then the
 * rest by rate. Rates, guests and bookability come from the booking system.
 */
export function ChooseYourStay() {
  const { rooms, status } = useRooms()
  const ordered = useMemo(() => {
    const film = FILM_ROOMS.map((f) => rooms.find((r) => r.slug === f.slug)).filter((r): r is LiveRoom => !!r)
    const rest = rooms.filter((r) => !TAGLINES.has(r.slug))
    return [...film, ...rest]
  }, [rooms])
  const [picked, setPicked] = useState<string>('executive-suite')
  const active = Math.max(0, ordered.findIndex((r) => r.slug === picked))
  const loading = status === 'loading'

  return (
    <section id={ROOMS_ANCHOR} aria-labelledby="stay-title" className="amp-on-dark relative z-10 bg-amp-obsidian pb-24 pt-20 text-amp-ivory sm:pb-32 lg:pt-12" data-theme="dark" data-header-dark>
      <div className="mx-auto max-w-site px-gutter">
        <div className="max-w-[44rem]">
          <ChapterLabel no="09" tone="dark">
            Choose your stay
          </ChapterLabel>
          <SplitHeading as="h2" id="stay-title" className="amp-display mt-4 text-[clamp(2.4rem,6vw,5.25rem)] leading-[0.98]">
            Find the room that feels just right.
          </SplitHeading>
          <Reveal>
            <p className="amp-lede mt-5 text-amp-ivory/80">Every room is booked directly with us. Rates and guest numbers come live from our booking system.</p>
          </Reveal>
        </div>

        {status === 'error' && (
          <p className="mt-10 border border-amp-ivory/20 p-5 text-sm text-amp-ivory/80" role="status">
            We couldn't load our rooms just now. <Link to="/rooms" className="amp-link">See all rooms</Link> or call us on the number below.
          </p>
        )}

        <div className="mt-14 lg:mt-20 lg:grid lg:grid-cols-12 lg:gap-14">
          <div className="hidden lg:order-2 lg:col-span-7 lg:block">
            <div className="sticky top-[calc(var(--amp-header-h)+2rem)]">
              <div className="relative aspect-[4/3] overflow-hidden rounded-[6px] bg-amp-charcoal">
                {ordered.map((r, i) => (
                  <Picture
                    key={r.slug}
                    photo={r.hero}
                    sizes="(min-width: 90rem) 46rem, 56vw"
                    alt=""
                    className={cn(
                      'absolute inset-0 transition-[opacity,transform] duration-700 ease-editorial',
                      i === active ? 'scale-100 opacity-100' : 'scale-[1.03] opacity-0',
                    )}
                  />
                ))}
                {loading && <div className="absolute inset-0 animate-pulse bg-amp-charcoal" />}
              </div>
              <p className="mt-4 min-h-[2.5rem] text-sm text-amp-ivory/65" aria-live="polite">
                {ordered[active] ? `${ordered[active].name}: ${ordered[active].photoNote}` : ''}
              </p>
            </div>
          </div>

          <ol className="lg:order-1 lg:col-span-5">
            {(loading && ordered.length === 0 ? FILM_ROOMS.map(() => null) : ordered).map((r, i) =>
              r ? (
                <li
                  key={r.slug}
                  onPointerEnter={() => setPicked(r.slug)}
                  onFocus={() => setPicked(r.slug)}
                  className={cn('relative border-t border-amp-ivory/15 py-9 first:border-t-0 lg:py-8 lg:first:pt-0', 'lg:pl-6')}
                >
                  <span
                    aria-hidden="true"
                    className={cn('absolute left-0 hidden h-12 w-px bg-amp-gold transition-opacity duration-500 lg:block', i === 0 ? 'top-0' : 'top-8', i === active ? 'opacity-100' : 'opacity-0')}
                  />
                  <div className="aspect-[4/3] overflow-hidden rounded-[4px] bg-amp-charcoal lg:hidden">
                    <Picture photo={r.hero} sizes="(min-width: 48rem) 90vw, 100vw" />
                  </div>
                  <p className={cn('amp-chapter-no mt-6 transition-colors duration-500 lg:mt-0', i === active ? 'text-amp-gold' : 'text-amp-ivory/55')}>
                    {String(i + 1).padStart(2, '0')}
                    {!r.bookable && <span className="amp-eyebrow ml-3 !text-[0.625rem] text-amp-ivory/70">Book by enquiry</span>}
                  </p>
                  <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                    <h3 className="amp-display text-[clamp(2rem,4.4vw,2.75rem)] leading-none">{r.name}</h3>
                    <p className="text-sm text-amp-ivory/75">
                      {formatRate(r.price) ? (
                        <>
                          <span className="amp-display text-2xl text-amp-ivory">{formatRate(r.price)}</span> / night
                        </>
                      ) : loading ? (
                        <span className="inline-block h-5 w-24 animate-pulse bg-amp-ivory/15" aria-label="Loading rate" />
                      ) : null}
                    </p>
                  </div>
                  <p className="mt-3 text-amp-ivory/80">{tagline(r)}</p>
                  {r.maxGuests ? <p className="mt-1 text-sm text-amp-ivory/60">Up to {r.maxGuests} guests</p> : null}
                  <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3">
                    {r.bookable ? (
                      <Link to={bookingHref(r)} className="amp-btn amp-btn--gold whitespace-nowrap" aria-label={`Book the ${r.name}`}>
                        Book This Room
                      </Link>
                    ) : (
                      <Link to={`/contact?room=${r.slug}`} className="amp-btn amp-btn--gold whitespace-nowrap" aria-label={`Enquire about the ${r.name}`}>
                        Enquire
                      </Link>
                    )}
                    <Link to={`/rooms/${r.slug}`} className="amp-eyebrow amp-link inline-flex min-h-11 items-center text-amp-ivory" aria-label={`View details of the ${r.name}`}>
                      View details
                    </Link>
                  </div>
                </li>
              ) : (
                <li key={i} className="border-t border-amp-ivory/15 py-9 first:border-t-0" aria-hidden="true">
                  <div className="h-9 w-48 animate-pulse bg-amp-ivory/10" />
                  <div className="mt-4 h-4 w-64 animate-pulse bg-amp-ivory/10" />
                </li>
              ),
            )}
          </ol>
        </div>
      </div>
    </section>
  )
}
