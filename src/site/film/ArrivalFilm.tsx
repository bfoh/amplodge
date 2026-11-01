import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { cn } from '@/lib/utils'
import { Picture } from '../components/Picture'
import { HERO_MEDIA, type Photo } from '../data/photos'
import { bookingHref, formatRate, useRooms, type LiveRoom } from '../data/rooms'
import { SITE } from '../data/site'
import { gsap, useGSAP } from '../lib/gsap'
import { onIntro } from '../motion/intro-state'
import { markPageReady } from '../motion/page-ready'
import { isLiteDevice, prefersReducedMotion } from '../motion/prefs'
import { Reveal } from '../motion/Reveal'
import { scrollToTarget } from '../motion/scroll-control'
import { SplitHeading } from '../motion/SplitHeading'
import { CLIPS, FILM_BASE, FILM_ROOMS, SCENES, frameSet, type ClipId } from './film-data'
import { FrameSequence } from './FrameSequence'

const PHONE = '(max-width: 47.99rem)'
const CLIP_ORDER: ClipId[] = ['arrival', 'approach', 'corridor', 'standard', 'family', 'executive']

/** Where each scene starts on the master timeline (in "beats"), and the clip it needs. */
const SCENE_AT = [0, 0.95, 2.0, 2.65, 3.65, 4.55, 5.95, 7.3]
const SCENE_CLIP: ClipId[] = ['arrival', 'approach', 'corridor', 'corridor', 'standard', 'standard', 'family', 'executive']
const COUNT_WORDS: Record<number, string> = { 2: 'Two', 3: 'Three', 4: 'Four', 5: 'Five', 6: 'Six', 7: 'Seven', 8: 'Eight', 9: 'Nine' }

export const ROOMS_ANCHOR = 'choose-your-stay'

/**
 * Chapters 01–08: the arrival film.
 *
 * A tall track holds a sticky stage, and one scrubbed GSAP timeline (the
 * progress model) drives everything on it from the scroll position: the frame
 * sequences, the camera moves, the masks and exposure changes between scenes,
 * and the copy. Scrolling back plays it backwards. Nothing is pinned by
 * JavaScript and nothing snaps, so touch scrolling stays native.
 *
 * Arrival (dusk) → the approach (night, toward the lit gate) → the threshold
 * (an aperture opens on the corridor, light adapts from cool to warm) → inside
 * → the rooms title → Standard (a door-like wipe) → Family → Executive Suite →
 * the frame contracts and the room selection takes over.
 *
 * Fallbacks: lite devices, Save-Data and slow connections get the same film
 * with the real photographs and page-made camera moves, without frames;
 * reduced motion gets a static, captioned sequence. The copy and the booking
 * actions never depend on motion.
 */
export function ArrivalFilm() {
  const root = useRef<HTMLElement>(null)
  const poster = useRef<HTMLImageElement>(null)
  const canvases = useRef<Partial<Record<ClipId, HTMLCanvasElement | null>>>({})
  const seqs = useRef<Partial<Record<ClipId, FrameSequence>>>({})
  const sceneRef = useRef(0)
  const loadTimer = useRef(0)
  const [scene, setScene] = useState(0)
  const [stills, setStills] = useState(false)
  const { rooms, status } = useRooms()

  const room = (slug: string) => rooms.find((r) => r.slug === slug)

  // The intro waits for the poster before opening the curtain.
  useEffect(() => {
    const el = poster.current
    if (!el) return markPageReady()
    if (el.complete) markPageReady()
    else {
      const done = () => markPageReady()
      el.addEventListener('load', done, { once: true })
      el.addEventListener('error', done, { once: true })
      return () => {
        el.removeEventListener('load', done)
        el.removeEventListener('error', done)
      }
    }
  }, [])

  // Frame sequences and stills: nothing beyond the poster loads until the intro
  // has released, the page has loaded and the browser is idle.
  useEffect(() => {
    if (prefersReducedMotion()) return
    const lite = isLiteDevice()
    const phone = window.matchMedia(PHONE).matches
    const created: FrameSequence[] = []
    if (!lite) {
      for (const id of CLIP_ORDER) {
        const canvas = canvases.current[id]
        const set = frameSet(id, phone)
        if (!canvas || !set) continue
        const clip = CLIPS[id]
        const seq = new FrameSequence(canvas, `${FILM_BASE}/${id}`, set, phone ? 'm' : 'd', phone ? 0.5 : clip.focusX, clip.focusY)
        seq.onReady = () => {
          canvas.dataset.ready = ''
        }
        seqs.current[id] = seq
        created.push(seq)
      }
    }

    // Frames wait until the hero has settled (they cost ~150 ms of desktop LCP
    // when they start with it), unless the visitor starts scrolling first: then
    // they start at once, and the LCP measurement has ended anyway.
    let started = false
    let idleId = 0
    let settleTimer = 0
    const INPUTS = ['wheel', 'touchstart', 'pointerdown', 'keydown', 'scroll'] as const
    const stopListening = () => INPUTS.forEach((e) => window.removeEventListener(e, start))
    function start() {
      if (started) return
      started = true
      stopListening()
      setStills(true)
      seqs.current.arrival?.load()
      seqs.current.approach?.load(2)
    }
    const whenSettled = () => {
      const ric = (
        window as Window & {
          requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number
        }
      ).requestIdleCallback
      settleTimer = window.setTimeout(() => {
        if (ric) idleId = ric(start, { timeout: 1500 })
        else start()
      }, 1200)
    }
    const stopIntro = onIntro(() => {
      if (started) return
      INPUTS.forEach((e) => window.addEventListener(e, start, { passive: true }))
      if (document.readyState === 'complete') whenSettled()
      else window.addEventListener('load', whenSettled, { once: true })
    })

    let raf = 0
    const onResize = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => created.forEach((s) => s.resize()))
    }
    window.addEventListener('resize', onResize)
    return () => {
      started = true
      stopIntro()
      stopListening()
      window.removeEventListener('load', whenSettled)
      clearTimeout(settleTimer)
      ;(window as Window & { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback?.(idleId)
      window.removeEventListener('resize', onResize)
      cancelAnimationFrame(raf)
      clearTimeout(loadTimer.current)
      created.forEach((s) => s.dispose())
      seqs.current = {}
    }
  }, [])

  // Scene changes: update the rail, and load the current and next clips once
  // the visitor has settled on a scene for a moment (a fast skip through the
  // film shouldn't download every clip on the way).
  const onTime = (t: number) => {
    let s = 0
    for (let i = 0; i < SCENE_AT.length; i++) if (t >= SCENE_AT[i] - 0.001) s = i
    if (s === sceneRef.current) return
    sceneRef.current = s
    setScene(s)
    clearTimeout(loadTimer.current)
    loadTimer.current = window.setTimeout(() => {
      seqs.current[SCENE_CLIP[s]]?.load()
      const next = SCENE_CLIP[Math.min(SCENE_CLIP.length - 1, s + 1)]
      const after = SCENE_CLIP[Math.min(SCENE_CLIP.length - 1, s + 2)]
      seqs.current[next]?.load(2)
      if (after !== next) seqs.current[after]?.load(2)
    }, 160)
  }

  // Idle: the faintest push-in on the poster while the page is at rest (under 5 s).
  useGSAP(
    () => {
      if (prefersReducedMotion()) return
      const el = root.current?.querySelector('[data-layer="arrival"] [data-idle]')
      if (!el) return
      const tween = gsap.fromTo(el, { scale: 1 }, { scale: 1.035, duration: 4.6, ease: 'power1.out', paused: true })
      return onIntro(() => tween.play())
    },
    { scope: root },
  )

  // The master timeline.
  useGSAP(
    () => {
      const mm = gsap.matchMedia()
      mm.add(
        {
          desktop: '(min-width: 64rem) and (prefers-reduced-motion: no-preference)',
          compact: '(max-width: 63.98rem) and (prefers-reduced-motion: no-preference)',
        },
        (ctx) => {
          const desktop = !!ctx.conditions?.desktop
          const q = gsap.utils.selector(root)
          const stage = q('[data-film-stage]')[0] as HTMLElement
          const layer = (id: string) => q(`[data-layer="${id}"]`)[0] as HTMLElement
          const cam = (id: string) => q(`[data-layer="${id}"] [data-cam]`)[0] as HTMLElement
          const overlay = (id: string) => q(`[data-overlay="${id}"]`)[0] as HTMLElement
          const familyFrame = q('[data-family-frame]')[0] as HTMLElement

          const pct = (v: number, of: number) => ((v / of) * 100).toFixed(3)
          /** clip-path that crops the full stage down to an element's box. */
          const insetTo =
            (el: HTMLElement, r = 6) =>
            () => {
              const s = stage.getBoundingClientRect()
              const b = el.getBoundingClientRect()
              return `inset(${pct(b.top - s.top, s.height)}% ${pct(s.right - b.right, s.width)}% ${pct(s.bottom - b.bottom, s.height)}% ${pct(b.left - s.left, s.width)}% round ${r}px)`
            }
          // clip-path tweens always state both ends: a browser's computed inset() drops
          // repeated sides (inset(24% 46.5% 12%)), which would pair the wrong numbers.
          const FULL = 'inset(0% 0% 0% 0% round 0px)'
          const APERTURE = 'inset(24% 46.5% 12% 46.5% round 2px)'
          const FROM_RIGHT = 'inset(0% 0% 0% 100% round 0px)'
          const clip = (el: HTMLElement, from: string | (() => string), to: string | (() => string), at: number, duration: number, ease = 'power3.inOut') =>
            tl.fromTo(el, { clipPath: from }, { clipPath: to, duration, ease, immediateRender: false }, at)

          const tl = gsap.timeline({
            defaults: { ease: 'none' },
            onUpdate: () => onTime(tl.time()),
            scrollTrigger: {
              trigger: q('[data-film-track]')[0],
              start: 'top top',
              end: 'bottom bottom',
              scrub: 0.6,
              invalidateOnRefresh: true,
            },
          })

          const scrub = (id: ClipId, at: number, duration: number) => {
            const proxy = { p: 0 }
            tl.fromTo(
              proxy,
              { p: 0 },
              {
                p: 1,
                duration,
                onUpdate: () => seqs.current[id]?.setProgress(proxy.p),
              },
              at,
            )
          }
          // Captions leave the accessibility tree when off screen (visibility), except
          // section headings with nothing to click (`keep`), which only fade, so the
          // heading outline (h1 → h2 → h3) stays whole at every point of the film.
          const show = (id: string, from: number, to?: number, keep = false) => {
            const el = overlay(id)
            const prop = keep ? 'opacity' : 'autoAlpha'
            tl.fromTo(el, { [prop]: 0, y: 28 }, { [prop]: 1, y: 0, duration: 0.22, ease: 'power2.out' }, from)
            if (to !== undefined) tl.to(el, { [prop]: 0, y: -24, duration: 0.18, ease: 'power2.in' }, to - 0.18)
          }

          // Starting states (reverted by mm when the media query stops matching).
          gsap.set([layer('approach'), layer('corridor'), layer('standard'), layer('family'), layer('executive')], { autoAlpha: 0 })
          gsap.set(layer('corridor'), { clipPath: APERTURE })
          gsap.set(layer('standard'), { clipPath: FROM_RIGHT })
          if (!desktop) gsap.set(layer('family'), { clipPath: FROM_RIGHT })

          // 01 Arrival: the dusk clip scrubs, the camera leans in, the copy recedes.
          scrub('arrival', 0, 0.95)
          tl.fromTo(cam('arrival'), { scale: 1 }, { scale: 1.14, duration: 1.1 }, 0)
          tl.fromTo(q('[data-arrival-frames]'), { opacity: 0 }, { opacity: 1, duration: 0.08 }, 0.01)
          // Opacity only on the copy, so the page's h1 stays in the accessibility
          // tree for the whole film; the buttons are taken out of the tab order
          // (visibility) once they have faded, so focus never lands on them unseen.
          tl.to(overlay('hero'), { opacity: 0, yPercent: -10, duration: 0.42 }, 0.28)
          tl.set(q('[data-hero-actions]'), { visibility: 'hidden' }, 0.7)
          tl.fromTo(q('[data-film-rail]'), { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.2 }, 0.5)

          // 02 Approach: evening falls (a dip in exposure), then the night clip and a push toward the gate.
          tl.fromTo(q('[data-dip]'), { opacity: 0 }, { opacity: 0.6, duration: 0.17 }, 0.72).to(q('[data-dip]'), { opacity: 0, duration: 0.22 }, 0.9)
          tl.to(layer('approach'), { autoAlpha: 1, duration: 0.3 }, 0.78)
          tl.set(layer('arrival'), { autoAlpha: 0 }, 1.15)
          scrub('approach', 0.85, 1.25)
          tl.fromTo(cam('approach'), { scale: 1 }, { scale: 1.22, duration: 1.25 }, 0.8)
          show('approach', 1.05, 1.92)

          // 03 Threshold: an aperture opens on the corridor; light adapts from cool night to warm interior.
          tl.to(cam('approach'), { scale: 1.62, duration: 0.62, ease: 'power2.in' }, 2.05)
          tl.set(layer('corridor'), { autoAlpha: 1 }, 2.0)
          clip(layer('corridor'), APERTURE, FULL, 2.05, 0.62, 'power2.inOut')
          tl.fromTo(cam('corridor'), { scale: 1.28 }, { scale: 1, duration: 0.75, ease: 'power2.out' }, 2.05)
          tl.fromTo(q('[data-warm]'), { opacity: 0.55 }, { opacity: 0, duration: 0.7 }, 2.1)
          tl.set(layer('approach'), { autoAlpha: 0 }, 2.72)

          // 04 Inside: the corridor dolly.
          scrub('corridor', 2.3, 1.45)
          show('interior', 2.78, 3.6)

          // 05 The rooms: the corridor dims under the title, then a door-like wipe opens on the Standard Room.
          tl.fromTo(q('[data-layer="corridor"] [data-shade]'), { opacity: 0 }, { opacity: 0.7, duration: 0.3 }, 3.55)
          show('rooms', 3.72, 4.32, true)
          tl.set(layer('standard'), { autoAlpha: 1 }, 4.15)
          clip(layer('standard'), FROM_RIGHT, FULL, 4.2, 0.55)
          tl.fromTo(q('[data-door-edge]'), { xPercent: 0, autoAlpha: 0 }, { autoAlpha: 1, duration: 0.05 }, 4.2)
          tl.fromTo(q('[data-door-edge]'), { left: '100%' }, { left: '0%', duration: 0.55, ease: 'power3.inOut' }, 4.2)
          tl.to(q('[data-door-edge]'), { autoAlpha: 0, duration: 0.05 }, 4.72)
          tl.fromTo(cam('standard'), { scale: 1.16 }, { scale: 1, duration: 0.7, ease: 'power2.out' }, 4.2)
          tl.set(layer('corridor'), { autoAlpha: 0 }, 4.8)

          // 06 Standard Room.
          scrub('standard', 4.3, 1.5)
          show('standard', 4.75, 5.68)

          // 07 Family Room. Desktop: the Standard contracts into a portrait print and the Family Room appears in it.
          // Phones and tablets: the Family Room wipes in from the right.
          if (desktop) {
            clip(layer('standard'), FULL, insetTo(familyFrame), 5.65, 0.5)
            tl.to(layer('family'), { autoAlpha: 1, duration: 0.25 }, 5.98)
          } else {
            tl.set(layer('family'), { autoAlpha: 1 }, 5.68)
            clip(layer('family'), FROM_RIGHT, FULL, 5.7, 0.5)
            tl.to(cam('standard'), { xPercent: -8, duration: 0.5, ease: 'power2.in' }, 5.7)
          }
          tl.set(layer('standard'), { autoAlpha: 0 }, 6.25)
          scrub('family', 5.9, 1.4)
          show('family', 6.15, 7.05)

          // 08 Executive Suite: the most dramatic reveal, expanding out of the print (or the centre) to full bleed.
          const execFrom = desktop ? insetTo(familyFrame) : () => 'inset(30% 18% 30% 18% round 6px)'
          tl.set(layer('executive'), { autoAlpha: 1 }, 7.0)
          clip(layer('executive'), execFrom, FULL, 7.0, 0.62)
          tl.fromTo(cam('executive'), { scale: 1.26 }, { scale: 1, duration: 0.8, ease: 'power2.out' }, 7.0)
          tl.set(layer('family'), { autoAlpha: 0 }, 7.65)
          scrub('executive', 7.2, 1.4)
          show('executive', 7.62, 8.5)

          // 09 Hand-off: the last frame settles into an editorial frame and the room selection takes over.
          const editorial = desktop ? 'inset(12% 6% 16% 44% round 6px)' : 'inset(16% 5% 36% 5% round 6px)'
          clip(layer('executive'), FULL, editorial, 8.55, 0.5)
          show('handoff', 8.75)
          tl.to(q('[data-film-rail]'), { autoAlpha: 0, duration: 0.15 }, 8.6)
          tl.to({}, { duration: 0.2 }, 9.05)
        },
      )
      return () => mm.revert()
    },
    { scope: root },
  )

  const skipToRooms = () => {
    const target = document.getElementById(ROOMS_ANCHOR)
    if (target) scrollToTarget(target)
  }

  const stillOf = (photo: Photo | null, focus: string) =>
    photo && stills ? (
      <Picture photo={photo} sizes="100vw" alt="" className="absolute inset-0 h-full w-full" imgClassName="object-cover" style={{ objectPosition: focus }} />
    ) : null

  const canvasFor = (id: ClipId) => (
    <canvas
      ref={(el) => {
        canvases.current[id] = el
      }}
      aria-hidden="true"
      className="amp-film-canvas absolute inset-0 h-full w-full"
    />
  )

  const minRate = rooms.filter((r) => r.price).reduce<number | null>((m, r) => (m === null || (r.price ?? 0) < m ? r.price : m), null)
  // The hand-off counts the live room types, so the line stays true if one is added or retired.
  const roomCount = rooms.length > 1 ? (COUNT_WORDS[rooms.length] ?? String(rooms.length)) : null

  return (
    <section ref={root} className="amp-on-dark relative bg-amp-obsidian text-amp-ivory" aria-labelledby="hero-title" data-theme="dark" data-header-dark>
      <div data-film-track className="relative motion-safe:h-[680svh] motion-safe:lg:h-[880svh]">
        <div data-film-stage className="sticky top-0 h-[100svh] min-h-[34rem] overflow-hidden motion-reduce:relative">
          {/* ── Layers, bottom to top ─────────────────────────────────────── */}
          <div data-layer="arrival" className="absolute inset-0 overflow-hidden">
            <div data-cam className="absolute inset-0 will-change-transform">
              <div data-idle className="absolute inset-0">
                <picture className="block h-full w-full">
                  <source type="image/webp" media={PHONE} srcSet={`${HERO_MEDIA.poster960}.webp`} />
                  <source type="image/webp" srcSet={`${HERO_MEDIA.poster1920}.webp`} />
                  <img
                    ref={poster}
                    src={`${HERO_MEDIA.poster1920}.jpg`}
                    alt={HERO_MEDIA.alt}
                    width={HERO_MEDIA.width}
                    height={HERO_MEDIA.height}
                    fetchPriority="high"
                    decoding="async"
                    className="absolute inset-0 h-full w-full object-cover [object-position:28%_50%] md:[object-position:50%_45%]"
                  />
                </picture>
                {/* Hidden at rest so the clean poster shows; fades in once scrolling starts. */}
                <div data-arrival-frames className="absolute inset-0">
                  {canvasFor('arrival')}
                </div>
              </div>
            </div>
          </div>

          <div data-layer="approach" className="absolute inset-0 overflow-hidden motion-reduce:!hidden">
            <div data-cam className="absolute inset-0 will-change-transform" style={{ transformOrigin: '50% 56%' }}>
              {stillOf(CLIPS.approach.still, '45% 55%')}
              {canvasFor('approach')}
            </div>
          </div>

          <div data-layer="corridor" className="absolute inset-0 overflow-hidden motion-reduce:!hidden">
            <div data-cam className="absolute inset-0 will-change-transform">
              {stillOf(CLIPS.corridor.still, '50% 50%')}
              {canvasFor('corridor')}
            </div>
            <div data-warm className="pointer-events-none absolute inset-0 bg-[#f3c98b] opacity-0 mix-blend-soft-light" />
            <div data-shade className="pointer-events-none absolute inset-0 bg-amp-obsidian opacity-0" />
          </div>

          <div data-layer="standard" className="absolute inset-0 overflow-hidden motion-reduce:!hidden">
            <div data-cam className="absolute inset-0 will-change-transform">
              {stillOf(CLIPS.standard.still, '42% 55%')}
              {canvasFor('standard')}
            </div>
          </div>

          {/* Desktop: a portrait print on the right (the clip is portrait). Phones and tablets: full bleed. */}
          <div data-layer="family" className="absolute inset-0 overflow-hidden motion-reduce:!hidden">
            <div
              data-family-frame
              className="absolute inset-0 overflow-hidden lg:inset-auto lg:right-[22%] lg:top-[13%] lg:aspect-[9/16] lg:h-[72%] lg:rounded-[6px]"
            >
              <div data-cam className="absolute inset-0 will-change-transform">
                {stillOf(CLIPS.family.still, '50% 60%')}
                {canvasFor('family')}
              </div>
            </div>
          </div>

          <div data-layer="executive" className="absolute inset-0 overflow-hidden motion-reduce:!hidden">
            <div data-cam className="absolute inset-0 will-change-transform">
              {stillOf(CLIPS.executive.still, '50% 60%')}
              {canvasFor('executive')}
            </div>
          </div>

          {/* The door edge: a gold hairline leading the wipe into the first room. */}
          <div
            data-door-edge
            aria-hidden="true"
            className="pointer-events-none invisible absolute inset-y-0 left-full w-px bg-amp-gold/80 motion-reduce:!hidden"
          />

          {/* Legibility, and the exposure dip between dusk and night. */}
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_top,rgba(10,10,9,0.92)_0%,rgba(10,10,9,0.62)_42%,rgba(10,10,9,0.08)_74%),linear-gradient(to_bottom,rgba(10,10,9,0.5),rgba(10,10,9,0)_22%)] md:bg-[linear-gradient(to_top,rgba(10,10,9,0.88)_0%,rgba(10,10,9,0.45)_38%,rgba(10,10,9,0.04)_68%),linear-gradient(to_bottom,rgba(10,10,9,0.5),rgba(10,10,9,0)_22%)]" />
          <div data-dip className="pointer-events-none absolute inset-0 bg-[#060606] opacity-0" />

          <p className="sr-only">
            A short film follows as you scroll: the lodge at dusk, the lit gate at night, the corridor to the rooms, then the Standard Room, the Family Room and
            the Executive Suite. It is animated from photographs of the lodge.
          </p>

          {/* ── Copy ─────────────────────────────────────────────────────── */}
          <div
            data-overlay="hero"
            className="pointer-events-none absolute inset-0 mx-auto flex max-w-site flex-col justify-end px-gutter pb-[max(2.5rem,calc(env(safe-area-inset-bottom)+1.5rem))] pt-[calc(var(--amp-header-h)+1rem)] lg:pb-24"
          >
            <Reveal play="intro" delay={0.05} y={16}>
              <p className="amp-eyebrow flex items-center gap-3 text-amp-gold-soft">
                <span className="amp-chapter-no text-amp-ivory/70">01</span>
                <span aria-hidden="true" className="h-px w-8 bg-amp-gold/70" />
                Your comfort. Our priority.
              </p>
            </Reveal>
            <SplitHeading
              as="h1"
              id="hero-title"
              play="intro"
              delay={0.1}
              className="amp-display mt-5 max-w-[14ch] text-[clamp(2.75rem,10.5vw,8.25rem)] !leading-[0.94]"
            >
              Arrive. Unwind. Feel at Home.
            </SplitHeading>
            <div className="mt-6 grid gap-8 lg:mt-10 xl:grid-cols-[minmax(0,34rem)_1fr] xl:items-end">
              <Reveal play="intro" delay={0.45}>
                <p className="amp-lede max-w-[34rem] text-amp-ivory/85">
                  Your welcoming retreat in Kumasi, where thoughtful comfort meets genuine hospitality.
                </p>
              </Reveal>
              <Reveal play="intro" delay={0.6}>
                <div data-hero-actions className="pointer-events-auto flex flex-col gap-3 sm:flex-row xl:justify-end">
                  <Link to="/booking" className="amp-btn amp-btn--gold whitespace-nowrap">
                    Book Your Stay{' '}
                    <span className="amp-arrow" aria-hidden="true">
                      →
                    </span>
                  </Link>
                  <a
                    href={`#${ROOMS_ANCHOR}`}
                    onClick={(e) => {
                      e.preventDefault()
                      skipToRooms()
                    }}
                    className="amp-btn amp-btn--ghost-light whitespace-nowrap"
                  >
                    Explore Rooms
                  </a>
                </div>
              </Reveal>
            </div>
          </div>

          <div
            data-overlay="approach"
            className="invisible absolute inset-x-0 bottom-0 mx-auto max-w-site px-gutter pb-[calc(env(safe-area-inset-bottom)+7rem)] motion-reduce:!hidden lg:pb-24"
          >
            <p className="amp-eyebrow flex items-center gap-3 text-amp-gold-soft">
              <span className="amp-chapter-no text-amp-ivory/70">02</span>
              <span aria-hidden="true" className="h-px w-8 bg-amp-gold/70" />
              The approach
            </p>
            <p className="amp-display mt-4 max-w-[18ch] text-[clamp(1.9rem,4.6vw,3.6rem)] leading-[1.02]">{SITE.address.line1}, on the Kumasi–Sunyani Road.</p>
          </div>

          <div
            data-overlay="interior"
            className="invisible absolute inset-x-0 bottom-0 mx-auto max-w-site px-gutter pb-[calc(env(safe-area-inset-bottom)+7rem)] motion-reduce:!hidden lg:pb-24"
          >
            <p className="amp-eyebrow text-amp-gold-soft">The AMP Lodge experience</p>
            <h2 className="amp-display mt-4 max-w-[13ch] text-[clamp(2.4rem,6.6vw,6rem)] leading-[0.98]">Comfort begins the moment you arrive.</h2>
          </div>

          <div
            data-overlay="rooms"
            className="pointer-events-none absolute inset-0 flex opacity-0 flex-col items-center justify-center px-gutter text-center motion-reduce:!hidden"
          >
            <p className="amp-eyebrow text-amp-gold-soft">The rooms</p>
            <h2 className="amp-display mt-5 max-w-[12ch] text-[clamp(2.6rem,8vw,7.25rem)] leading-[0.95]">Three Ways to Feel at Home.</h2>
            <p className="amp-lede mt-6 text-amp-ivory/85">Discover your perfect space.</p>
          </div>

          {FILM_ROOMS.map((f, i) => (
            <RoomOverlay
              key={f.slug}
              id={f.clip}
              index={i}
              room={room(f.slug)}
              tagline={f.tagline}
              loading={status === 'loading'}
              beside={f.clip === 'family'}
            />
          ))}

          <div
            data-overlay="handoff"
            className="invisible absolute inset-x-0 bottom-0 mx-auto max-w-site px-gutter pb-[calc(env(safe-area-inset-bottom)+7rem)] motion-reduce:!hidden max-sm:pr-16 lg:inset-y-0 lg:flex lg:flex-col lg:justify-center lg:pb-0"
          >
            <div className="lg:max-w-[36%]">
              <p className="amp-eyebrow text-amp-gold-soft">Choose your stay</p>
              <p className="amp-display mt-4 text-[clamp(2.2rem,5vw,4.5rem)] leading-[0.98]">
                {roomCount ? `${roomCount} rooms. One warm welcome.` : 'One warm welcome.'}
              </p>
              <p className="mt-4 text-sm text-amp-ivory/75">
                {minRate ? `From ${formatRate(minRate)} a night, booked directly with us.` : 'Booked directly with us.'}
              </p>
            </div>
          </div>

          {/* Progress rail: where you are in the film, and a way out of it. */}
          <div
            data-film-rail
            className="absolute right-gutter top-[calc(var(--amp-header-h)+env(safe-area-inset-top)+0.75rem)] flex flex-col items-end gap-2 text-right motion-reduce:!hidden lg:bottom-28 lg:top-auto"
          >
            <p className="amp-chapter-no text-[0.6875rem] text-amp-ivory/70" aria-hidden="true">
              <span className="text-amp-gold-soft">{String(scene + 1).padStart(2, '0')}</span> / {String(SCENES.length).padStart(2, '0')}
              <span className="ml-2 hidden sm:inline">{SCENES[scene]}</span>
            </p>
            <div className="flex gap-1" aria-hidden="true">
              {SCENES.map((s, i) => (
                <span key={s} className={cn('h-px w-4 transition-colors duration-500 sm:w-6', i <= scene ? 'bg-amp-gold' : 'bg-amp-ivory/25')} />
              ))}
            </div>
            <button
              type="button"
              onClick={skipToRooms}
              className="amp-eyebrow amp-link mt-1 inline-flex min-h-11 items-center !text-[0.625rem] text-amp-ivory/80"
            >
              Skip to rooms &amp; rates
            </button>
            <p className="hidden max-w-[16rem] text-[0.625rem] leading-snug text-amp-ivory/50 lg:block">Film animated from photographs of the lodge.</p>
          </div>
        </div>
      </div>

      <StaticStory rooms={rooms} loading={status === 'loading'} />
    </section>
  )
}

function RoomFacts({ room, loading }: { room: LiveRoom | undefined; loading: boolean }) {
  const rate = formatRate(room?.price ?? null)
  return (
    <p className="mt-4 flex flex-wrap items-baseline gap-x-5 gap-y-1 text-sm text-amp-ivory/80">
      {room?.maxGuests ? <span>Up to {room.maxGuests} guests</span> : null}
      {rate ? (
        <span>
          <span className="amp-display text-2xl text-amp-ivory">{rate}</span> per night
        </span>
      ) : loading ? (
        <span className="inline-block h-5 w-28 animate-pulse bg-amp-ivory/15" aria-label="Loading rate" />
      ) : (
        <span>Rates on the booking page</span>
      )}
    </p>
  )
}

function RoomActions({ room, slug, name }: { room: LiveRoom | undefined; slug: string; name: string }) {
  const bookable = room ? room.bookable : slug !== 'executive-suite'
  return (
    <div className="mt-6 flex flex-col items-start gap-x-6 gap-y-2 sm:flex-row sm:flex-wrap sm:items-center">
      {bookable ? (
        <Link to={bookingHref(room)} className="amp-btn amp-btn--gold whitespace-nowrap" aria-label={`Book the ${name}`}>
          Book This Room{' '}
          <span className="amp-arrow" aria-hidden="true">
            →
          </span>
        </Link>
      ) : (
        <Link to={`/contact?room=${slug}`} className="amp-btn amp-btn--gold whitespace-nowrap">
          Enquire about this suite{' '}
          <span className="amp-arrow" aria-hidden="true">
            →
          </span>
        </Link>
      )}
      <Link to={`/rooms/${slug}`} className="amp-eyebrow amp-link inline-flex min-h-11 items-center text-amp-ivory" aria-label={`View details of the ${name}`}>
        View details
      </Link>
    </div>
  )
}

function RoomOverlay({
  id,
  index,
  room,
  tagline,
  loading,
  beside,
}: {
  id: ClipId
  index: number
  room: LiveRoom | undefined
  tagline: string
  loading: boolean
  beside: boolean
}) {
  const slug = FILM_ROOMS[index].slug
  const name = room?.name ?? SCENES[5 + index]
  return (
    <div
      data-overlay={id}
      className={cn(
        'invisible absolute inset-x-0 bottom-0 mx-auto max-w-site px-gutter pb-[calc(env(safe-area-inset-bottom)+6.5rem)] motion-reduce:!hidden max-sm:pr-16 lg:pb-24',
        beside && 'lg:inset-y-0 lg:flex lg:flex-col lg:justify-center lg:pb-0',
      )}
    >
      <div className={cn('max-w-[34rem]', beside && 'lg:max-w-[40%]')}>
        <p className="amp-eyebrow flex items-center gap-3 text-amp-gold-soft">
          <span className="amp-chapter-no text-amp-ivory/70">{String(index + 1).padStart(2, '0')}</span>
          <span aria-hidden="true" className="h-px w-8 bg-amp-gold/70" />
          The rooms
        </p>
        <h3 className="amp-display mt-4 text-[clamp(2.6rem,7vw,6.25rem)] leading-[0.95]">{name}</h3>
        <p className="amp-lede mt-3 text-amp-ivory/85">{tagline}</p>
        <RoomFacts room={room} loading={loading} />
        <RoomActions room={room} slug={slug} name={name} />
      </div>
    </div>
  )
}

/** Reduced motion: the same story as a quiet sequence of captioned photographs. */
function StaticStory({ rooms, loading }: { rooms: LiveRoom[]; loading: boolean }) {
  return (
    <div className="hidden py-24 motion-reduce:block">
      <div className="mx-auto max-w-site space-y-24 px-gutter">
        <figure>
          <Picture photo={CLIPS.approach.still!} sizes="(min-width: 64rem) 80vw, 100vw" className="aspect-[16/10] overflow-hidden" />
          <figcaption className="mt-4 max-w-[36rem]">
            <span className="amp-eyebrow text-amp-gold-soft">The approach</span>
            <span className="amp-display mt-2 block text-3xl">{SITE.address.line1}, on the Kumasi–Sunyani Road.</span>
          </figcaption>
        </figure>
        <div className="grid gap-10 lg:grid-cols-12 lg:items-end">
          <Picture photo={CLIPS.corridor.still!} sizes="(min-width: 64rem) 55vw, 100vw" className="aspect-[4/3] overflow-hidden lg:col-span-7" />
          <div className="lg:col-span-5">
            <p className="amp-eyebrow text-amp-gold-soft">The AMP Lodge experience</p>
            <h2 className="amp-display mt-4 text-[clamp(2.2rem,5vw,4rem)] leading-[1]">Comfort begins the moment you arrive.</h2>
          </div>
        </div>
        <div>
          <p className="amp-eyebrow text-amp-gold-soft">The rooms</p>
          <h2 className="amp-display mt-4 text-[clamp(2.4rem,6vw,5rem)] leading-[0.98]">Three Ways to Feel at Home.</h2>
          <p className="amp-lede mt-4 text-amp-ivory/85">Discover your perfect space.</p>
          <ol className="mt-14 grid gap-16 lg:grid-cols-3 lg:gap-10">
            {FILM_ROOMS.map((f, i) => {
              const room = rooms.find((r) => r.slug === f.slug)
              const name = room?.name ?? SCENES[5 + i]
              const photo = CLIPS[f.clip].still!
              return (
                <li key={f.slug}>
                  <Picture photo={photo} sizes="(min-width: 64rem) 30vw, 100vw" className="aspect-[4/5] overflow-hidden" />
                  <p className="amp-chapter-no mt-5 text-amp-gold">{String(i + 1).padStart(2, '0')} / The rooms</p>
                  <h3 className="amp-display mt-2 text-4xl">{name}</h3>
                  <p className="mt-2 text-amp-ivory/80">{f.tagline}</p>
                  <RoomFacts room={room} loading={loading} />
                  <RoomActions room={room} slug={f.slug} name={name} />
                </li>
              )
            })}
          </ol>
        </div>
      </div>
    </div>
  )
}
