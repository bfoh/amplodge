import { Link } from 'react-router-dom'

import { cn } from '@/lib/utils'
import { bookingHref, formatRate, type LiveRoom } from '../data/rooms'
import { Picture } from './Picture'

interface RoomCardProps {
  room: LiveRoom
  loading: boolean
  className?: string
  sizes?: string
  headingLevel?: 'h3' | 'h2'
}

/**
 * A room: photograph, name, guests and nightly rate from the live system,
 * and the next step. Every room books through the same flow (rooms.ts).
 */
export function RoomCard({ room, loading, className, sizes = '(min-width: 64rem) 30vw, 80vw', headingLevel: H = 'h3' }: RoomCardProps) {
  const rate = formatRate(room.price)
  return (
    <article className={cn('group amp-zoom-parent relative flex flex-col', className)}>
      <div className="relative aspect-[4/5] overflow-hidden bg-amp-limestone">
        <Picture photo={room.hero} sizes={sizes} imgClassName="amp-zoom" />
      </div>
      <div className="flex flex-1 flex-col pt-5">
        <div className="flex items-baseline justify-between gap-4">
          <H className="amp-display text-[1.9rem] leading-none text-amp-ink">
            <Link to={`/rooms/${room.slug}`} className="after:absolute after:inset-0 after:content-['']">
              {room.name}
            </Link>
          </H>
          <p className="shrink-0 text-right text-sm text-amp-ink-muted">
            {rate ? (
              <>
                <span className="font-semibold text-amp-ink">{rate}</span> / night
              </>
            ) : loading ? (
              <span className="inline-block h-4 w-20 animate-pulse bg-amp-limestone"><span className="sr-only">Loading rate</span></span>
            ) : null}
          </p>
        </div>
        <p className="mt-2 text-sm text-amp-ink-muted">{room.maxGuests ? `Up to ${room.maxGuests} guests` : ' '}</p>
        <div className="relative z-10 mt-5 flex flex-wrap items-center gap-x-6 gap-y-2">
          <Link to={`/rooms/${room.slug}`} className="amp-eyebrow amp-link inline-flex min-h-11 items-center text-amp-ink">
            View room<span className="sr-only">: {room.name}</span>
          </Link>
          <Link to={bookingHref(room)} className="amp-eyebrow amp-link inline-flex min-h-11 items-center text-amp-bronze">
            Book<span className="sr-only">: {room.name}</span>
          </Link>
        </div>
      </div>
    </article>
  )
}
