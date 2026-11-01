import { Link } from 'react-router-dom'

import { useDocumentMeta } from '../seo/useDocumentMeta'

export default function NotFoundPage() {
  useDocumentMeta({ title: 'Page not found | AMP Lodge', description: 'This page could not be found.', path: '/404', noindex: true })
  return (
    <section className="amp-on-dark flex min-h-[80svh] items-center bg-amp-obsidian pt-[var(--amp-header-h)] text-amp-ivory" aria-labelledby="nf-title">
      <div className="mx-auto w-full max-w-site px-gutter py-24">
        <p className="amp-eyebrow text-amp-gold">Error 404</p>
        <h1 id="nf-title" className="amp-display mt-5 text-[clamp(2.8rem,8vw,6rem)]">
          This door doesn't lead anywhere.
        </h1>
        <p className="mt-6 max-w-lg text-amp-ivory/80">The page may have moved. Let us show you back to somewhere comfortable.</p>
        <div className="mt-10 flex flex-col gap-3 sm:flex-row">
          <Link to="/" className="amp-btn amp-btn--gold">
            Back to the home page
          </Link>
          <Link to="/rooms" className="amp-btn amp-btn--ghost-light">
            See the rooms
          </Link>
        </div>
      </div>
    </section>
  )
}
