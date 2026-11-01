import { Link } from 'react-router-dom'

import { AmpLogo } from '../brand/AmpLogo'
import { NAV_LINKS, SITE } from '../data/site'

export function SiteFooter() {
  const year = new Date().getFullYear()
  return (
    <footer className="amp-on-dark relative bg-amp-obsidian pb-[calc(env(safe-area-inset-bottom)+6rem)] text-amp-ivory lg:pb-10" data-site-footer>
      <div className="mx-auto max-w-site px-gutter pt-20 lg:pt-28">
        <div className="grid gap-14 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <Link to="/" className="-m-2 inline-block p-2" aria-label="AMP Lodge, home">
              <AmpLogo tone="light" title={null} className="w-40" />
            </Link>
            <p className="amp-display mt-8 max-w-md text-[clamp(1.9rem,4vw,2.6rem)] text-amp-ivory">Your comfort. Our priority.</p>
          </div>

          <div className="grid gap-10 sm:grid-cols-3 lg:col-span-7">
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
            <div>
              <h2 className="amp-eyebrow text-amp-gold">Contact</h2>
              <ul className="mt-4 space-y-2 text-sm text-amp-ivory/80">
                <li>
                  <a href={SITE.phone.href} className="inline-flex min-h-11 items-center hover:text-amp-ivory">
                    {SITE.phone.display}
                  </a>
                </li>
                <li>
                  <a href={`mailto:${SITE.email.general}`} className="inline-flex min-h-11 items-center break-all hover:text-amp-ivory">
                    {SITE.email.general}
                  </a>
                </li>
                <li>
                  <a href={`mailto:${SITE.email.bookings}`} className="inline-flex min-h-11 items-center break-all hover:text-amp-ivory">
                    {SITE.email.bookings}
                  </a>
                </li>
              </ul>
            </div>
            <nav aria-label="Footer">
              <h2 className="amp-eyebrow text-amp-gold">Explore</h2>
              <ul className="mt-4 space-y-1 text-sm text-amp-ivory/80">
                {NAV_LINKS.map((l) => (
                  <li key={l.to}>
                    <Link to={l.to} className="inline-flex min-h-11 items-center hover:text-amp-ivory">
                      {l.label}
                    </Link>
                  </li>
                ))}
                <li>
                  <Link to="/booking" className="inline-flex min-h-11 items-center hover:text-amp-ivory">
                    Book your stay
                  </Link>
                </li>
              </ul>
            </nav>
          </div>
        </div>

        <div className="mt-16 flex flex-col gap-4 border-t border-amp-ivory/10 pt-8 text-xs text-amp-taupe sm:flex-row sm:items-center sm:justify-between">
          <p>© {year} AMP Lodge, Kumasi. All rights reserved.</p>
          <Link to="/staff/login" className="inline-flex min-h-11 items-center hover:text-amp-ivory">
            Staff portal
          </Link>
        </div>
      </div>
    </footer>
  )
}
