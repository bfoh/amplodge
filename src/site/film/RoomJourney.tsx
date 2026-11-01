import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { cn } from '@/lib/utils'
import { Picture } from '../components/Picture'
import { bookingHref, formatRate, useRooms, type LiveRoom } from '../data/rooms'
import { setRoomChoice } from '../data/room-choice'
import { gsap, useGSAP } from '../lib/gsap'
import { isLiteDevice, prefersReducedMotion, useMediaQuery } from '../motion/prefs'
import { scrollToTarget, scrollToY } from '../motion/scroll-control'
import { BOOKING_ANCHOR, ROOMS_ANCHOR, roomAnchor } from './anchors'
import { FILM_BASE, frameSet, roomFocus, roomStill } from './film-data'
import { FrameSequence } from './FrameSequence'

/** The pinned film: desktop with motion allowed. Everything else gets the cards. */
const FILM_MODE = '(min-width: 64rem) and (prefers-reduced-motion: no-preference)'
const CARD_MOTION = '(max-width: 63.98rem) and (prefers-reduced-motion: no-preference)'
const PHONE = '(max-width: 47.99rem)'

/** Desktop timeline, in beats: a short lead-in, one segment per room, then the hand-off. */
const LEAD = 0.3
const SEG = 1.5
const HANDOFF = 1.0
/** Where a jump to a room lands within its segment: after the entrance (and a portrait print) has settled. */
const SETTLE = 0.9
/** How the next room arrives. Varied by position; portrait films always open as a print. */
const ENTRANCES = ['door', 'iris', 'rise', 'split', 'frame'] as const
const FULL = 'inset(0% 0% 0% 0% round 0px)'
const ENTRANCE_FROM: Record<(typeof ENTRANCES)[number], string> = {
  door: 'inset(0% 0% 0% 100% round 0px)',
  iris: 'inset(32% 32% 32% 32% round 8px)',
  rise: 'inset(100% 0% 0% 0% round 0px)',
  split: 'inset(0% 50% 0% 50% round 0px)',
  frame: 'inset(14% 28% 14% 28% round 6px)',
}
/** Where the last room settles as the booking interface takes over. */
const EDITORIAL = 'inset(14% 6% 18% 48% round 6px)'

const pad = (n: number) => String(n).padStart(2, '0')
const isPortrait = (room: LiveRoom, phone: boolean) => {
  const set = frameSet(room.slug, phone)
  if (set) return set.h > set.w
  const still = roomStill(room.slug, room.hero)
  return still.height > still.width
}

/**
 * Chapter 08: every room category, as a film you can steer.
 *
 * The rooms come live from the booking system (useRooms), in price order, so
 * a category added there appears here without code changes; a room with no
 * film gets its photograph with a camera move made in the page.
 *
 * Desktop (motion allowed): a sticky stage. Each room arrives through a
 * different mask (a door, an iris, a rise, a split, a frame; portrait films as
 * a print), its own film scrubs with the scroll, and its name, guests, rate
 * and booking actions sit beside it. A room index jumps straight to any room,
 * with previous / next and a skip to booking. The last room settles into an
 * editorial frame and hands over to the booking interface (ChooseYourStay).
 *
 * Phones and tablets: no pinned scene. A sticky room selector and one
 * cinematic card per room; each card's film plays as it crosses the screen,
 * with native scrolling throughout.
 *
 * Reduced motion: the same cards with photographs and no movement.
 */
export function RoomJourney() {
  const { rooms, status } = useRooms()
  const filmMode = useMediaQuery(FILM_MODE)
  const root = useRef<HTMLElement>(null)
  const stRef = useRef<ScrollTrigger | null>(null)
  const stageCanvases = useRef<Record<string, HTMLCanvasElement | null>>({})
  const cardCanvases = useRef<Record<string, HTMLCanvasElement | null>>({})
  const seqs = useRef<Record<string, FrameSequence>>({})
  const activeRef = useRef(-1)
  const [active, setActive] = useState(0)
  const loading = status === 'loading'
  const n = rooms.length
  const total = LEAD + n * SEG + HANDOFF
  // Rebuild the motion only when the set of rooms changes, not when prices arrive.
  const key = useMemo(() => rooms.map((r) => r.slug).join('|'), [rooms])
  const portrait = useMemo(() => rooms.map((r) => isPortrait(r, false)), [rooms])

  const choose = (i: number) => {
    if (i === activeRef.current) return
    activeRef.current = i
    setActive(i)
    const room = rooms[Math.min(i, n - 1)]
    if (room) setRoomChoice(room.slug)
    // Load this room's film fully and the next one coarsely.
    const here = rooms[i]
    const next = rooms[i + 1]
    if (here) seqs.current[here.slug]?.load()
    if (next) seqs.current[next.slug]?.load(2)
  }

  // Frame sequences for whichever presentation is showing (films only; lite
  // devices and reduced motion keep the photographs).
  useEffect(() => {
    if (prefersReducedMotion() || isLiteDevice() || !n) return
    const phone = window.matchMedia(PHONE).matches
    const canvases = filmMode ? stageCanvases.current : cardCanvases.current
    const created: FrameSequence[] = []
    for (const room of rooms) {
      const canvas = canvases[room.slug]
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
    // Start the first films when the journey is a screen away; cards load as they approach.
    const el = root.current
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue
          const slug = (e.target as HTMLElement).dataset.slug
          if (slug) seqs.current[slug]?.load(2)
          else {
            seqs.current[rooms[0].slug]?.load()
            if (rooms[1]) seqs.current[rooms[1].slug]?.load(2)
          }
          io.unobserve(e.target)
        }
      },
      { rootMargin: '120% 0px' },
    )
    if (el) {
      if (filmMode) io.observe(el)
      else el.querySelectorAll<HTMLElement>('[data-card][data-slug]').forEach((c) => io.observe(c))
    }
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
  }, [key, filmMode])

  // Desktop: the pinned film.
  useGSAP(
    () => {
      const mm = gsap.matchMedia()
      mm.add(FILM_MODE, () => {
        const q = gsap.utils.selector(root)
        const layers = q('[data-room-layer]') as HTMLElement[]
        const count = layers.length
        if (!count) return
        const tl = gsap.timeline({
          defaults: { ease: 'none' },
          onUpdate: () => {
            const t = tl.time()
            const i = t >= LEAD + count * SEG + 0.2 ? count : Math.max(0, Math.min(count - 1, Math.floor((t - LEAD + 0.05) / SEG)))
            choose(i)
          },
          scrollTrigger: {
            trigger: q('[data-journey-track]')[0],
            start: 'top top',
            end: 'bottom bottom',
            scrub: 0.6,
            invalidateOnRefresh: true,
          },
        })
        stRef.current = tl.scrollTrigger ?? null
        const clip = (el: Element, from: string, to: string, at: number, duration: number, ease = 'power3.inOut') =>
          tl.fromTo(el, { clipPath: from }, { clipPath: to, duration, ease, immediateRender: false }, at)
        const copy = (i: number) => q(`[data-room-copy="${i}"]`)[0]

        gsap.set(layers, { autoAlpha: 0 })
        gsap.set(q('[data-room-copy]'), { autoAlpha: 0 })
        layers.forEach((el, i) => {
          const s = LEAD + i * SEG
          const cam = el.querySelector('[data-cam]')
          const print = el.dataset.portrait === 'true'
          const kind = print ? 'door' : ENTRANCES[i % ENTRANCES.length]
          const prev = layers[i - 1]
          const prevCam = prev?.querySelector('[data-cam]')

          // The entrance.
          tl.set(el, { autoAlpha: 1 }, s - 0.02)
          clip(el, ENTRANCE_FROM[kind], FULL, s, 0.62)
          if (cam) tl.fromTo(cam, { scale: kind === 'iris' || kind === 'frame' ? 1.24 : 1.14 }, { scale: 1, duration: 0.95, ease: 'power2.out' }, s)
          if (print) {
            const frame = el.querySelector('[data-print]')
            if (frame) clip(frame, 'inset(50% 0% 50% 0% round 6px)', 'inset(0% 0% 0% 0% round 6px)', s + 0.25, 0.6)
          }
          if (kind === 'door') {
            const edge = el.querySelector('[data-edge]')
            if (edge) {
              tl.fromTo(edge, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.03 }, s)
              tl.fromTo(edge, { xPercent: 100 }, { xPercent: 0, duration: 0.62, ease: 'power3.inOut' }, s)
              tl.to(edge, { autoAlpha: 0, duration: 0.03 }, s + 0.6)
            }
          }
          // The room it replaces steps back the way the new one arrives.
          if (prevCam) {
            const away = kind === 'door' ? { xPercent: -6 } : kind === 'rise' ? { yPercent: -6 } : {}
            tl.to(prevCam, { scale: 1.06, ...away, duration: 0.62, ease: 'power2.in' }, s)
          }
          if (prev) tl.set(prev, { autoAlpha: 0 }, s + 0.64)

          // Its film (or, without one, a slow camera move on the photograph).
          const slug = el.dataset.slug!
          const proxy = { p: 0 }
          const end = i === count - 1 ? SEG + 0.2 : SEG + 0.35
          tl.fromTo(proxy, { p: 0 }, { p: 1, duration: end, onUpdate: () => seqs.current[slug]?.setProgress(proxy.p) }, s + 0.05)
          if (el.dataset.film !== 'true') {
            const still = el.querySelector('[data-still]')
            if (still) tl.fromTo(still, { scale: 1, xPercent: 0 }, { scale: 1.08, xPercent: i % 2 ? 2.5 : -2.5, duration: end }, s + 0.05)
          }

          // Its name, facts and booking actions.
          const c = copy(i)
          tl.fromTo(c, { autoAlpha: 0, y: 28 }, { autoAlpha: 1, y: 0, duration: 0.22, ease: 'power2.out' }, s + 0.32)
          const out = i === count - 1 ? LEAD + count * SEG + 0.12 : s + SEG - 0.02
          tl.to(c, { autoAlpha: 0, y: -24, duration: 0.18, ease: 'power2.in' }, out - 0.18)
        })

        // The hand-off: the last room settles into an editorial frame.
        const h = LEAD + count * SEG
        clip(layers[count - 1], FULL, EDITORIAL, h, 0.6)
        tl.fromTo(q('[data-handoff]'), { autoAlpha: 0, y: 28 }, { autoAlpha: 1, y: 0, duration: 0.25, ease: 'power2.out' }, h + 0.3)
        tl.to(q('[data-journey-index]'), { autoAlpha: 0, duration: 0.2 }, h + 0.05)
        tl.to({}, { duration: 0.25 }, h + HANDOFF - 0.25)
      })
      return () => {
        stRef.current = null
        mm.revert()
      }
    },
    { scope: root, dependencies: [key], revertOnUpdate: true },
  )

  // Phones and tablets: each card's film plays as it crosses the screen.
  useGSAP(
    () => {
      const mm = gsap.matchMedia()
      mm.add(CARD_MOTION, () => {
        const q = gsap.utils.selector(root)
        ;(q('[data-card]') as HTMLElement[]).forEach((card, i) => {
          const media = card.querySelector('[data-card-media]')
          const cam = card.querySelector('[data-cam]')
          const slug = card.dataset.slug!
          if (media) {
            gsap.fromTo(
              media,
              { clipPath: 'inset(7% 7% 7% 7% round 14px)' },
              { clipPath: 'inset(0% 0% 0% 0% round 4px)', ease: 'none', scrollTrigger: { trigger: card, start: 'top 95%', end: 'top 40%', scrub: 0.5 } },
            )
          }
          if (cam) {
            gsap.fromTo(
              cam,
              { scale: 1.14, xPercent: i % 2 ? 3 : -3 },
              { scale: 1, xPercent: 0, ease: 'none', scrollTrigger: { trigger: card, start: 'top 95%', end: 'bottom 30%', scrub: 0.5 } },
            )
          }
          const proxy = { p: 0 }
          gsap.fromTo(
            proxy,
            { p: 0 },
            {
              p: 1,
              ease: 'none',
              onUpdate: () => seqs.current[slug]?.setProgress(proxy.p),
              scrollTrigger: { trigger: card, start: 'top 85%', end: 'bottom 25%', scrub: 0.4 },
            },
          )
        })
      })
      return () => mm.revert()
    },
    { scope: root, dependencies: [key, filmMode], revertOnUpdate: true },
  )

  // Cards: the selector follows the card in the middle of the screen.
  useEffect(() => {
    if (filmMode) return
    const el = root.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) choose(Number((e.target as HTMLElement).dataset.index))
      },
      { rootMargin: '-45% 0px -50% 0px' },
    )
    el.querySelectorAll('[data-card]').forEach((c) => io.observe(c))
    return () => io.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, filmMode])

  const goTo = (i: number) => {
    const target = Math.max(0, Math.min(n - 1, i))
    const st = stRef.current
    if (filmMode && st) {
      scrollToY(st.start + (st.end - st.start) * ((LEAD + target * SEG + SETTLE) / total))
      return
    }
    const card = document.getElementById(roomAnchor(rooms[target].slug))
    // Below the chips; going back up, the header shows again and the chips sit under it.
    if (card) scrollToTarget(card, card.getBoundingClientRect().top < 0 ? -140 : -76)
  }
  const toBooking = () => {
    const el = document.getElementById(BOOKING_ANCHOR)
    if (el) scrollToTarget(el)
  }

  if (!n) return null
  const current = Math.min(active, n - 1)

  return (
    <section ref={root} id={ROOMS_ANCHOR} aria-labelledby="journey-title" className="amp-on-dark relative bg-amp-obsidian text-amp-ivory" data-theme="dark" data-header-dark={filmMode ? '' : 'solid'}>
      <h2 id="journey-title" className="sr-only">
        The rooms
      </h2>

      {/* ── Desktop: the pinned film ─────────────────────────────────────── */}
      {filmMode && (
        <div data-journey-track className="relative" style={{ height: `${Math.round(total * 80 + 100)}svh` }}>
          {rooms.map((r, i) => (
            <span
              key={r.slug}
              id={roomAnchor(r.slug)}
              aria-hidden="true"
              className="absolute left-0 h-px w-px"
              style={{ top: `calc((100% - 100svh) * ${((LEAD + i * SEG + SETTLE) / total).toFixed(4)})` }}
            />
          ))}
          <div data-journey-stage className="sticky top-0 h-[100svh] min-h-[36rem] overflow-hidden">
            {rooms.map((r, i) => {
              const film = !!frameSet(r.slug, false)
              const f = roomFocus(r.slug)
              const still = r.photographed ? roomStill(r.slug, r.hero) : r.hero
              const media = (
                <div data-cam className="absolute inset-0 will-change-transform">
                  <div data-still className="absolute inset-0">
                    <Picture photo={still} sizes={portrait[i] ? '30vw' : '100vw'} alt="" className="absolute inset-0" imgClassName="object-cover" style={{ objectPosition: `${f.x * 100}% ${f.y * 100}%` }} />
                  </div>
                  {film && (
                    <canvas
                      ref={(el) => {
                        stageCanvases.current[r.slug] = el
                      }}
                      aria-hidden="true"
                      className="amp-film-canvas absolute inset-0 h-full w-full"
                    />
                  )}
                </div>
              )
              return (
                <div
                  key={r.slug}
                  data-room-layer
                  data-slug={r.slug}
                  data-film={film ? 'true' : 'false'}
                  data-portrait={portrait[i] ? 'true' : 'false'}
                  className={cn('invisible absolute inset-0 overflow-hidden', portrait[i] && 'bg-amp-charcoal')}
                >
                  {portrait[i] ? (
                    <div data-print className="absolute left-[42%] top-[13%] aspect-[9/16] h-[74%] overflow-hidden rounded-[6px] xl:left-[45%]">
                      {media}
                    </div>
                  ) : (
                    media
                  )}
                  <div data-edge aria-hidden="true" className="pointer-events-none invisible absolute inset-0">
                    <span className="absolute inset-y-0 left-0 w-px bg-amp-gold/80" />
                  </div>
                </div>
              )
            })}

            <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_top,rgba(10,10,9,0.88)_0%,rgba(10,10,9,0.4)_38%,rgba(10,10,9,0.02)_66%),linear-gradient(to_right,rgba(10,10,9,0.55),rgba(10,10,9,0)_45%),linear-gradient(to_bottom,rgba(10,10,9,0.45),rgba(10,10,9,0)_20%)]" />

            {rooms.map((r, i) => (
              <div
                key={r.slug}
                data-room-copy={i}
                className={cn(
                  'invisible absolute inset-x-0 bottom-0 mx-auto max-w-site px-gutter pb-20',
                  portrait[i] && 'inset-y-0 flex flex-col justify-center pb-0',
                )}
              >
                <div className={cn('max-w-[34rem]', portrait[i] && 'max-w-[36%]')}>
                  <RoomCopy room={r} index={i} count={n} loading={loading} heading="h3" />
                </div>
              </div>
            ))}

            {/* The hand-off to the booking interface. */}
            <div data-handoff className="invisible absolute inset-y-0 left-0 mx-auto flex w-full max-w-site flex-col justify-center px-gutter">
              <div className="max-w-[40%]">
                <p className="amp-eyebrow text-amp-gold-soft">Choose your stay</p>
                <p className="amp-display mt-4 text-[clamp(2.4rem,4.6vw,4.5rem)] leading-[0.98]">Every room, side by side.</p>
                <p className="mt-4 text-amp-ivory/80">Compare rates and guest numbers, then choose your dates.</p>
                <button type="button" onClick={toBooking} className="amp-btn amp-btn--gold mt-8 whitespace-nowrap">
                  Compare and book{' '}
                  <span className="amp-arrow" aria-hidden="true">
                    ↓
                  </span>
                </button>
              </div>
            </div>

            {/* The room index: where you are, any room directly, previous / next, and out. */}
            <nav
              data-journey-index
              aria-label="Rooms"
              className="absolute right-gutter top-1/2 w-[13rem] -translate-y-1/2 before:pointer-events-none before:absolute before:-inset-x-14 before:-inset-y-16 before:-z-10 before:bg-[radial-gradient(closest-side,rgba(10,10,9,0.62),rgba(10,10,9,0.38)_55%,rgba(10,10,9,0))] before:content-['']"
            >
              <p className="amp-chapter-no text-[0.6875rem] text-amp-ivory/70">
                <span className="text-amp-gold-soft">{pad(current + 1)}</span> / {pad(n)} · Rooms
              </p>
              <ol className="mt-4 border-l border-amp-ivory/15">
                {rooms.map((r, i) => (
                  <li key={r.slug}>
                    <button
                      type="button"
                      onClick={() => goTo(i)}
                      aria-current={i === current ? 'true' : undefined}
                      className={cn(
                        'relative -ml-px flex min-h-10 w-full items-center gap-3 border-l py-1 pl-4 text-left text-[0.8125rem] transition-colors duration-500',
                        i === current ? 'border-amp-gold text-amp-ivory' : 'border-transparent text-amp-ivory/70 hover:text-amp-ivory',
                      )}
                    >
                      <span className="amp-chapter-no text-[0.625rem] text-amp-gold-soft/80">{pad(i + 1)}</span>
                      {r.name}
                    </button>
                  </li>
                ))}
              </ol>
              <div className="mt-4 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => goTo(current - 1)}
                  disabled={current === 0}
                  aria-label="Previous room"
                  className="inline-flex h-11 w-11 items-center justify-center border border-amp-ivory/25 text-amp-ivory transition-colors hover:border-amp-gold disabled:opacity-35"
                >
                  <span aria-hidden="true">←</span>
                </button>
                <button
                  type="button"
                  onClick={() => goTo(current + 1)}
                  disabled={current >= n - 1}
                  aria-label="Next room"
                  className="inline-flex h-11 w-11 items-center justify-center border border-amp-ivory/25 text-amp-ivory transition-colors hover:border-amp-gold disabled:opacity-35"
                >
                  <span aria-hidden="true">→</span>
                </button>
              </div>
              <button type="button" onClick={toBooking} className="amp-eyebrow amp-link mt-3 inline-flex min-h-11 items-center !text-[0.625rem] text-amp-ivory/80">
                Skip to booking
              </button>
            </nav>
          </div>
        </div>
      )}

      {/* ── Phones, tablets and reduced motion: cards ───────────────────── */}
      {!filmMode && (
        <div className="pb-8 pt-16 motion-reduce:pt-0">
          <nav data-chip-nav aria-label="Rooms" className="sticky top-0 z-20 border-y border-amp-ivory/10 bg-amp-obsidian/90 backdrop-blur-md">
            <ol className="mx-auto flex max-w-site gap-1 overflow-x-auto px-gutter py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {rooms.map((r, i) => (
                <li key={r.slug} className="shrink-0">
                  <button
                    type="button"
                    onClick={() => goTo(i)}
                    aria-current={i === current ? 'true' : undefined}
                    className={cn(
                      'inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-[0.8125rem] transition-colors duration-300',
                      i === current ? 'border-amp-gold bg-amp-gold/15 text-amp-ivory' : 'border-amp-ivory/20 text-amp-ivory/75',
                    )}
                  >
                    <span className="amp-chapter-no text-[0.625rem] text-amp-gold-soft">{pad(i + 1)}</span>
                    {r.name}
                  </button>
                </li>
              ))}
              <li className="shrink-0">
                <button type="button" onClick={toBooking} className="amp-eyebrow amp-link inline-flex min-h-11 items-center px-3 !text-[0.625rem] text-amp-gold-soft">
                  Skip to booking
                </button>
              </li>
            </ol>
          </nav>

          <ol className="mx-auto mt-10 grid max-w-site gap-20 px-gutter sm:gap-24 md:grid-cols-2 md:gap-x-8">
            {rooms.map((r, i) => {
              const film = !!frameSet(r.slug, true)
              const f = roomFocus(r.slug)
              const still = r.photographed ? roomStill(r.slug, r.hero) : r.hero
              return (
                <li key={r.slug} id={roomAnchor(r.slug)} data-card data-slug={r.slug} data-index={i} className="scroll-mt-20">
                  <div data-card-media className="relative aspect-[4/5] overflow-hidden rounded-[4px] bg-amp-charcoal">
                    <div data-cam className="absolute inset-0 will-change-transform">
                      <Picture photo={still} sizes="(min-width: 48rem) 46vw, 100vw" alt="" className="absolute inset-0" imgClassName="object-cover" style={{ objectPosition: `${f.x * 100}% ${f.y * 100}%` }} />
                      {film && (
                        <canvas
                          ref={(el) => {
                            cardCanvases.current[r.slug] = el
                          }}
                          aria-hidden="true"
                          className="amp-film-canvas absolute inset-0 h-full w-full motion-reduce:hidden"
                        />
                      )}
                    </div>
                    <span className="amp-chapter-no absolute left-3 top-3 rounded-full bg-amp-obsidian/70 px-2.5 py-1 text-[0.6875rem] text-amp-ivory backdrop-blur-sm">
                      {pad(i + 1)} / {pad(n)}
                    </span>
                  </div>
                  <div className="mt-6">
                    <RoomCopy room={r} index={i} count={n} loading={loading} heading="h3" compact />
                  </div>
                </li>
              )
            })}
          </ol>
          <p className="mx-auto mt-12 max-w-site px-gutter text-xs text-amp-ivory/50">Room films are animated from photographs of the lodge. Furnishings can differ between rooms of the same type.</p>
        </div>
      )}
    </section>
  )
}

function RoomCopy({
  room,
  index,
  count,
  loading,
  heading: H,
  compact,
}: {
  room: LiveRoom
  index: number
  count: number
  loading: boolean
  heading: 'h3'
  compact?: boolean
}) {
  const rate = formatRate(room.price)
  return (
    <>
      {!compact && (
        <p className="amp-eyebrow flex items-center gap-3 text-amp-gold-soft">
          <span className="amp-chapter-no text-amp-ivory/70">
            {pad(index + 1)} / {pad(count)}
          </span>
          <span aria-hidden="true" className="h-px w-8 bg-amp-gold/70" />
          The rooms
        </p>
      )}
      <H className={cn('amp-display leading-[0.95]', compact ? 'text-[clamp(2.2rem,8vw,3.25rem)]' : 'mt-4 text-[clamp(2.8rem,5.6vw,5.75rem)]')}>{room.name}</H>
      {room.tagline && <p className="amp-lede mt-3 text-amp-ivory/85">{room.tagline}</p>}
      <p className="mt-4 flex flex-wrap items-baseline gap-x-5 gap-y-1 text-sm text-amp-ivory/80">
        {room.maxGuests ? <span>Up to {room.maxGuests} guests</span> : null}
        {rate ? (
          <span>
            <span className="amp-display text-2xl text-amp-ivory">{rate}</span> per night
          </span>
        ) : loading ? (
          <span className="inline-block h-5 w-28 animate-pulse bg-amp-ivory/15"><span className="sr-only">Loading rate</span></span>
        ) : (
          <span>Rate shown when you choose dates</span>
        )}
      </p>
      {!room.photographed && <p className="mt-2 text-xs text-amp-ivory/60">{room.photoNote}</p>}
      <div className="mt-6 flex flex-col items-start gap-x-6 gap-y-2 sm:flex-row sm:flex-wrap sm:items-center">
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
