import { lazy, Suspense, useEffect, type ComponentType } from 'react'
import { Route, Routes } from 'react-router-dom'

import '../styles/site.css'
import { BrandIntro } from '../intro/BrandIntro'
import { SmoothScroll } from '../motion/SmoothScroll'
import { MobileBookingBar } from './MobileBookingBar'
import { SiteFooter } from './SiteFooter'
import { SiteHeader } from './SiteHeader'

/** After a deploy, an old tab may ask for chunks that no longer exist: reload once to get the new build. */
function lazyPage<T extends ComponentType<object>>(load: () => Promise<{ default: T }>) {
  return lazy(() =>
    load().catch((error: unknown) => {
      const msg = error instanceof Error ? error.message : ''
      if (/failed to fetch dynamically imported module|loading chunk|valid JavaScript MIME type|Unexpected token '<'/i.test(msg)) {
        window.location.reload()
        return { default: (() => null) as unknown as T }
      }
      throw error
    }),
  )
}

const HomePage = lazyPage(() => import('../home/HomePage'))
const RoomsPage = lazyPage(() => import('../pages/RoomsPage'))
const RoomDetailPage = lazyPage(() => import('../pages/RoomDetailPage'))
const GalleryPage = lazyPage(() => import('../pages/GalleryPage'))
const ContactPage = lazyPage(() => import('../pages/ContactPage'))
const VirtualTourPage = lazyPage(() => import('../pages/VirtualTourPage'))
const NotFoundPage = lazyPage(() => import('../pages/NotFoundPage'))
const BookingPage = lazyPage(() => import('@/pages/BookingPage').then((m) => ({ default: m.BookingPage })))

/**
 * The public website: shell, motion system and routes. Loaded as its own
 * chunk, so staff and guest-portal sessions never download it.
 */
export default function PublicSite() {
  // Theme tokens on <html> while mounted, so portalled UI (selects, popovers,
  // toasts) used by the booking flow matches the site.
  useEffect(() => {
    const html = document.documentElement
    html.classList.add('amp-site-theme')
    return () => html.classList.remove('amp-site-theme')
  }, [])

  return (
    <div className="amp-site">
      <a href="#main" className="amp-skip-link">
        Skip to content
      </a>
      <BrandIntro />
      <SiteHeader />
      <main id="main" tabIndex={-1} className="flex-1 outline-none">
        <Suspense fallback={<div className="min-h-[100svh] bg-amp-obsidian" aria-busy="true" />}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/rooms" element={<RoomsPage />} />
            <Route path="/rooms/:slug" element={<RoomDetailPage />} />
            <Route path="/gallery" element={<GalleryPage />} />
            <Route path="/virtual-tour" element={<VirtualTourPage />} />
            <Route path="/contact" element={<ContactPage />} />
            <Route path="/booking" element={<BookingPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </Suspense>
      </main>
      <SiteFooter />
      <MobileBookingBar />
      <SmoothScroll />
    </div>
  )
}
