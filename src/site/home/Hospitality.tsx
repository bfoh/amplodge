import { ChapterLabel } from '../components/ChapterLabel'
import { useApprovedReviews } from '../data/reviews'
import { SITE } from '../data/site'
import { Reveal } from '../motion/Reveal'
import { SplitHeading } from '../motion/SplitHeading'

/**
 * Chapter 12 — Genuine hospitality. Guest reviews appear only when real,
 * approved reviews with written comments exist in the system.
 */
export function Hospitality() {
  const { reviews } = useApprovedReviews(3)
  return (
    <section className="relative z-10 bg-amp-ivory py-24 sm:py-32 lg:py-40" aria-labelledby="hospitality-title" data-theme="light">
      <div className="mx-auto max-w-site px-gutter">
        <div className="mx-auto max-w-4xl text-center">
          <ChapterLabel no="12" className="justify-center">
            Hospitality
          </ChapterLabel>
          <SplitHeading id="hospitality-title" className="amp-display mt-6 text-[clamp(2.6rem,7.5vw,6rem)] text-amp-ink">
            Hospitality You Can Feel.
          </SplitHeading>
          <Reveal className="mx-auto mt-8 max-w-2xl">
            <p className="amp-lede text-amp-ink-muted">
              Good hospitality is mostly small things done well: a clear welcome when you arrive, a room that is ready when you are, and a
              real person who answers when you call. That is the standard we hold ourselves to.
            </p>
          </Reveal>
        </div>

        {reviews.length > 0 && (
          <Reveal stagger={0.1} className="mt-20">
            <h3 className="sr-only">What guests say</h3>
            <ul className="grid gap-6 md:grid-cols-3">
              {reviews.map((r) => (
                <li key={r.id} data-reveal-item className="flex flex-col border-t border-amp-ink/15 pt-6">
                  <p className="text-amp-bronze" aria-label={`Rated ${r.rating} out of 5`}>
                    <span aria-hidden="true">{'★'.repeat(r.rating)}</span>
                  </p>
                  <blockquote className="mt-4 flex-1">
                    <p className="amp-display text-[1.5rem] leading-snug text-amp-ink">“{r.comment}”</p>
                  </blockquote>
                  <p className="amp-eyebrow mt-6 text-amp-ink-muted">{r.name}, verified stay</p>
                </li>
              ))}
            </ul>
          </Reveal>
        )}

        <Reveal className="mx-auto mt-16 flex max-w-2xl flex-col items-center gap-4 text-center sm:flex-row sm:justify-center">
          <a href={SITE.phone.href} className="amp-btn">
            Call us {SITE.phone.display}
          </a>
          <a href={SITE.maps.link} target="_blank" rel="noopener noreferrer" className="amp-btn amp-btn--ghost">
            AMP Lodge on Google Maps<span className="sr-only"> (opens in a new tab)</span>
          </a>
        </Reveal>
      </div>
    </section>
  )
}
