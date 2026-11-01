import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'

import { formatRate, useRooms } from '../data/rooms'

/**
 * Phones and tablets: a slim booking action pinned to the bottom once the
 * visitor has scrolled past the opening screen. It steps aside near the
 * footer and on the booking page itself. Sets html[data-booking-bar] while
 * shown so the voice concierge button moves above it.
 */
export function MobileBookingBar() {
  const { pathname } = useLocation()
  const { rooms, status } = useRooms()
  const [visible, setVisible] = useState(false)
  const [nearEnd, setNearEnd] = useState(false)
  const enabled = !pathname.startsWith('/booking')

  useEffect(() => {
    let raf = 0
    const update = () => {
      raf = 0
      setVisible(window.scrollY > window.innerHeight * 0.55)
    }
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update)
    }
    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(raf)
    }
  }, [pathname])

  // The voice concierge button waits until the visitor has scrolled past the
  // opening screen on phones, so it never sits on top of the hero's buttons.
  useEffect(() => {
    const html = document.documentElement
    if (visible || !enabled) html.dataset.scrolled = ''
    else delete html.dataset.scrolled
    return () => {
      delete html.dataset.scrolled
    }
  }, [visible, enabled])

  useEffect(() => {
    if (!enabled) return
    const targets = document.querySelectorAll('[data-site-footer], [data-final-cta]')
    if (!targets.length) return
    const seen = new Set<Element>()
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) e.isIntersecting ? seen.add(e.target) : seen.delete(e.target)
      setNearEnd(seen.size > 0)
    })
    targets.forEach((t) => io.observe(t))
    return () => io.disconnect()
  }, [enabled, pathname])

  const shown = enabled && visible && !nearEnd
  useEffect(() => {
    const html = document.documentElement
    if (shown) html.dataset.bookingBar = ''
    else delete html.dataset.bookingBar
    return () => {
      delete html.dataset.bookingBar
    }
  }, [shown])

  if (!enabled) return null
  const rates = status === 'ready' ? rooms.filter((r) => r.bookable && r.price !== null).map((r) => r.price as number) : []
  const from = rates.length ? formatRate(Math.min(...rates)) : null

  return (
    <aside aria-label="Quick booking" className="amp-booking-bar amp-on-dark" data-visible={shown ? '' : undefined} aria-hidden={!shown} inert={!shown}>
      <div className="flex items-center justify-between gap-4">
        <p className="min-w-0 text-xs leading-snug text-amp-ivory/75">
          {from ? (
            <>
              Rooms from <span className="whitespace-nowrap font-semibold text-amp-ivory">{from}</span> a night
            </>
          ) : (
            'Abuakwa, Kumasi'
          )}
        </p>
        <Link to="/booking" className="amp-btn amp-btn--gold !min-h-11 shrink-0 !px-5 !py-3" tabIndex={shown ? 0 : -1}>
          Book your stay
        </Link>
      </div>
    </aside>
  )
}
