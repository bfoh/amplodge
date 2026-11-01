import { useState } from 'react'

import { cn } from '@/lib/utils'
import { SITE } from '../data/site'
import { Picture } from './Picture'
import { PHOTOS } from '../data/photos'

/**
 * Google Maps loads only when asked: it is ~1 MB of third-party script and
 * sets cookies, so the page shows a photograph and a button until then.
 */
export function MapEmbed({ className }: { className?: string }) {
  const [load, setLoad] = useState(false)
  return (
    <div className={cn('relative overflow-hidden bg-amp-charcoal', className)}>
      {load ? (
        <iframe
          src={SITE.maps.embed}
          title="Map showing AMP Lodge at Abuakwa DKC Junction, Kumasi"
          className="absolute inset-0 h-full w-full border-0"
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          allowFullScreen
        />
      ) : (
        <>
          <Picture photo={PHOTOS.exteriorNight} alt="" sizes="(min-width: 64rem) 50vw, 100vw" className="absolute inset-0 h-full opacity-60" />
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-amp-obsidian/40 p-6 text-center">
            <button type="button" onClick={() => setLoad(true)} className="amp-btn amp-btn--gold">
              Show the map
            </button>
            <p className="max-w-xs text-xs text-amp-ivory/80">Loads Google Maps, which may set cookies.</p>
          </div>
        </>
      )}
    </div>
  )
}
