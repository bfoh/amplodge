import { useEffect } from 'react'

import { ease, gsap } from '../lib/gsap'
import { releaseIntro } from '../motion/intro-state'
import { whenPageReady } from '../motion/page-ready'
import { INTRO_SESSION_KEY } from './intro-document'

/**
 * Takes over the brand intro that index.html started drawing on first paint
 * (see intro-document.ts) and hands the page over. A small state machine:
 *
 *   drawing ──(draw finished AND page ready, or cap)──▶ exiting ──▶ done
 *      │                                                   ▲
 *      └──────────(Skip / any key / Escape)──▶ skipping ───┘
 *
 * - drawing: CSS draws A, M, P, the dots and the LODGE bar. Nothing here fakes
 *   progress; the hold only lasts until the real hero poster has loaded.
 * - exiting: the curtain parts while the mark flies into the header logo's
 *   exact box (FLIP), and the hero copy starts rising (releaseIntro).
 * - skipping: a 0.3 s fade, then the same hand-over.
 * - done: html[data-intro-done] restores scrolling, shows the header logo and
 *   the voice widget, and the intro's nodes are removed.
 *
 * Plays once per tab session, only on the home page, on every screen size,
 * with motion allowed (decided by the head script before first paint).
 *
 * Length: the owner asked (2026-11-01) for the mark to stay a few seconds
 * longer, so the drawing and its hold run to 4.2 s (1.9 s on low-power
 * devices) and the curtain has opened by ≈5.2 s. Skip is always available.
 */
const DRAW_END_MS = 4200
const DRAW_END_LITE_MS = 1900
/** Never hold the visitor longer than this waiting for the poster. */
const HOLD_CAP_MS = 6500

/**
 * A finished `animation-fill-mode: forwards` outranks inline styles, so GSAP
 * could not fade these out. Pin each at its current opacity (and transform)
 * and drop the CSS animation first.
 */
function freeze(els: Iterable<HTMLElement>): HTMLElement[] {
  const list = Array.from(els)
  for (const el of list) {
    const { opacity, transform } = getComputedStyle(el)
    el.style.animation = 'none'
    el.style.opacity = opacity
    if (transform && transform !== 'none') el.style.transform = transform
  }
  return list
}

export function BrandIntro() {
  useEffect(() => {
    const html = document.documentElement
    const root = document.getElementById('amp-intro')
    if (!root || html.dataset.intro !== 'play' || 'introDone' in html.dataset) {
      releaseIntro()
      return
    }
    try {
      sessionStorage.setItem(INTRO_SESSION_KEY, '1')
    } catch {
      /* private mode: the intro may replay on reload, which is harmless */
    }

    type State = 'drawing' | 'exiting' | 'skipping' | 'done'
    let state: State = 'drawing'
    let pageReady = false
    let tl: gsap.core.Timeline | null = null
    const timers: number[] = []
    const lite = 'lite' in html.dataset
    const drawEnd = lite ? DRAW_END_LITE_MS : DRAW_END_MS

    const finish = () => {
      if (state === 'done') return
      state = 'done'
      releaseIntro()
      html.dataset.introDone = ''
      root.remove()
    }

    const exit = () => {
      if (state !== 'drawing') return
      state = 'exiting'
      const stage = root.querySelector<HTMLElement>('.amp-intro__stage')
      const target = document.querySelector<SVGElement>('[data-header-logo] svg')
      const curtains = root.querySelectorAll<HTMLElement>('.amp-intro__curtain')
      const [left, right] = Array.from(curtains)
      tl = gsap.timeline({ onComplete: finish })
      tl.to(freeze(root.querySelectorAll<HTMLElement>('.amp-intro__rule, .amp-intro__caption, .amp-intro__motto, .amp-intro__skip')), { opacity: 0, duration: 0.3, ease: ease.soft }, 0)
      tl.to(freeze(root.querySelectorAll<HTMLElement>('.amp-intro__atmos, .amp-intro__glow')), { opacity: 0, duration: 0.6, ease: ease.soft }, 0.05)
      if (left && right) {
        tl.to(left, { xPercent: -101, duration: 0.95, ease: ease.mask }, 0.1)
        tl.to(right, { xPercent: 101, duration: 0.95, ease: ease.mask }, 0.1)
      }
      tl.call(releaseIntro, undefined, 0.25)
      const to = target?.getBoundingClientRect()
      if (stage && to && to.width > 0) {
        const from = stage.getBoundingClientRect()
        tl.to(stage, { x: to.left - from.left, y: to.top - from.top, scale: to.width / from.width, duration: 0.95, ease: ease.mask }, 0.1)
      } else if (stage) {
        tl.to(stage, { opacity: 0, duration: 0.5, ease: ease.soft }, 0.1)
      }
    }

    const skip = () => {
      if (state === 'done' || state === 'skipping') return
      tl?.kill()
      state = 'skipping'
      releaseIntro()
      tl = gsap.timeline({ onComplete: finish }).to(root, { opacity: 0, duration: 0.3, ease: ease.soft })
    }

    // Exit once the page is ready AND the drawing has finished. If called early,
    // re-arm rather than give up: setTimeout truncates fractional delays, so a
    // timer aimed at drawEnd can fire a fraction of a millisecond before it.
    const tryExit = () => {
      if (!pageReady || state !== 'drawing') return
      const wait = drawEnd - performance.now()
      if (wait <= 0) exit()
      else timers.push(window.setTimeout(tryExit, Math.ceil(wait) + 1))
    }

    const stopReady = whenPageReady(() => {
      pageReady = true
      tryExit()
    })
    timers.push(
      window.setTimeout(() => {
        pageReady = true
        tryExit()
      }, Math.max(0, HOLD_CAP_MS - performance.now())),
    )

    // Skip: the inline onclick / head-script keydown set html[data-intro-skip].
    if ('introSkip' in html.dataset) skip()
    const observer = new MutationObserver(() => {
      if ('introSkip' in html.dataset) skip()
    })
    observer.observe(html, { attributes: true, attributeFilter: ['data-intro-skip'] })
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') skip()
    }
    window.addEventListener('keydown', onKey)

    return () => {
      stopReady()
      timers.forEach(clearTimeout)
      observer.disconnect()
      window.removeEventListener('keydown', onKey)
      // StrictMode re-runs effects in development: undo an in-flight exit so
      // the second run starts from the same state.
      if (state !== 'done') {
        tl?.kill()
        tl = null
        root.querySelectorAll<HTMLElement>('.amp-intro__curtain, .amp-intro__stage, .amp-intro__atmos, .amp-intro__glow, .amp-intro__rule, .amp-intro__caption, .amp-intro__motto, .amp-intro__skip').forEach((el) => el.removeAttribute('style'))
        root.removeAttribute('style')
      }
    }
  }, [])

  return null
}
