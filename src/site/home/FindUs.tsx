import { ChapterLabel } from '../components/ChapterLabel'
import { MapEmbed } from '../components/MapEmbed'
import { SITE } from '../data/site'
import { Reveal } from '../motion/Reveal'
import { SplitHeading } from '../motion/SplitHeading'

/** Chapter 13 — Find us in Kumasi. */
export function FindUs() {
  return (
    <section className="amp-on-dark relative z-10 bg-amp-obsidian py-24 text-amp-ivory sm:py-32" aria-labelledby="find-title" data-theme="dark">
      <div className="mx-auto grid max-w-site gap-12 px-gutter lg:grid-cols-12 lg:gap-10">
        <div className="lg:col-span-5">
          <ChapterLabel no="13" tone="dark">
            Location
          </ChapterLabel>
          <SplitHeading id="find-title" className="amp-display mt-6 text-[clamp(2.6rem,7vw,5.25rem)]">
            Find us in Kumasi.
          </SplitHeading>
          <Reveal stagger={0.1} className="mt-10 space-y-8">
            <p data-reveal-item className="amp-lede text-amp-ivory/85">
              At Abuakwa DKC Junction on the Kumasi–Sunyani Road, north-west of the city centre.
            </p>
            <dl data-reveal-item className="grid gap-6 text-sm sm:grid-cols-2">
              <div>
                <dt className="amp-eyebrow text-amp-gold">Address</dt>
                <dd className="mt-2 leading-relaxed text-amp-ivory/80">
                  {SITE.address.line1}
                  <br />
                  {SITE.address.line2}
                  <br />
                  {SITE.address.city}, {SITE.address.country}
                </dd>
              </div>
              <div>
                <dt className="amp-eyebrow text-amp-gold">Hours</dt>
                <dd className="mt-2 leading-relaxed text-amp-ivory/80">
                  {SITE.hours.map((h) => (
                    <span key={h.days} className="block">
                      {h.days}: {h.time}
                    </span>
                  ))}
                </dd>
              </div>
            </dl>
            <div data-reveal-item className="flex flex-col gap-3 sm:flex-row">
              <a href={SITE.maps.directions} target="_blank" rel="noopener noreferrer" className="amp-btn amp-btn--gold">
                Get directions<span className="sr-only"> (opens Google Maps in a new tab)</span>
              </a>
              <a href={SITE.phone.href} className="amp-btn amp-btn--ghost-light">
                Call {SITE.phone.display}
              </a>
            </div>
          </Reveal>
        </div>
        <Reveal className="lg:col-span-7">
          <MapEmbed className="aspect-[4/3] w-full lg:aspect-auto lg:h-full lg:min-h-[32rem]" />
        </Reveal>
      </div>
    </section>
  )
}
