import { useRef } from 'react'
import { Link } from 'react-router-dom'

import { HERO_MEDIA } from '../data/photos'
import { gsap, useGSAP } from '../lib/gsap'
import { DESKTOP, MOTION_OK } from '../motion/prefs'
import { Reveal } from '../motion/Reveal'

/**
 * Chapter 14 — the final invitation. The film comes full circle: its opening
 * frame (the lodge from above the road), dimmed almost to black. Two lines
 * drift in opposite directions as the section passes and a hairline draws
 * beneath; then one clear action.
 */
export function FinalInvitation() {
  const root = useRef<HTMLElement>(null)
  useGSAP(
    () => {
      const mm = gsap.matchMedia()
      mm.add({ motion: MOTION_OK, desktop: DESKTOP }, (ctx) => {
        if (!ctx.conditions?.motion) return
        const drift = ctx.conditions.desktop ? 1 : 0.7
        gsap
          .timeline({ defaults: { ease: 'none' }, scrollTrigger: { trigger: root.current, start: 'top bottom', end: 'bottom top', scrub: 0.8 } })
          .fromTo("[data-line='1']", { xPercent: -10 * drift }, { xPercent: 4 * drift }, 0)
          .fromTo("[data-line='2']", { xPercent: 12 * drift }, { xPercent: -3 * drift }, 0)
          .fromTo('[data-rule]', { scaleX: 0 }, { scaleX: 1 }, 0)
      })
      return () => mm.revert()
    },
    { scope: root },
  )

  return (
    <section
      ref={root}
      className="amp-on-dark relative z-10 overflow-hidden bg-amp-obsidian py-28 text-amp-ivory sm:py-36"
      aria-labelledby="final-title"
      data-theme="dark"
      data-final-cta
    >
      <div aria-hidden="true" className="absolute inset-0">
        <img
          src={`${HERO_MEDIA.base}-1280.webp`}
          srcSet={HERO_MEDIA.widths.map((w) => `${HERO_MEDIA.base}-${w}.webp ${w}w`).join(', ')}
          sizes="100vw"
          alt=""
          width={HERO_MEDIA.width}
          height={HERO_MEDIA.height}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover opacity-30 [object-position:50%_45%]"
        />
        <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(18,19,18,0.92),rgba(18,19,18,0.55)_45%,rgba(18,19,18,0.9))]" />
      </div>
      <div className="relative mx-auto max-w-site px-gutter">
        <p className="amp-eyebrow flex items-center gap-3 text-amp-gold-soft">
          <span className="amp-chapter-no text-amp-ivory/70">14</span>
          <span aria-hidden="true" className="h-px w-8 bg-amp-gold/60" />
          Book direct
        </p>
        <h2 id="final-title" className="amp-display mt-8 text-[clamp(2.6rem,9.5vw,9rem)] uppercase !leading-[0.9] tracking-[-0.01em]">
          <span data-line="1" className="block sm:whitespace-nowrap">
            Your stay
          </span>
          <span data-line="2" className="block italic text-amp-gold-soft sm:whitespace-nowrap sm:pl-[8vw]">
            begins here.
          </span>
        </h2>
        <div data-rule className="mt-10 h-px origin-left bg-amp-ivory/30" />
        <Reveal className="mt-10 flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-md text-amp-ivory/85">Choose your dates, pick your room and confirm in a few steps. We will take it from there.</p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link to="/booking" className="amp-btn amp-btn--gold">
              Book Your Stay <span className="amp-arrow" aria-hidden="true">→</span>
            </Link>
            <Link to="/rooms" className="amp-btn amp-btn--ghost-light">
              Explore Rooms
            </Link>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
