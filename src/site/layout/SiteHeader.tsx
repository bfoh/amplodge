import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'

import { cn } from '@/lib/utils'
import { AmpLogo } from '../brand/AmpLogo'
import { NAV_LINKS } from '../data/site'
import { MobileMenu } from './MobileMenu'

/** Routes that open on a dark, full-bleed photograph: the header starts transparent over it. */
function opensOnPhoto(pathname: string) {
  return pathname === '/' || /^\/(rooms|gallery|virtual-tour|contact)(\/|$)/.test(pathname)
}

/**
 * Transparent over the hero, ivory once the page scrolls; hides while reading
 * downwards and returns on the first scroll up. Never hides while focused.
 */
export function SiteHeader() {
  const { pathname } = useLocation()
  const overlay = opensOnPhoto(pathname)
  const [solid, setSolid] = useState(!overlay)
  const [hidden, setHidden] = useState(false)
  const [overDark, setOverDark] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuButton = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    let lastY = window.scrollY
    let raf = 0
    // Over the arrival film and the room selection (marked data-header-dark) the
    // header stays transparent with light type, however far the page has scrolled.
    const darkUnderHeader = () => {
      const probe = 34
      for (const el of document.querySelectorAll<HTMLElement>('[data-header-dark]')) {
        const r = el.getBoundingClientRect()
        if (r.top <= probe && r.bottom > probe) return true
      }
      return false
    }
    const update = () => {
      raf = 0
      const y = window.scrollY
      const dark = darkUnderHeader()
      setOverDark(dark)
      setSolid(!dark && (!overlay || y > 48))
      const delta = y - lastY
      if (Math.abs(delta) > 6) {
        setHidden(delta > 0 && y > window.innerHeight * 0.6)
        lastY = y
      }
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
  }, [overlay, pathname])

  const lightTone = (overlay || overDark) && !solid
  return (
    <>
      <header
        className="amp-header"
        data-solid={solid ? '' : undefined}
        data-hidden={hidden && !menuOpen ? '' : undefined}
        data-tone={lightTone ? 'dark-bg' : 'light'}
      >
        <div className="amp-header__scrim" aria-hidden="true" />
        <div className="mx-auto flex h-[var(--amp-header-h)] max-w-site items-center justify-between gap-6 px-gutter">
          <Link to="/" data-header-logo className="-m-2 flex shrink-0 items-center p-2" aria-label="AMP Lodge, home">
            <AmpLogo tone={lightTone ? 'light' : 'dark'} title={null} className="w-[6.75rem] sm:w-[7.5rem]" />
          </Link>

          <nav aria-label="Main" className="hidden lg:block">
            <ul className="flex items-center gap-9">
              {NAV_LINKS.map((l) => (
                <li key={l.to}>
                  <NavLink
                    to={l.to}
                    className={({ isActive }) =>
                      cn('amp-eyebrow inline-flex min-h-11 items-center opacity-90 transition-opacity hover:opacity-100', isActive && 'amp-link opacity-100')
                    }
                  >
                    {l.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>

          <div className="flex items-center gap-2">
            <Link
              to="/booking"
              className={cn('amp-btn !hidden !min-h-11 !px-5 !py-3 sm:!inline-flex', lightTone ? 'amp-btn--ghost-light' : '')}
            >
              Book your stay
            </Link>
            <button
              ref={menuButton}
              type="button"
              className="-mr-2 inline-flex h-12 w-12 items-center justify-center lg:hidden"
              aria-haspopup="dialog"
              aria-expanded={menuOpen}
              aria-controls="amp-menu"
              onClick={() => setMenuOpen(true)}
            >
              <span className="sr-only">Open menu</span>
              <span aria-hidden="true" className="flex w-6 flex-col gap-[7px]">
                <span className="block h-px w-full bg-current" />
                <span className="block h-px w-4 self-end bg-current" />
              </span>
            </button>
          </div>
        </div>
      </header>
      <MobileMenu open={menuOpen} onClose={() => setMenuOpen(false)} returnFocus={menuButton} />
    </>
  )
}
