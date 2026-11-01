import { useEffect, useRef, type RefObject } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'

import { cn } from '@/lib/utils'
import { AmpLogo } from '../brand/AmpLogo'
import { NAV_LINKS, SITE } from '../data/site'
import { ease, gsap } from '../lib/gsap'
import { prefersReducedMotion } from '../motion/prefs'
import { lockScroll, unlockScroll } from '../motion/scroll-control'

interface MobileMenuProps {
  open: boolean
  onClose: () => void
  returnFocus: RefObject<HTMLButtonElement | null>
}

/**
 * Full-screen menu on a native modal <dialog>: the browser traps focus, makes
 * the page inert, closes on Escape and restores focus. Scroll is locked while
 * open; safe-area insets pad the content. Links rise in on open and the panel
 * leaves faster than it arrived.
 */
export function MobileMenu({ open, onClose, returnFocus }: MobileMenuProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const closing = useRef(false)
  const { pathname } = useLocation()

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) {
      // Lock first: both changes then share one style recalculation (showModal
      // forces one to move focus), roughly halving the cost of opening on phones.
      lockScroll()
      dialog.showModal()
      if (!prefersReducedMotion()) {
        gsap.fromTo(dialog, { clipPath: 'inset(0% 0% 100% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)', duration: 0.75, ease: ease.mask })
        gsap.fromTo(
          dialog.querySelectorAll('[data-menu-item]'),
          { yPercent: 110, opacity: 0 },
          { yPercent: 0, opacity: 1, duration: 1, stagger: 0.06, ease: ease.editorial, delay: 0.25 },
        )
      }
    }
  }, [open])

  const requestClose = () => {
    const dialog = ref.current
    if (!dialog?.open || closing.current) return
    closing.current = true
    const done = () => {
      dialog.close()
      closing.current = false
      gsap.set(dialog, { clearProps: 'clipPath' })
      unlockScroll()
      onClose()
      returnFocus.current?.focus()
    }
    if (prefersReducedMotion()) done()
    else gsap.to(dialog, { clipPath: 'inset(0% 0% 100% 0%)', duration: 0.45, ease: ease.mask, onComplete: done })
  }

  // Close when a link navigates.
  useEffect(() => {
    if (ref.current?.open) requestClose()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])

  // Unlock if unmounted while open.
  useEffect(
    () => () => {
      if (ref.current?.open) unlockScroll()
    },
    [],
  )

  return (
    <dialog
      ref={ref}
      id="amp-menu"
      className="amp-menu lg:hidden"
      aria-label="Menu"
      onCancel={(e) => {
        e.preventDefault()
        requestClose()
      }}
    >
      <div className="amp-menu__inner">
        <div className="flex h-[var(--amp-header-h)] shrink-0 items-center justify-between">
          <Link to="/" className="-m-2 p-2" aria-label="AMP Lodge, home" onClick={requestClose}>
            <AmpLogo tone="light" title={null} className="w-[6.75rem] sm:w-[7.5rem]" />
          </Link>
          <button type="button" className="-mr-2 inline-flex h-12 w-12 items-center justify-center" onClick={requestClose}>
            <span className="sr-only">Close menu</span>
            <span aria-hidden="true" className="relative block h-6 w-6">
              <span className="absolute left-0 top-1/2 h-px w-6 rotate-45 bg-current" />
              <span className="absolute left-0 top-1/2 h-px w-6 -rotate-45 bg-current" />
            </span>
          </button>
        </div>

        <nav aria-label="Main" className="mt-8 flex-1">
          <ul className="space-y-1">
            {[{ to: '/', label: 'Home' }, ...NAV_LINKS].map((l, i) => (
              <li key={l.to} className="overflow-hidden">
                <NavLink
                  to={l.to}
                  end={l.to === '/'}
                  data-menu-item
                  onClick={requestClose}
                  className={({ isActive }) =>
                    cn('amp-display flex items-baseline gap-4 py-2 text-[clamp(2.4rem,11vw,3.6rem)] text-amp-ivory', isActive && 'text-amp-gold-soft')
                  }
                >
                  <span className="amp-chapter-no text-amp-taupe" aria-hidden="true">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  {l.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <div className="mt-10 space-y-6" data-menu-item>
          <Link to="/booking" onClick={requestClose} className="amp-btn amp-btn--gold amp-btn--block">
            Book your stay <span className="amp-arrow" aria-hidden="true">→</span>
          </Link>
          <div className="grid grid-cols-2 gap-4 text-sm text-amp-ivory/80">
            <a href={SITE.phone.href} className="flex min-h-11 flex-col justify-center">
              <span className="amp-eyebrow text-amp-taupe">Call</span>
              {SITE.phone.display}
            </a>
            <a href={`mailto:${SITE.email.general}`} className="flex min-h-11 flex-col justify-center break-all">
              <span className="amp-eyebrow text-amp-taupe">Email</span>
              {SITE.email.general}
            </a>
          </div>
          <p className="text-sm leading-relaxed text-amp-ivory/70">{SITE.address.oneLine}</p>
        </div>
      </div>
    </dialog>
  )
}
