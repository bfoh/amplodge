import { useEffect, useMemo, useRef, useState, type CSSProperties, type FocusEvent } from 'react'
import { Link } from 'react-router-dom'

import { cn } from '@/lib/utils'
import { Picture } from '../components/Picture'
import { bookingHref, formatRate, useRooms, type LiveRoom } from '../data/rooms'
import { setRoomChoice } from '../data/room-choice'
import { gsap, ScrollTrigger, useGSAP } from '../lib/gsap'
import { isLiteDevice, prefersReducedMotion, useReducedMotion } from '../motion/prefs'
import { scrollToTarget } from '../motion/scroll-control'
import { BOOKING_ANCHOR, ROOMS_ANCHOR, roomAnchor, scrollToRoom } from './anchors'
import { FILM_BASE, frameSet, roomFocus, roomStill } from './film-data'
import { FrameSequence } from './FrameSequence'

const PHONE = '(max-width: 47.99rem)'
const MOTION = '(prefers-reduced-motion: no-preference)'

const pad = (n: number) => String(n).padStart(2, '0')
/** Portrait films (the Family Room) sit as a print on a wide card. */
const isPortrait = (room: LiveRoom) => {
  const set = frameSet(room.slug, false)
  if (set) return set.h > set.w
  const still = roomStill(room.slug, room.hero)
  return still.height > still.width
}

/**
 * Chapter 08: every room category, as a deck of cards.
 *
 * The rooms come live from the booking system (useRooms), in price order, so
 * a category added there appears here without code changes; a room with no
 * film gets its photograph with a camera move made in the page.
 *
 * The first card rises over the arrival film's last scene ("Find Your Place
 * to Unwind."). Each card holds one room's film, name, guests, nightly rate
 * and booking actions, and rests under a sticky room bar; the next card rises
 * over it while it steps back and dims, its film settling as it arrives. The
 * stacking is CSS (position: sticky), so scrolling stays native on every
 * device; GSAP only scrubs the camera, the copy and the films. The same deck
 * serves phones, tablets and desktop. The room bar jumps to any room, with
 * previous / next and a skip to booking (ChooseYourStay).
 *
 * Reduced motion: the same cards, unstacked, with photographs.
 */
export function RoomJourney() {
  const { rooms, status } = useRooms()
  const still = useReducedMotion()
  const root = useRef<HTMLElement>(null)
  const chipRow = useRef<HTMLOListElement>(null)
  const canvases = useRef<Record<string, HTMLCanvasElement | null>>({})
  const seqs = useRef<Record<string, FrameSequence>>({})
  const activeRef = useRef(-1)
  const [active, setActive] = useState(0)
  const loading = status === 'loading'
  const n = rooms.length
  // Rebuild the motion only when the set of rooms changes, not when prices arrive.
  const key = useMemo(() => rooms.map((r) => r.slug).join('|'), [rooms])
  const tall = useMemo(() => rooms.map(isPortrait), [rooms])

  const choose = (i: number) => {
    if (i === activeRef.current) return
    activeRef.current = i
    setActive(i)
    const room = rooms[i]
    if (room) {
      setRoomChoice(room.slug)
      seqs.current[room.slug]?.load()
    }
    const next = rooms[i + 1]
    if (next) seqs.current[next.slug]?.load(2)
  }

  // One frame sequence per card (films only; lite devices and reduced motion
  // keep the photographs). Each starts loading a screen before its card.
  useEffect(() => {
    if (still || isLiteDevice() || !n) return
    const phone = window.matchMedia(PHONE).matches
    const created: FrameSequence[] = []
    for (const room of rooms) {
      const canvas = canvases.current[room.slug]
      const set = frameSet(room.slug, phone)
      if (!canvas || !set) continue
      const f = roomFocus(room.slug)
      const seq = new FrameSequence(canvas, `${FILM_BASE}/${room.slug}`, set, phone ? 'm' : 'd', phone ? 0.5 : f.x, phone ? 0.5 : f.y)
      seq.onReady = () => {
        canvas.dataset.ready = ''
      }
      seqs.current[room.slug] = seq
      created.push(seq)
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue
          const slug = (e.target as HTMLElement).dataset.slug
          if (slug) seqs.current[slug]?.load(2)
          io.unobserve(e.target)
        }
      },
      { rootMargin: '100% 0px' },
    )
    root.current?.querySelectorAll('[data-room-zone]').forEach((z) => io.observe(z))
    let raf = 0
    const onResize = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => created.forEach((s) => s.resize()))
    }
    window.addEventListener('resize', onResize)
    return () => {
      io.disconnect()
      window.removeEventListener('resize', onResize)
      cancelAnimationFrame(raf)
      created.forEach((s) => s.dispose())
      seqs.current = {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, still])

  // The deck in motion. Each card's stretch of scroll (data-room-zone) drives
  // its arrival: the card rises, its camera settles and its copy comes up,
  // while the card beneath steps back and dims. Its film plays from the
  // moment it appears until the next card has covered it.
  useGSAP(
    () => {
      const mm = gsap.matchMedia()
      mm.add(MOTION, () => {
        const q = gsap.utils.selector(root)
        const cards = q('[data-card]') as HTMLElement[]
        const zones = q('[data-room-zone]') as HTMLElement[]
        const list = q('[data-deck]')[0] as HTMLElement | undefined
        if (!cards.length || zones.length !== cards.length || !list) return
        const restAt = (card: HTMLElement) => parseFloat(getComputedStyle(card).top) || 0
        const pageTop = (el: HTMLElement) => el.getBoundingClientRect().top + window.scrollY
        const dwell = () => parseFloat(getComputedStyle(list).rowGap) || 0
        const nav = q('[data-deck-nav]')[0]

        cards.forEach((card, i) => {
          const zone = zones[i]
          const tl = gsap.timeline({
            defaults: { ease: 'none' },
            scrollTrigger: { trigger: zone, start: 'top bottom', end: () => `top ${restAt(card)}px`, scrub: 0.5, invalidateOnRefresh: true },
          })
          tl.fromTo(card.querySelectorAll('[data-cam]'), { scale: 1.16 }, { scale: 1, duration: 1, ease: 'power1.out' }, 0)
          tl.fromTo(card.querySelectorAll('[data-reveal]'), { opacity: 0, y: 26 }, { opacity: 1, y: 0, duration: 0.3, stagger: 0.05, ease: 'power2.out' }, 0.5)
          const prev = cards[i - 1]
          if (prev) {
            tl.fromTo(prev.querySelector('[data-card-inner]'), { scale: 1 }, { scale: 0.93, duration: 1, ease: 'power1.in' }, 0)
            tl.fromTo(prev.querySelector('[data-dim]'), { opacity: 0 }, { opacity: 0.62, duration: 1 }, 0)
          } else if (nav) {
            // The room bar arrives with the first card.
            tl.fromTo(nav, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.25 }, 0.75)
          }

          const slug = card.dataset.slug!
          const next = zones[i + 1]
          const proxy = { p: 0 }
          gsap.fromTo(
            proxy,
            { p: 0 },
            {
              p: 1,
              ease: 'none',
              onUpdate: () => seqs.current[slug]?.setProgress(proxy.p),
              scrollTrigger: {
                trigger: zone,
                start: 'top bottom',
                end: next ? () => pageTop(next) - restAt(cards[i + 1]) : () => pageTop(zone) - restAt(card) + dwell(),
                scrub: 0.4,
                invalidateOnRefresh: true,
              },
            },
          )
        })
      })
      return () => mm.revert()
    },
    { scope: root, dependencies: [key, still], revertOnUpdate: true },
  )

  // The room bar follows the card in the middle of the screen.
  useGSAP(
    () => {
      const q = gsap.utils.selector(root)
      const zones = q(still ? '[data-card]' : '[data-room-zone]') as HTMLElement[]
      zones.forEach((zone, i) =>
        ScrollTrigger.create({
          trigger: zone,
          start: 'top center',
          end: 'bottom center',
          onToggle: (self) => {
            if (self.isActive) choose(i)
          },
        }),
      )
    },
    { scope: root, dependencies: [key, still], revertOnUpdate: true },
  )

  // On narrow screens the room chips scroll sideways: keep the current one in view.
  useEffect(() => {
    const row = chipRow.current
    const chip = row?.querySelector<HTMLElement>(`[data-chip="${active}"]`)
    if (!row || !chip || row.scrollWidth <= row.clientWidth + 1) return
    row.scrollTo({ left: chip.offsetLeft - (row.clientWidth - chip.offsetWidth) / 2, behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
  }, [active])

  const goTo = (i: number) => {
    const room = rooms[Math.max(0, Math.min(n - 1, i))]
    if (room) scrollToRoom(room.slug)
  }
  const toBooking = () => {
    const el = document.getElementById(BOOKING_ANCHOR)
    if (el) scrollToTarget(el)
  }
  // Tabbing into a card that is still below (or under) the deck brings it to rest first.
  const onCardFocus = (i: number) => (e: FocusEvent<HTMLElement>) => {
    if (still || i === activeRef.current) return
    if ((e.target as HTMLElement).matches(':focus-visible')) goTo(i)
  }

  if (!n) return null
  const current = Math.min(active, n - 1)
  const navButton =
    'inline-flex h-10 w-10 items-center justify-center rounded-full border border-amp-ivory/25 text-amp-ivory transition-colors hover:border-amp-gold disabled:opacity-35 disabled:hover:border-amp-ivory/25'

  return (
    <section
      ref={root}
      id={ROOMS_ANCHOR}
      aria-labelledby="journey-title"
      data-room-deck
      data-theme="dark"
      data-header-dark="solid"
      data-header-pin
      data-booking-aside
      className="amp-on-dark relative z-10 text-amp-ivory motion-safe:-mt-[100svh] motion-safe:bg-[linear-gradient(to_bottom,transparent_100svh,#121312_100svh)] motion-reduce:bg-amp-obsidian motion-reduce:pt-10"
      style={{ '--deck-count': n } as CSSProperties}
    >
      <h2 id="journey-title" className="sr-only">
        The rooms
      </h2>

      {/* The room bar: where you are, any room directly, previous / next, and out. */}
      <nav
        data-deck-nav
        aria-label="Rooms"
        className="sticky top-[calc(var(--amp-header-h)+env(safe-area-inset-top))] z-30 h-[var(--deck-nav-h)] border-b border-amp-ivory/10 bg-amp-obsidian/90 backdrop-blur-md"
      >
        <div className="mx-auto flex h-full max-w-site items-center gap-6 px-gutter">
          <p aria-hidden="true" className="amp-chapter-no hidden shrink-0 text-[0.6875rem] text-amp-ivory/70 lg:block">
            <span className="text-amp-gold-soft">{pad(current + 1)}</span> / {pad(n)}
            <span className="ml-3">The rooms</span>
          </p>
          <ol
            ref={chipRow}
            className="relative flex min-w-0 flex-1 items-center gap-1.5 -mx-gutter overflow-x-auto px-gutter [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden"
          >
            {rooms.map((r, i) => (
              <li key={r.slug} className="shrink-0">
                <button
                  type="button"
                  data-chip={i}
                  onClick={() => goTo(i)}
                  aria-current={i === current ? 'true' : undefined}
                  className={cn(
                    'inline-flex min-h-10 items-center gap-2 rounded-full border px-3.5 text-[0.8125rem] transition-colors duration-300',
                    i === current ? 'border-amp-gold bg-amp-gold/15 text-amp-ivory' : 'border-amp-ivory/20 text-amp-ivory/75 hover:border-amp-ivory/45 hover:text-amp-ivory',
                  )}
                >
                  <span className="amp-chapter-no text-[0.625rem] text-amp-gold-soft">{pad(i + 1)}</span>
                  {r.name}
                </button>
              </li>
            ))}
            <li className="shrink-0 sm:hidden">
              <button type="button" onClick={toBooking} className="amp-eyebrow amp-link inline-flex min-h-10 items-center px-3 !text-[0.625rem] text-amp-gold-soft">
                Skip to booking
              </button>
            </li>
          </ol>
          <div className="hidden shrink-0 items-center gap-2 sm:flex">
            <button type="button" onClick={() => goTo(current - 1)} disabled={current === 0} aria-label="Previous room" className={navButton}>
              <span aria-hidden="true">←</span>
            </button>
            <button type="button" onClick={() => goTo(current + 1)} disabled={current >= n - 1} aria-label="Next room" className={navButton}>
              <span aria-hidden="true">→</span>
            </button>
            <button type="button" onClick={toBooking} className="amp-eyebrow amp-link ml-3 inline-flex min-h-10 items-center !text-[0.625rem] text-amp-ivory/80">
              Skip to booking
            </button>
          </div>
        </div>
      </nav>

      <div className="relative">
        {/* Each card's stretch of scroll: what the motion, the room bar and the room anchors measure. */}
        {!still &&
          rooms.map((r, i) => (
            <div
              key={r.slug}
              id={roomAnchor(r.slug)}
              data-room-zone
              data-slug={r.slug}
              aria-hidden="true"
              className="pointer-events-none invisible absolute inset-x-0"
              style={{ top: `calc(var(--deck-lead) + ${i} * (var(--card-h) + var(--deck-gap)))`, height: 'calc(var(--card-h) + var(--deck-gap))' }}
            />
          ))}

        <ol data-deck className={cn('mx-auto flex max-w-site flex-col px-gutter', still ? 'gap-10 pt-10' : 'gap-[var(--deck-gap)] pt-[var(--deck-lead)]')}>
          {rooms.map((r, i) => {
            const film = !still && !!frameSet(r.slug, false)
            const f = roomFocus(r.slug)
            const photo = r.photographed ? roomStill(r.slug, r.hero) : r.hero
            const print = tall[i]
            return (
              <li
                key={r.slug}
                id={still ? roomAnchor(r.slug) : undefined}
                data-card
                data-slug={r.slug}
                data-index={i}
                className={still ? 'scroll-mt-[calc(var(--amp-header-h)+var(--deck-nav-h)+1rem)]' : 'sticky'}
                style={still ? undefined : { top: `calc(var(--deck-top) + ${i} * var(--deck-off))` }}
                onFocus={onCardFocus(i)}
              >
                <article
                  aria-labelledby={`deck-${r.slug}`}
                  data-card-inner
                  className={cn(
                    'relative origin-top overflow-hidden rounded-[10px] bg-amp-charcoal',
                    still ? 'h-[min(80svh,46rem)] min-h-[32rem]' : 'h-[var(--card-h)] shadow-[0_-20px_50px_-28px_rgba(0,0,0,0.9)] will-change-transform',
                  )}
                >
                  {/* The film, or its photograph. A portrait film sits as a print on its own blurred light (desktop). */}
                  {print && (
                    <div aria-hidden="true" className="absolute inset-0 hidden lg:block">
                      <Picture photo={photo} sizes="40vw" alt="" className="absolute inset-0 scale-110 opacity-70 blur-2xl saturate-150" />
                    </div>
                  )}
                  <div
                    className={cn(
                      'absolute inset-0 overflow-hidden',
                      print && 'lg:inset-auto lg:right-[7%] lg:top-[7%] lg:aspect-[9/16] lg:h-[86%] lg:rounded-[6px] lg:shadow-[0_30px_80px_-30px_rgba(0,0,0,0.85)]',
                    )}
                  >
                    <div data-cam className="absolute inset-0 will-change-transform">
                      <Picture
                        photo={photo}
                        sizes="(min-width: 80rem) 80rem, 100vw"
                        alt=""
                        className="absolute inset-0"
                        imgClassName="object-cover"
                        style={{ objectPosition: `${f.x * 100}% ${f.y * 100}%` }}
                      />
                      {film && (
                        <canvas
                          ref={(el) => {
                            canvases.current[r.slug] = el
                          }}
                          aria-hidden="true"
                          className="amp-film-canvas absolute inset-0 h-full w-full"
                        />
                      )}
                    </div>
                  </div>

                  {/* Legibility: the copy sits low on phones, low and left on desktop. */}
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_top,rgba(10,10,9,0.94)_0%,rgba(10,10,9,0.74)_34%,rgba(10,10,9,0.12)_64%,rgba(10,10,9,0)_78%)] lg:bg-[linear-gradient(to_right,rgba(10,10,9,0.5)_0%,rgba(10,10,9,0)_50%),linear-gradient(to_top,rgba(10,10,9,0.55)_0%,rgba(10,10,9,0)_42%)]"
                  />

                  <div className="absolute inset-x-0 bottom-0 p-5 sm:p-8 lg:bottom-8 lg:left-8 lg:right-auto lg:w-[min(31rem,46%)] lg:rounded-[8px] lg:border lg:border-amp-ivory/10 lg:bg-amp-obsidian/75 lg:p-9">
                    <DeckCopy room={r} index={i} count={n} loading={loading} />
                  </div>

                  {/* Dims as the next card rises over this one. */}
                  <div data-dim aria-hidden="true" className="pointer-events-none absolute inset-0 bg-amp-obsidian opacity-0" />
                </article>
              </li>
            )
          })}
          {/* Holds the last card at rest for as long as the others. */}
          {!still && <li aria-hidden="true" className="h-0" />}
        </ol>
      </div>

      <p className="mx-auto max-w-site px-gutter pb-16 pt-10 text-xs text-amp-ivory/50">
        Room films are animated from photographs of the lodge. Furnishings can differ between rooms of the same type.
      </p>
    </section>
  )
}

function DeckCopy({ room, index, count, loading }: { room: LiveRoom; index: number; count: number; loading: boolean }) {
  const rate = formatRate(room.price)
  return (
    <>
      <p data-reveal className="amp-eyebrow flex items-center gap-3 text-amp-gold-soft">
        <span className="amp-chapter-no text-amp-ivory/75">
          {pad(index + 1)} / {pad(count)}
        </span>
        <span aria-hidden="true" className="h-px w-8 bg-amp-gold/70" />
        {room.maxGuests ? `Up to ${room.maxGuests} guests` : 'The rooms'}
      </p>
      <h3 id={`deck-${room.slug}`} data-reveal className="amp-display mt-3 text-[clamp(2.1rem,4.4vw,4rem)] leading-[0.95]">
        {room.name}
      </h3>
      {room.tagline && (
        <p data-reveal className="mt-3 line-clamp-2 max-w-[32rem] text-[0.9375rem] leading-relaxed text-amp-ivory/85 [@media(max-height:40rem)]:hidden">
          {room.tagline}
        </p>
      )}
      <p data-reveal className="mt-4 flex items-baseline gap-2 border-t border-amp-ivory/15 pt-4 lg:mt-5">
        {rate ? (
          <>
            <span className="amp-display text-[clamp(1.9rem,3vw,2.6rem)] leading-none text-amp-ivory">{rate}</span>
            <span className="text-sm text-amp-ivory/75">per night</span>
          </>
        ) : loading ? (
          <span className="inline-block h-8 w-36 animate-pulse bg-amp-ivory/15">
            <span className="sr-only">Loading rate</span>
          </span>
        ) : (
          <span className="text-sm text-amp-ivory/80">Rate shown when you choose dates</span>
        )}
      </p>
      {!room.photographed && (
        <p data-reveal className="mt-2 text-xs text-amp-ivory/65">
          {room.photoNote}
        </p>
      )}
      <div data-reveal className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-1 lg:mt-6">
        <Link to={bookingHref(room)} onClick={() => setRoomChoice(room.slug)} className="amp-btn amp-btn--gold whitespace-nowrap">
          Book This Room<span className="sr-only">: {room.name}</span>{' '}
          <span className="amp-arrow" aria-hidden="true">
            →
          </span>
        </Link>
        <Link to={`/rooms/${room.slug}`} className="amp-eyebrow amp-link inline-flex min-h-11 items-center text-amp-ivory">
          View Room Details<span className="sr-only">: {room.name}</span>
        </Link>
      </div>
    </>
  )
}
