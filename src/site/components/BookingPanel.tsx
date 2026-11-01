import { useEffect, useId, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { cn } from '@/lib/utils'
import { bookingHref, formatRate, type LiveRoom } from '../data/rooms'
import { setRoomChoice } from '../data/room-choice'

const iso = (d: Date) => {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
  return z.toISOString().slice(0, 10)
}

interface BookingPanelProps {
  /** Every room the visitor can choose from; one room fixes the choice (room pages). */
  rooms: LiveRoom[]
  /** The room to start on, by slug. */
  initial?: string | null
  tone?: 'light' | 'dark'
  /** Dates and guests on one row from the sm breakpoint (a shorter panel, for sticky asides). */
  inline?: boolean
  className?: string
}

/**
 * Dates, guests and (where there is a choice) the room, handed to the one
 * booking flow (/booking) with the room preselected. Used by the room pages
 * and by the booking interface the home page's film ends in, so every "book"
 * path on the site carries the same choices into the same workflow. Nothing
 * is reserved here: availability and the rate are checked on the next page.
 */
export function BookingPanel({ rooms, initial, tone = 'light', inline = false, className }: BookingPanelProps) {
  const navigate = useNavigate()
  const id = useId()
  const today = useMemo(() => iso(new Date()), [])
  const fixed = rooms.length === 1
  const [slug, setSlug] = useState<string>(() => initial ?? rooms[0]?.slug ?? '')
  const [checkIn, setCheckIn] = useState('')
  const [checkOut, setCheckOut] = useState('')
  const [guests, setGuests] = useState(2)
  const [error, setError] = useState('')

  // Follow the room the visitor last looked at or picked (film, list or this select).
  useEffect(() => {
    if (initial) setSlug(initial)
  }, [initial])

  const room = rooms.find((r) => r.slug === slug) ?? rooms[0]
  const maxGuests = room?.maxGuests ?? 4
  useEffect(() => {
    if (guests > maxGuests) setGuests(maxGuests)
  }, [guests, maxGuests])

  const minOut = checkIn ? iso(new Date(new Date(`${checkIn}T00:00:00`).getTime() + 86400000)) : today
  const dark = tone === 'dark'
  const field = cn(
    'mt-2 h-12 w-full border px-3 text-base',
    dark ? 'border-amp-ivory/30 bg-amp-charcoal text-amp-ivory [color-scheme:dark]' : 'border-amp-ink/30 bg-amp-ivory text-amp-ink',
  )
  const label = cn('amp-eyebrow block', dark ? 'text-amp-ivory/70' : 'text-amp-ink-muted')
  const rate = formatRate(room?.price ?? null)

  return (
    <form
      className={cn('space-y-5', className)}
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        if (checkIn && checkOut && checkOut <= checkIn) {
          setError('Check-out must be after check-in.')
          return
        }
        setError('')
        if (room) setRoomChoice(room.slug)
        navigate(bookingHref(room, { checkIn: checkIn || undefined, checkOut: checkOut || undefined, guests }))
      }}
    >
      {!fixed && (
        <div>
          <label htmlFor={`${id}-room`} className={label}>
            Room
          </label>
          <select
            id={`${id}-room`}
            value={room?.slug ?? ''}
            onChange={(e) => {
              setSlug(e.target.value)
              setRoomChoice(e.target.value)
            }}
            className={field}
          >
            {rooms.map((r) => (
              <option key={r.slug} value={r.slug}>
                {r.name}
                {formatRate(r.price) ? ` · ${formatRate(r.price)}` : ''}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className={cn('grid grid-cols-2 gap-x-3 gap-y-5', inline && 'sm:grid-cols-[1fr_1fr_0.85fr]')}>
        <div>
          <label htmlFor={`${id}-in`} className={label}>
            Check-in
          </label>
          <input
            id={`${id}-in`}
            type="date"
            min={today}
            value={checkIn}
            onChange={(e) => {
              setCheckIn(e.target.value)
              if (checkOut && e.target.value && checkOut <= e.target.value) setCheckOut('')
            }}
            className={field}
          />
        </div>
        <div>
          <label htmlFor={`${id}-out`} className={label}>
            Check-out
          </label>
          <input
            id={`${id}-out`}
            type="date"
            min={minOut}
            value={checkOut}
            onChange={(e) => setCheckOut(e.target.value)}
            aria-invalid={!!error}
            aria-describedby={error ? `${id}-err` : undefined}
            className={field}
          />
        </div>
        <div className={cn('col-span-2', inline && 'sm:col-span-1')}>
          <label htmlFor={`${id}-guests`} className={label}>
            Guests
          </label>
          <select id={`${id}-guests`} value={guests} onChange={(e) => setGuests(Number(e.target.value))} className={field}>
            {Array.from({ length: maxGuests }, (_, i) => i + 1).map((g) => (
              <option key={g} value={g}>
                {g} {g === 1 ? 'guest' : 'guests'}
              </option>
            ))}
          </select>
        </div>
      </div>
      {error && (
        <p id={`${id}-err`} role="alert" className={cn('text-sm font-medium', dark ? 'text-[#f0b3a8]' : 'text-[#8a1c1c]')}>
          {error}
        </p>
      )}
      <button type="submit" className={cn('amp-btn amp-btn--block', dark && 'amp-btn--gold')}>
        Check availability <span className="amp-arrow" aria-hidden="true">→</span>
      </button>
      <p className={cn('text-xs', dark ? 'text-amp-ivory/60' : 'text-amp-ink-muted')}>
        {!fixed && room && rate ? `${room.name}: ${rate} a night. ` : ''}
        Next you'll see availability for your dates. Nothing is booked until you confirm.
      </p>
    </form>
  )
}
