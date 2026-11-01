import { Link } from 'react-router-dom'

import { cn } from '@/lib/utils'
import { BookingPanel } from '../components/BookingPanel'
import { ChapterLabel } from '../components/ChapterLabel'
import { Picture } from '../components/Picture'
import { bookingHref, formatRate, useRooms } from '../data/rooms'
import { setRoomChoice, useRoomChoice } from '../data/room-choice'
import { SITE } from '../data/site'
import { BOOKING_ANCHOR } from '../film/anchors'
import { Reveal } from '../motion/Reveal'
import { SplitHeading } from '../motion/SplitHeading'

/**
 * Chapter 09 — Choose your stay. Where the film hands over to booking.
 *
 * The room journey's last frame settles into the editorial frame on the right
 * (desktop); here it becomes the photograph of whichever room is chosen.
 * Every live room type is listed side by side with its guests and rate, and
 * the booking panel opens on the room the visitor last looked at in the film.
 * Choosing dates continues into the one booking flow, room preselected.
 */
export function ChooseYourStay() {
  const { rooms, status } = useRooms()
  const choice = useRoomChoice()
  const picked = rooms.find((r) => r.slug === choice) ?? rooms[0]
  const loading = status === 'loading'

  return (
    <section
      id={BOOKING_ANCHOR}
      aria-labelledby="stay-title"
      className="amp-on-dark relative z-10 scroll-mt-0 bg-amp-obsidian pb-24 pt-20 text-amp-ivory sm:pb-32 lg:pt-28"
      data-theme="dark"
      data-header-dark="solid"
    >
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
            We couldn't load our rates just now. You can still choose your dates, or call us on{' '}
            <a href={SITE.phone.href} className="amp-link">
              {SITE.phone.display}
            </a>
            .
          </p>
        )}

        <div className="mt-14 grid gap-14 lg:mt-20 lg:grid-cols-12 lg:gap-12">
          {/* The comparison. */}
          <div className="lg:col-span-7">
            <h3 className="sr-only">Compare the rooms</h3>
            <ol>
              {rooms.map((r, i) => {
                const on = picked?.slug === r.slug
                const rate = formatRate(r.price)
                return (
                  <li key={r.slug} className={cn('relative border-t border-amp-ivory/15 py-7 first:border-t-0 first:pt-0 sm:pl-6')}>
                    <span
                      aria-hidden="true"
                      className={cn('absolute left-0 hidden w-px bg-amp-gold transition-opacity duration-500 sm:block', i === 0 ? 'top-0 h-24' : 'top-7 h-24', on ? 'opacity-100' : 'opacity-0')}
                    />
                    <div className="flex gap-5">
                      <button
                        type="button"
                        onClick={() => setRoomChoice(r.slug)}
                        aria-pressed={on}
                        className="relative aspect-[4/3] w-28 shrink-0 overflow-hidden rounded-[3px] bg-amp-charcoal sm:w-36"
                      >
                        <Picture photo={r.hero} sizes="9rem" alt="" className={cn('transition-transform duration-700 ease-editorial', on && 'scale-[1.04]')} />
                        <span className="sr-only">Choose the {r.name} for the booking panel</span>
                      </button>
                      <div className="min-w-0 flex-1">
                        <p className={cn('amp-chapter-no transition-colors duration-500', on ? 'text-amp-gold' : 'text-amp-ivory/55')}>{String(i + 1).padStart(2, '0')}</p>
                        <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                          <h4 className="amp-display text-[clamp(1.75rem,3.6vw,2.5rem)] leading-none">{r.name}</h4>
                          <p className="text-sm text-amp-ivory/75">
                            {rate ? (
                              <>
                                <span className="amp-display text-2xl text-amp-ivory">{rate}</span> / night
                              </>
                            ) : loading ? (
                              <span className="inline-block h-5 w-24 animate-pulse bg-amp-ivory/15"><span className="sr-only">Loading rate</span></span>
                            ) : null}
                          </p>
                        </div>
                        {r.tagline && <p className="mt-2 text-amp-ivory/80">{r.tagline}</p>}
                        {r.maxGuests ? <p className="mt-1 text-sm text-amp-ivory/60">Up to {r.maxGuests} guests</p> : null}
                      </div>
                    </div>
                    <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 sm:pl-[10.25rem]">
                      <Link to={bookingHref(r)} onClick={() => setRoomChoice(r.slug)} className="amp-btn amp-btn--gold !min-h-11 !py-3 whitespace-nowrap">
                        Book This Room<span className="sr-only">: {r.name}</span>
                      </Link>
                      <Link to={`/rooms/${r.slug}`} className="amp-eyebrow amp-link inline-flex min-h-11 items-center text-amp-ivory">
                        View Room Details<span className="sr-only">: {r.name}</span>
                      </Link>
                    </div>
                  </li>
                )
              })}
            </ol>
          </div>

          {/* The booking panel, on the chosen room. */}
          <aside className="lg:col-span-5" aria-labelledby="stay-panel-title">
            <div className="lg:sticky lg:top-[calc(var(--amp-header-h)+1.5rem)]">
              <div className="relative aspect-[16/10] overflow-hidden rounded-[6px] bg-amp-charcoal lg:[@media(max-height:60rem)]:aspect-[16/7]">
                {rooms.map((r) => (
                  <Picture
                    key={r.slug}
                    photo={r.hero}
                    sizes="(min-width: 64rem) 38vw, 100vw"
                    alt=""
                    className={cn('absolute inset-0 transition-[opacity,transform] duration-700 ease-editorial', r.slug === picked?.slug ? 'scale-100 opacity-100' : 'scale-[1.03] opacity-0')}
                  />
                ))}
              </div>
              <p className="mt-3 min-h-[2.5rem] text-xs text-amp-ivory/60">
                {picked ? `${picked.name}. ${picked.photoNote}` : ''}
              </p>
              <h3 id="stay-panel-title" className="amp-display mt-4 text-[clamp(1.9rem,3vw,2.5rem)]">
                Choose your dates
              </h3>
              {rooms.length > 0 && <BookingPanel rooms={rooms} initial={picked?.slug} tone="dark" inline className="mt-6" />}
            </div>
          </aside>
        </div>
      </div>
    </section>
  )
}
