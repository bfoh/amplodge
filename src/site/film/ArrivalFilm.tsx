import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { cn } from '@/lib/utils'
import { Picture } from '../components/Picture'
import { HERO_MEDIA, PHOTOS, type Photo } from '../data/photos'
import { useRooms } from '../data/rooms'
import { SITE } from '../data/site'
import { gsap, useGSAP } from '../lib/gsap'
import { onIntro } from '../motion/intro-state'
import { markPageReady } from '../motion/page-ready'
import { DESKTOP, isLiteDevice, prefersReducedMotion } from '../motion/prefs'
import { Reveal } from '../motion/Reveal'
import { scrollToTarget } from '../motion/scroll-control'
import { SplitHeading } from '../motion/SplitHeading'
import { ROOMS_ANCHOR, roomAnchor } from './anchors'
import { ARRIVAL, ARRIVAL_SCENES, FACADE_DETAIL, FILM_BASE, frameSet, type ArrivalClipId } from './film-data'
import { FrameSequence } from './FrameSequence'

const PHONE = '(max-width: 47.99rem)'
const CLIP_ORDER: ArrivalClipId[] = ['elevated', 'gate', 'forecourt', 'corridor']


/**
 * Where each scene starts on the master timeline ("beats") and the clip it
 * needs, for the progress rail and for loading clips just ahead of the
 * visitor. Desktop has one more scene (the façade in detail). These follow
 * the beats laid out in the timeline below.
 */
const TIMING = {
  desktop: {
    at: [0, 1.15, 1.95, 2.95, 4.3, 5.8, 6.4, 7.65],
    clip: ['elevated', 'elevated', 'gate', 'gate', 'forecourt', 'corridor', 'corridor', 'corridor'] as ArrivalClipId[],
  },
  compact: {
    at: [0, 1.15, 1.95, 3.3, 4.8, 5.4, 6.65],
    clip: ['elevated', 'elevated', 'gate', 'forecourt', 'corridor', 'corridor', 'corridor'] as ArrivalClipId[],
  },
}

/**
 * Chapters 01–07: the arrival, as one scroll-driven film.
 *
 * A tall track holds a sticky stage; one scrubbed GSAP timeline drives the
 * frame sequences, camera moves, masks and copy from the scroll position, and
 * scrolling back plays it backwards. Nothing is pinned by JavaScript and
 * nothing snaps, so touch scrolling stays native.
 *
 * 01 Arrival: from first-floor height, the camera descends to the road.
 * 02 The façade: eye level, the stone-clad lodge.
 * 03 In detail (desktop): the camera travels across the stone and lettering,
 *    then down the pillars and ironwork, on the full-resolution still.
 * 04 The approach: toward the gate.
 * 05 Through the gate: it slides open on the forecourt.
 * 06 The threshold: a door-shaped aperture opens from the glass doors onto
 *    the corridor, and the light warms. An editorial cut: no photograph shows
 *    the way from the doors to this corridor, so none is invented.
 * 07 Inside ("Comfort Begins Here."), then the accommodation introduction,
 *    which hands over to the room journey (RoomJourney.tsx).
 *
 * Phones get their own, shorter timeline (no detail chapter, portrait frames).
 * Lite devices get the same film with real photographs and page-made camera
 * moves; reduced motion gets a static, captioned sequence.
 */
export function ArrivalFilm() {
  const root = useRef<HTMLElement>(null)
  const poster = useRef<HTMLImageElement>(null)
  const canvases = useRef<Partial<Record<ArrivalClipId, HTMLCanvasElement | null>>>({})
  const seqs = useRef<Partial<Record<ArrivalClipId, FrameSequence>>>({})
  const timing = useRef(TIMING.desktop)
  const sceneRef = useRef(0)
  const loadTimer = useRef(0)
  const [scene, setScene] = useState(0)
  const [desktop, setDesktop] = useState(false)
  const [stills, setStills] = useState(false)
  const { rooms } = useRooms()

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

  // The static poster painted from index.html (intro-document.ts) hands over to
  // this one once it is decoded: the same file, already in memory.
  useEffect(() => {
    const shell = document.getElementById('amp-poster')
    if (!shell) return
    const el = poster.current
    const handOver = () => {
      requestAnimationFrame(() => shell.remove())
    }
    if (!el) {
      handOver()
      return
    }
    const loaded: Promise<unknown> = el.complete
      ? el.decode().catch(() => undefined)
      : new Promise((resolve) => {
          el.addEventListener('load', resolve, { once: true })
          el.addEventListener('error', resolve, { once: true })
        })
    loaded.then(handOver)
  }, [])

  // Frame sequences and stills: nothing beyond the poster loads until the intro
  // has released, the page has loaded and the browser is idle, or the visitor
  // starts scrolling.
  useEffect(() => {
    if (prefersReducedMotion()) return
    const lite = isLiteDevice()
    const phone = window.matchMedia(PHONE).matches
    setDesktop(window.matchMedia(DESKTOP).matches)
    const created: FrameSequence[] = []
    if (!lite) {
      for (const id of CLIP_ORDER) {
        const canvas = canvases.current[id]
        const set = frameSet(id, phone)
        if (!canvas || !set) continue
        const clip = ARRIVAL[id]
        const seq = new FrameSequence(canvas, `${FILM_BASE}/${id}`, set, phone ? 'm' : 'd', phone ? 0.5 : clip.focusX, phone ? 0.5 : clip.focusY)
        seq.onReady = () => {
          canvas.dataset.ready = ''
        }
        seqs.current[id] = seq
        created.push(seq)
      }
    }

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
      seqs.current.elevated?.load()
      seqs.current.gate?.load(2)
    }
    const whenSettled = () => {
      const ric = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback
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
  // the visitor has settled on a scene for a moment.
  const onTime = (t: number) => {
    const { at, clip } = timing.current
    let s = 0
    for (let i = 0; i < at.length; i++) if (t >= at[i] - 0.001) s = i
    if (s === sceneRef.current) return
    sceneRef.current = s
    setScene(s)
    clearTimeout(loadTimer.current)
    loadTimer.current = window.setTimeout(() => {
      seqs.current[clip[s]]?.load()
      const next = clip[Math.min(clip.length - 1, s + 1)]
      const after = clip[Math.min(clip.length - 1, s + 2)]
      seqs.current[next]?.load(2)
      if (after !== next) seqs.current[after]?.load(2)
    }, 160)
  }

  // Idle: the faintest push-in on the poster while the page is at rest.
  useGSAP(
    () => {
      if (prefersReducedMotion()) return
      const el = root.current?.querySelector('[data-layer="elevated"] [data-idle]')
      if (!el) return
      const tween = gsap.fromTo(el, { scale: 1 }, { scale: 1.03, duration: 4.8, ease: 'power1.out', paused: true })
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
          const phone = window.matchMedia(PHONE).matches
          timing.current = desktop ? TIMING.desktop : TIMING.compact
          const q = gsap.utils.selector(root)
          const layer = (id: string) => q(`[data-layer="${id}"]`)[0] as HTMLElement
          const cam = (id: string) => q(`[data-layer="${id}"] [data-cam]`)[0] as HTMLElement
          const overlay = (id: string) => q(`[data-overlay="${id}"]`)[0] as HTMLElement

          // clip-path tweens always state both ends: a browser's computed inset() drops
          // repeated sides (inset(24% 46.5% 12%)), which would pair the wrong numbers.
          const FULL = 'inset(0% 0% 0% 0% round 0px)'
          const FROM_RIGHT = 'inset(0% 0% 0% 100% round 0px)'
          // The forecourt's glass doors where its clip ends, in stage coordinates
          // (measured on the last frame, as each screen shape crops it).
          const DOORS = desktop ? 'inset(51.5% 38.2% 29.7% 52.7% round 2px)' : phone ? 'inset(56.5% 31% 27.9% 39.4% round 2px)' : 'inset(52% 37% 28% 53% round 2px)'
          const DOORS_ORIGIN = desktop ? '57.2% 60.6%' : phone ? '54.2% 64.3%' : '57.5% 62%'

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
          const clip = (el: HTMLElement, from: string, to: string, at: number, duration: number, ease = 'power3.inOut') =>
            tl.fromTo(el, { clipPath: from }, { clipPath: to, duration, ease, immediateRender: false }, at)
          const scrub = (id: ArrivalClipId, at: number, duration: number) => {
            const proxy = { p: 0 }
            tl.fromTo(proxy, { p: 0 }, { p: 1, duration, onUpdate: () => seqs.current[id]?.setProgress(proxy.p) }, at)
          }
          // Captions leave the accessibility tree when off screen (visibility), except
          // headings with nothing to click (`keep`), which only fade, so the heading
          // outline (h1 → h2) stays whole at every point of the film.
          const show = (id: string, from: number, to?: number, keep = false) => {
            const el = overlay(id)
            if (!el) return
            const prop = keep ? 'opacity' : 'autoAlpha'
            tl.fromTo(el, { [prop]: 0, y: 28 }, { [prop]: 1, y: 0, duration: 0.22, ease: 'power2.out' }, from)
            if (to !== undefined) tl.to(el, { [prop]: 0, y: -24, duration: 0.18, ease: 'power2.in' }, to - 0.18)
          }
          /** A full-width carrier whose left edge travels across the stage (transform only). */
          const sweep = (sel: string, from: number, to: number, at: number, duration: number, ease: string) => {
            tl.fromTo(q(sel), { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.03 }, at)
            tl.fromTo(q(sel), { xPercent: from }, { xPercent: to, duration, ease }, at)
            tl.to(q(sel), { autoAlpha: 0, duration: 0.03 }, at + duration - 0.03)
          }

          // Starting states (reverted by mm when the media query stops matching).
          gsap.set([layer('detail'), layer('gate'), layer('forecourt'), layer('corridor')], { autoAlpha: 0 })
          gsap.set(layer('corridor'), { clipPath: DOORS })
          if (desktop) gsap.set(layer('gate'), { clipPath: FROM_RIGHT })

          // 01 Arrival: the crane descends from first-floor height to the road; the copy recedes.
          scrub('elevated', 0, 1.3)
          tl.fromTo(q('[data-elevated-frames]'), { opacity: 0 }, { opacity: 1, duration: 0.06 }, 0.01)
          tl.fromTo(cam('elevated'), { scale: 1.02 }, { scale: 1, duration: 1.3, ease: 'power1.out' }, 0)
          // Opacity only on the copy, so the page's h1 stays in the accessibility tree
          // for the whole film; the buttons leave the tab order once they have faded.
          tl.to(overlay('hero'), { opacity: 0, yPercent: -8, duration: 0.42 }, 0.22)
          tl.to(q('[data-hero-scrim]'), { opacity: 0, duration: 0.42 }, 0.22)
          tl.set(q('[data-hero-actions]'), { visibility: 'hidden' }, 0.64)
          tl.fromTo(q('[data-film-rail]'), { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.2 }, 0.5)

          // 02 The façade: the camera has landed at eye level.
          show('facade', 1.15, 1.95)

          let t = 1.95
          if (desktop) {
            // 03 In detail: the full-resolution still takes over from the last frame (the
            // same picture), then the camera travels from the stone and lettering down
            // across the pillars and the ironwork toward the gate.
            tl.set(layer('detail'), { autoAlpha: 1 }, 1.32)
            const d = cam('detail')
            tl.fromTo(d, { scale: 1, xPercent: 0, yPercent: 0 }, { scale: 1.6, xPercent: -10.8, yPercent: -7.6, duration: 0.5, ease: 'power2.inOut' }, 1.95)
            tl.to(d, { xPercent: -48, yPercent: -46, duration: 0.55, ease: 'power2.inOut' }, 2.45)
            show('detail', 2.05, 2.92)
            // 04 The approach: the road shot wipes in from the right, led by a gold hairline.
            t = 2.95
            tl.set(layer('gate'), { autoAlpha: 1 }, t - 0.05)
            clip(layer('gate'), FROM_RIGHT, FULL, t, 0.5)
            tl.to(d, { xPercent: -56, duration: 0.5, ease: 'power2.in' }, t)
            sweep('[data-door-edge]', 100, 0, t, 0.5, 'power3.inOut')
            tl.set([layer('elevated'), layer('detail')], { autoAlpha: 0 }, t + 0.55)
          } else {
            // The crane ends on the road shot's first frame, but the phone crops frame the
            // two differently (the road shot looks toward the gate), so the road shot
            // wipes in from the right, led by the gold hairline, rather than jumping.
            tl.set(layer('gate'), { autoAlpha: 1, clipPath: FROM_RIGHT }, 1.18)
            clip(layer('gate'), FROM_RIGHT, FULL, 1.2, 0.45)
            sweep('[data-door-edge]', 100, 0, 1.2, 0.45, 'power3.inOut')
            tl.set(layer('elevated'), { autoAlpha: 0 }, 1.68)
          }

          // The approach: toward the gate.
          scrub('gate', t + 0.05, 1.3)
          tl.fromTo(cam('gate'), { scale: 1 }, { scale: 1.06, duration: 1.3, ease: 'power1.in' }, t + 0.05)
          show('approach', t + 0.3, t + 1.2)

          // Through the gate: it slides open to the right, revealing the forecourt.
          const g = t + 1.35
          tl.set(layer('forecourt'), { autoAlpha: 1 }, g - 0.02)
          clip(layer('gate'), FULL, FROM_RIGHT, g, 0.6, 'power2.inOut')
          tl.to(cam('gate'), { xPercent: 10, duration: 0.6, ease: 'power2.inOut' }, g)
          sweep('[data-gate-leaf]', 0, 100, g, 0.6, 'power2.inOut')
          tl.fromTo(cam('forecourt'), { scale: 1.12 }, { scale: 1, duration: 0.8, ease: 'power2.out' }, g)
          tl.set(layer('gate'), { autoAlpha: 0 }, g + 0.62)

          // The forecourt: a slow dolly toward the glass doors.
          scrub('forecourt', g + 0.15, 1.3)
          show('forecourt', g + 0.4, g + 1.42)

          // The threshold: the camera leans into the doors and the corridor opens through them.
          const th = g + 1.5
          tl.set(cam('forecourt'), { transformOrigin: DOORS_ORIGIN }, th - 0.01)
          tl.fromTo(cam('forecourt'), { scale: 1 }, { scale: 2.4, duration: 0.7, ease: 'power2.in', immediateRender: false }, th)
          tl.set(layer('corridor'), { autoAlpha: 1 }, th + 0.1)
          clip(layer('corridor'), DOORS, FULL, th + 0.12, 0.62, 'power2.inOut')
          tl.fromTo(cam('corridor'), { scale: 1.3 }, { scale: 1, duration: 0.8, ease: 'power2.out' }, th + 0.12)
          tl.fromTo(q('[data-warm]'), { opacity: 0.55 }, { opacity: 0, duration: 0.8 }, th + 0.2)
          tl.set(layer('forecourt'), { autoAlpha: 0 }, th + 0.78)

          // Inside: the corridor dolly. "Comfort Begins Here."
          const ins = th + 0.6
          scrub('corridor', ins - 0.1, 1.45)
          show('interior', ins + 0.3, ins + 1.15)

          // The accommodation introduction: the corridor dims under the title.
          const acc = ins + 1.25
          tl.fromTo(q('[data-layer="corridor"] [data-shade]'), { opacity: 0 }, { opacity: 0.74, duration: 0.3 }, acc - 0.05)
          show('rooms', acc + 0.15)
          tl.to(q('[data-film-rail]'), { autoAlpha: 0, duration: 0.15 }, acc + 0.6)
          tl.to({}, { duration: 0.35 }, acc + 0.75)
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
  const jumpToRoom = (slug: string) => {
    const target = document.getElementById(roomAnchor(slug)) ?? document.getElementById(ROOMS_ANCHOR)
    if (target) scrollToTarget(target)
  }

  const stillOf = (photo: Photo | null, focus: string) =>
    photo && stills ? (
      <Picture photo={photo} sizes="100vw" alt="" className="absolute inset-0 h-full w-full" imgClassName="object-cover" style={{ objectPosition: focus }} />
    ) : null

  const canvasFor = (id: ArrivalClipId) => (
    <canvas
      ref={(el) => {
        canvases.current[id] = el
      }}
      aria-hidden="true"
      className="amp-film-canvas absolute inset-0 h-full w-full"
    />
  )

  const scenes = desktop ? ARRIVAL_SCENES.desktop : ARRIVAL_SCENES.compact
  const current = Math.min(scene, scenes.length - 1)
  const caption = 'invisible absolute inset-x-0 bottom-0 mx-auto max-w-site px-gutter pb-[calc(env(safe-area-inset-bottom)+7rem)] motion-reduce:!hidden lg:pb-24'

  return (
    <section ref={root} className="amp-on-dark relative bg-amp-obsidian text-amp-ivory" aria-labelledby="hero-title" data-theme="dark" data-header-dark>
      <div data-film-track className="relative motion-safe:h-[600svh] motion-safe:lg:h-[920svh]">
        <div data-film-stage className="sticky top-0 h-[100svh] min-h-[34rem] overflow-hidden motion-reduce:relative">
          {/* ── Layers, bottom to top ─────────────────────────────────────── */}
          <div data-layer="elevated" className="absolute inset-0 overflow-hidden">
            <div data-cam className="absolute inset-0 will-change-transform">
              <div data-idle className="absolute inset-0">
                <picture className="block h-full w-full">
                  <source type="image/webp" media={PHONE} srcSet={`${HERO_MEDIA.portrait}.webp`} />
                  <source type="image/webp" srcSet={HERO_MEDIA.widths.map((w) => `${HERO_MEDIA.base}-${w}.webp ${w}w`).join(', ')} sizes="100vw" />
                  <img
                    ref={poster}
                    src={`${HERO_MEDIA.base}-1920.jpg`}
                    alt={HERO_MEDIA.alt}
                    width={HERO_MEDIA.width}
                    height={HERO_MEDIA.height}
                    fetchPriority="high"
                    decoding="async"
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                </picture>
                {/* Hidden at rest so the clean poster shows; fades in once scrolling starts. */}
                <div data-elevated-frames className="absolute inset-0">
                  {canvasFor('elevated')}
                </div>
              </div>
            </div>
          </div>

          {/* Desktop only: the eye-level frame at full resolution, for the detail chapter. */}
          <div data-layer="detail" className="absolute inset-0 hidden overflow-hidden motion-reduce:!hidden lg:block">
            <div data-cam className="absolute inset-0 origin-top-left will-change-transform">
              {stills && desktop ? (
                <img src={FACADE_DETAIL.src} alt="" width={FACADE_DETAIL.width} height={FACADE_DETAIL.height} decoding="async" className="absolute inset-0 h-full w-full object-cover" />
              ) : null}
            </div>
          </div>

          <div data-layer="gate" className="absolute inset-0 overflow-hidden motion-reduce:!hidden">
            <div data-cam className="absolute inset-0 will-change-transform" style={{ transformOrigin: '70% 60%' }}>
              {stillOf(ARRIVAL.gate.still, '60% 55%')}
              {canvasFor('gate')}
            </div>
          </div>

          <div data-layer="forecourt" className="absolute inset-0 overflow-hidden motion-reduce:!hidden">
            <div data-cam className="absolute inset-0 will-change-transform">
              {stillOf(ARRIVAL.forecourt.still, '55% 55%')}
              {canvasFor('forecourt')}
            </div>
          </div>

          <div data-layer="corridor" className="absolute inset-0 overflow-hidden motion-reduce:!hidden">
            <div data-cam className="absolute inset-0 will-change-transform">
              {stillOf(ARRIVAL.corridor.still, '50% 50%')}
              {canvasFor('corridor')}
            </div>
            <div data-warm className="pointer-events-none absolute inset-0 bg-[#f3c98b] opacity-0 mix-blend-soft-light" />
            <div data-shade className="pointer-events-none absolute inset-0 bg-amp-obsidian opacity-0" />
          </div>

          {/* The gate leaf: a band of iron bars, led by a gold edge, that slides away as the gate opens. */}
          <div data-gate-leaf aria-hidden="true" className="pointer-events-none invisible absolute inset-0 motion-reduce:!hidden">
            <div className="absolute inset-y-0 left-0 w-[18vw] bg-[repeating-linear-gradient(90deg,rgba(18,19,18,0.9)_0_5px,rgba(18,19,18,0)_5px_36px)]">
              <span className="absolute inset-y-0 left-0 w-px bg-amp-gold/80" />
            </div>
          </div>
          {/* The door edge: a gold hairline leading the wipe onto the road. */}
          <div data-door-edge aria-hidden="true" className="pointer-events-none invisible absolute inset-0 motion-reduce:!hidden">
            <span className="absolute inset-y-0 left-0 w-px bg-amp-gold/80" />
          </div>

          {/* Legibility. */}
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_top,rgba(10,10,9,0.9)_0%,rgba(10,10,9,0.58)_40%,rgba(10,10,9,0.06)_72%),linear-gradient(to_bottom,rgba(10,10,9,0.5),rgba(10,10,9,0)_22%)] md:bg-[linear-gradient(to_top,rgba(10,10,9,0.86)_0%,rgba(10,10,9,0.42)_36%,rgba(10,10,9,0.04)_66%),linear-gradient(to_bottom,rgba(10,10,9,0.5),rgba(10,10,9,0)_22%)]" />
          {/* The hero's own shade, behind its copy (the stone wall and the sign are busy); it leaves with the copy. */}
          <div
            data-hero-scrim
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_75%_at_8%_80%,rgba(10,10,9,0.66)_0%,rgba(10,10,9,0.34)_50%,rgba(10,10,9,0)_80%)] md:bg-[radial-gradient(ellipse_60%_80%_at_10%_78%,rgba(10,10,9,0.62)_0%,rgba(10,10,9,0.3)_52%,rgba(10,10,9,0)_82%)]"
          />

          <p className="sr-only">
            A short film follows as you scroll: the lodge from above the road, then at eye level; the approach to the gate, which opens on the
            forecourt; the glass doors; and the corridor to the rooms. It is animated from photographs of the lodge.
          </p>

          {/* ── Copy ─────────────────────────────────────────────────────── */}
          <div
            data-overlay="hero"
            className="pointer-events-none absolute inset-0 mx-auto flex max-w-site flex-col justify-end px-gutter pb-[max(2.5rem,calc(env(safe-area-inset-bottom)+1.5rem))] pt-[calc(var(--amp-header-h)+1rem)] lg:pb-20"
          >
            <Reveal play="intro" delay={0.05} y={16}>
              <p className="amp-eyebrow flex items-center gap-3 text-amp-gold-soft [text-shadow:0_1px_10px_rgba(10,10,9,0.7)]">
                <span className="amp-chapter-no text-amp-ivory/80">01</span>
                <span aria-hidden="true" className="h-px w-8 bg-amp-gold/70" />
                Your comfort. Our priority.
              </p>
            </Reveal>
            <SplitHeading as="h1" id="hero-title" play="intro" delay={0.1} className="amp-display mt-5 text-[clamp(2.75rem,10.5vw,8.25rem)] !leading-[0.94]">
              <span className="block">Arrive. Unwind.</span>
              <span className="block text-amp-gold-soft">Feel at Home.</span>
            </SplitHeading>
            <div className="mt-6 grid gap-8 lg:mt-10 xl:grid-cols-[minmax(0,34rem)_1fr] xl:items-end">
              <Reveal play="intro" delay={0.45}>
                <p className="amp-lede max-w-[34rem] text-amp-ivory/90 [text-shadow:0_1px_14px_rgba(10,10,9,0.6)]">Your welcoming retreat in Kumasi, where thoughtful comfort meets genuine hospitality.</p>
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

          <div data-overlay="facade" className={caption}>
            <p className="amp-eyebrow flex items-center gap-3 text-amp-gold-soft">
              <span className="amp-chapter-no text-amp-ivory/70">02</span>
              <span aria-hidden="true" className="h-px w-8 bg-amp-gold/70" />
              The façade
            </p>
            <p className="amp-display mt-4 max-w-[16ch] text-[clamp(1.9rem,4.6vw,3.6rem)] leading-[1.02]">A stone-clad lodge on the {SITE.address.line2}.</p>
          </div>

          <div data-overlay="detail" className={cn(caption, 'hidden lg:block')}>
            <p className="amp-eyebrow flex items-center gap-3 text-amp-gold-soft">
              <span className="amp-chapter-no text-amp-ivory/70">03</span>
              <span aria-hidden="true" className="h-px w-8 bg-amp-gold/70" />
              In detail
            </p>
            <p className="amp-display mt-4 max-w-[17ch] text-[clamp(1.9rem,4.6vw,3.6rem)] leading-[1.02]">Stone walls, cream pillars and black ironwork.</p>
          </div>

          <div data-overlay="approach" className={caption}>
            <p className="amp-eyebrow flex items-center gap-3 text-amp-gold-soft">
              <span className="amp-chapter-no text-amp-ivory/70">{desktop ? '04' : '03'}</span>
              <span aria-hidden="true" className="h-px w-8 bg-amp-gold/70" />
              The approach
            </p>
            <p className="amp-display mt-4 max-w-[18ch] text-[clamp(1.9rem,4.6vw,3.6rem)] leading-[1.02]">{SITE.address.line1}. The gate is just ahead.</p>
          </div>

          <div data-overlay="forecourt" className={caption}>
            <p className="amp-eyebrow flex items-center gap-3 text-amp-gold-soft">
              <span className="amp-chapter-no text-amp-ivory/70">{desktop ? '05' : '04'}</span>
              <span aria-hidden="true" className="h-px w-8 bg-amp-gold/70" />
              Through the gate
            </p>
            <p className="amp-display mt-4 max-w-[16ch] text-[clamp(1.9rem,4.6vw,3.6rem)] leading-[1.02]">Across the forecourt to the glass doors.</p>
          </div>

          <div data-overlay="interior" className={caption}>
            <p className="amp-eyebrow text-amp-gold-soft">The AMP Lodge experience</p>
            <h2 className="amp-display mt-4 max-w-[13ch] text-[clamp(2.6rem,7vw,6.25rem)] leading-[0.96]">Comfort Begins Here.</h2>
          </div>

          <div data-overlay="rooms" className="pointer-events-none invisible absolute inset-0 flex flex-col items-center justify-center px-gutter text-center motion-reduce:!hidden">
            <p className="amp-eyebrow text-amp-gold-soft">Accommodation</p>
            <h2 className="amp-display mt-5 max-w-[12ch] text-[clamp(2.6rem,8vw,7.25rem)] leading-[0.95]">Find Your Place to Unwind.</h2>
            <p className="amp-lede mt-6 max-w-[30rem] text-amp-ivory/85">Explore our rooms and discover the comfort that feels right for you.</p>
            {rooms.length > 0 && (
              <nav aria-label="Jump to a room" className="pointer-events-auto mt-8 flex max-w-full flex-wrap justify-center gap-1 sm:mt-10">
                {rooms.map((r) => (
                  <a
                    key={r.slug}
                    href={`#${roomAnchor(r.slug)}`}
                    onClick={(e) => {
                      e.preventDefault()
                      jumpToRoom(r.slug)
                    }}
                    className="amp-eyebrow amp-link inline-flex min-h-11 items-center px-3 !text-[0.6875rem] text-amp-ivory/85"
                  >
                    {r.name}
                  </a>
                ))}
              </nav>
            )}
          </div>

          {/* Progress rail: where you are in the film, and a way out of it. */}
          <div
            data-film-rail
            className="absolute right-gutter top-[calc(var(--amp-header-h)+env(safe-area-inset-top)+0.75rem)] flex flex-col items-end gap-2 text-right motion-reduce:!hidden lg:bottom-24 lg:top-auto"
          >
            <p className="amp-chapter-no text-[0.6875rem] text-amp-ivory/70" aria-hidden="true">
              <span className="text-amp-gold-soft">{String(current + 1).padStart(2, '0')}</span> / {String(scenes.length).padStart(2, '0')}
              <span className="ml-2 hidden sm:inline">{scenes[current]}</span>
            </p>
            <div className="flex gap-1" aria-hidden="true">
              {scenes.map((s, i) => (
                <span key={s} className={cn('h-px w-4 transition-colors duration-500 sm:w-6', i <= current ? 'bg-amp-gold' : 'bg-amp-ivory/25')} />
              ))}
            </div>
            <button type="button" onClick={skipToRooms} className="amp-eyebrow amp-link mt-1 inline-flex min-h-11 items-center !text-[0.625rem] text-amp-ivory/80">
              Skip to the rooms
            </button>
            <p className="hidden max-w-[16rem] text-[0.625rem] leading-snug text-amp-ivory/50 lg:block">Film animated from photographs of the lodge.</p>
          </div>
        </div>
      </div>

      <StaticStory />
    </section>
  )
}

/** Reduced motion: the same story as a quiet sequence of captioned photographs. */
function StaticStory() {
  return (
    <div className="hidden py-24 motion-reduce:block">
      <div className="mx-auto max-w-site space-y-24 px-gutter">
        <figure>
          <Picture photo={PHOTOS.exteriorRoad} sizes="(min-width: 64rem) 80vw, 100vw" className="aspect-[4/3] overflow-hidden lg:aspect-[16/10]" />
          <figcaption className="mt-4 max-w-[36rem]">
            <span className="amp-eyebrow text-amp-gold-soft">The façade</span>
            <span className="amp-display mt-2 block text-3xl">
              A stone-clad lodge at {SITE.address.line1}, on the {SITE.address.line2}.
            </span>
          </figcaption>
        </figure>
        <figure className="grid gap-6 lg:grid-cols-12 lg:items-end">
          <Picture photo={PHOTOS.exteriorDay} sizes="(min-width: 64rem) 55vw, 100vw" className="aspect-[4/3] overflow-hidden lg:col-span-7" />
          <figcaption className="lg:col-span-5">
            <span className="amp-eyebrow text-amp-gold-soft">Through the gate</span>
            <span className="amp-display mt-2 block text-3xl">The forecourt and the glass doors.</span>
          </figcaption>
        </figure>
        <div className="grid gap-10 lg:grid-cols-12 lg:items-end">
          <Picture photo={PHOTOS.corridor} sizes="(min-width: 64rem) 55vw, 100vw" className="aspect-[4/3] overflow-hidden lg:col-span-7" />
          <div className="lg:col-span-5">
            <p className="amp-eyebrow text-amp-gold-soft">The AMP Lodge experience</p>
            <h2 className="amp-display mt-4 text-[clamp(2.2rem,5vw,4rem)] leading-[1]">Comfort Begins Here.</h2>
          </div>
        </div>
        <div className="text-center">
          <p className="amp-eyebrow text-amp-gold-soft">Accommodation</p>
          <h2 className="amp-display mx-auto mt-4 max-w-[14ch] text-[clamp(2.4rem,6vw,5rem)] leading-[0.98]">Find Your Place to Unwind.</h2>
          <p className="amp-lede mx-auto mt-4 max-w-[30rem] text-amp-ivory/85">Explore our rooms and discover the comfort that feels right for you.</p>
        </div>
      </div>
    </div>
  )
}
