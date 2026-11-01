import { Link } from 'react-router-dom'

import { AmpLogo } from '../brand/AmpLogo'
import { NAV_LINKS, SITE } from '../data/site'

/**
 * Phones: the brand, then Visit and Explore side by side, then Contact across
 * the width (the phone number large, the two addresses side by side where
 * they fit), and one closing row. From `sm`, the three columns sit in a row.
 */
export function SiteFooter() {
  const year = new Date().getFullYear()
  return (
    <footer className="amp-on-dark relative bg-amp-obsidian pb-[calc(env(safe-area-inset-bottom)+6rem)] text-amp-ivory lg:pb-10" data-site-footer>
      <div className="mx-auto max-w-site px-gutter pt-16 sm:pt-20 lg:pt-28">
        <div className="grid gap-12 lg:grid-cols-12 lg:gap-14">
          <div className="lg:col-span-5">
            <Link to="/" className="-m-2 inline-block p-2" aria-label="AMP Lodge, home">
              <AmpLogo tone="light" title={null} className="w-36 sm:w-40" />
            </Link>
            <p className="amp-display mt-6 max-w-md text-[clamp(1.75rem,4vw,2.6rem)] leading-[1.05] text-amp-ivory sm:mt-8">Your comfort. Our priority.</p>
          </div>

          <div className="grid grid-cols-2 gap-x-6 gap-y-10 border-t border-amp-ivory/10 pt-10 sm:grid-cols-3 sm:gap-10 sm:border-t-0 sm:pt-0 lg:col-span-7">
            <div>
              <h2 className="amp-eyebrow text-amp-gold">Visit</h2>
              <address className="mt-4 text-sm not-italic leading-relaxed text-amp-ivory/80">
                {SITE.address.line1}
                <br />
                {SITE.address.line2}
                <br />
                {SITE.address.city}, {SITE.address.country}
              </address>
              <a href={SITE.maps.directions} target="_blank" rel="noopener noreferrer" className="amp-link mt-4 inline-block text-sm text-amp-ivory">
                Get directions<span className="sr-only"> (opens Google Maps in a new tab)</span>
              </a>
            </div>
            <nav aria-label="Footer">
              <h2 className="amp-eyebrow text-amp-gold">Explore</h2>
              <ul className="mt-2 text-sm text-amp-ivory/80 sm:mt-3">
                {NAV_LINKS.map((l) => (
                  <li key={l.to}>
                    <Link to={l.to} className="inline-flex min-h-10 items-center hover:text-amp-ivory">
                      {l.label}
                    </Link>
                  </li>
                ))}
                <li>
                  <Link to="/booking" className="inline-flex min-h-10 items-center hover:text-amp-ivory">
                    Book your stay
                  </Link>
                </li>
              </ul>
            </nav>
            <div className="col-span-2 border-t border-amp-ivory/10 pt-10 sm:col-span-1 sm:border-t-0 sm:pt-0">
              <h2 className="amp-eyebrow text-amp-gold">Contact</h2>
              <a href={SITE.phone.href} className="amp-display mt-3 inline-flex min-h-11 items-center text-[1.75rem] leading-none text-amp-ivory hover:text-amp-gold-soft sm:text-xl">
                {SITE.phone.display}
              </a>
              <ul className="mt-1 grid text-sm text-amp-ivory/80 [@media(min-width:25rem)]:grid-cols-2 [@media(min-width:25rem)]:gap-x-6 sm:!grid-cols-1">
                <li>
                  <a href={`mailto:${SITE.email.general}`} className="inline-flex min-h-10 items-center break-all hover:text-amp-ivory">
                    {SITE.email.general}
                  </a>
                </li>
                <li>
                  <a href={`mailto:${SITE.email.bookings}`} className="inline-flex min-h-10 items-center break-all hover:text-amp-ivory">
                    {SITE.email.bookings}
                  </a>
                </li>
              </ul>
            </div>
          </div>
        </div>

        <div className="mt-12 flex items-center justify-between gap-6 border-t border-amp-ivory/10 pt-6 text-xs text-amp-taupe sm:mt-16 sm:pt-8">
          <p>© {year} AMP Lodge, Kumasi. All rights reserved.</p>
          <Link to="/staff/login" className="inline-flex min-h-11 shrink-0 items-center hover:text-amp-ivory">
            Staff portal
          </Link>
        </div>
      </div>
    </footer>
  )
}
