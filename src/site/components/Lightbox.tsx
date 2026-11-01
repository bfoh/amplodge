import { useCallback, useEffect, useRef } from 'react'

import { photoJpg, photoSrcSet, type Photo } from '../data/photos'
import { lockScroll, unlockScroll } from '../motion/scroll-control'

interface LightboxProps {
  photos: Photo[]
  /** Index of the open photo, or null when closed. */
  index: number | null
  onIndexChange: (index: number | null) => void
}

/**
 * Accessible photo viewer on a native modal <dialog> (focus trap, Escape,
 * focus restored to the thumbnail that opened it). Arrow keys and horizontal
 * swipes move between photos; the caption and position are announced.
 */
export function Lightbox({ photos, index, onIndexChange }: LightboxProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const opener = useRef<HTMLElement | null>(null)
  const touch = useRef<{ x: number; y: number } | null>(null)
  const open = index !== null
  const photo = open ? photos[index] : null

  const go = useCallback(
    (delta: number) => {
      if (index === null) return
      onIndexChange((index + delta + photos.length) % photos.length)
    },
    [index, onIndexChange, photos.length],
  )

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) {
      opener.current = document.activeElement as HTMLElement | null
      // Lock first: both changes then share one style recalculation (showModal
      // forces one to move focus), roughly halving the cost of opening on phones.
      lockScroll()
      dialog.showModal()
    } else if (!open && dialog.open) {
      dialog.close()
    }
  }, [open])

  useEffect(
    () => () => {
      if (ref.current?.open) unlockScroll()
    },
    [],
  )

  return (
    <dialog
      ref={ref}
      className="amp-lightbox"
      aria-label="Photo viewer"
      onClose={() => {
        unlockScroll()
        onIndexChange(null)
        opener.current?.focus()
      }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') go(1)
        if (e.key === 'ArrowLeft') go(-1)
      }}
      onTouchStart={(e) => {
        const t = e.touches[0]
        touch.current = { x: t.clientX, y: t.clientY }
      }}
      onTouchEnd={(e) => {
        const start = touch.current
        touch.current = null
        if (!start) return
        const t = e.changedTouches[0]
        const dx = t.clientX - start.x
        const dy = t.clientY - start.y
        if (Math.abs(dx) > 48 && Math.abs(dx) > 1.5 * Math.abs(dy)) go(dx < 0 ? 1 : -1)
      }}
    >
      {photo && (
        <>
          <div className="flex items-center justify-between px-4 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-8">
            <p className="amp-chapter-no text-amp-ivory/70" aria-live="polite">
              {String(index! + 1).padStart(2, '0')} / {String(photos.length).padStart(2, '0')}
              <span className="sr-only">: {photo.caption}</span>
            </p>
            <button type="button" className="-mr-2 inline-flex h-12 items-center gap-3 px-2 text-amp-ivory" onClick={() => ref.current?.close()} autoFocus>
              <span className="amp-eyebrow">Close</span>
              <span aria-hidden="true" className="relative block h-5 w-5">
                <span className="absolute left-0 top-1/2 h-px w-5 rotate-45 bg-current" />
                <span className="absolute left-0 top-1/2 h-px w-5 -rotate-45 bg-current" />
              </span>
            </button>
          </div>

          <figure className="relative flex min-h-0 items-center justify-center px-2 sm:px-20">
            <picture key={photo.slug} className="flex h-full max-h-full w-full items-center justify-center">
              <source type="image/webp" srcSet={photoSrcSet(photo)} sizes="100vw" />
              <img src={photoJpg(photo)} alt={photo.alt} width={photo.width} height={photo.height} className="max-h-[calc(100svh-9rem)] w-auto max-w-full object-contain" />
            </picture>
            <figcaption className="sr-only">{photo.caption}</figcaption>
            <button type="button" onClick={() => go(-1)} className="absolute left-2 top-1/2 hidden h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full border border-amp-ivory/25 text-amp-ivory hover:border-amp-ivory/70 sm:inline-flex">
              <span aria-hidden="true">←</span>
              <span className="sr-only">Previous photo</span>
            </button>
            <button type="button" onClick={() => go(1)} className="absolute right-2 top-1/2 hidden h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full border border-amp-ivory/25 text-amp-ivory hover:border-amp-ivory/70 sm:inline-flex">
              <span aria-hidden="true">→</span>
              <span className="sr-only">Next photo</span>
            </button>
          </figure>

          <div className="flex items-center justify-between gap-4 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:px-8">
            <p className="amp-display text-xl text-amp-ivory sm:text-2xl" aria-hidden="true">
              {photo.caption}
            </p>
            <div className="flex gap-2 sm:hidden">
              <button type="button" onClick={() => go(-1)} className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-amp-ivory/25 text-amp-ivory">
                <span aria-hidden="true">←</span>
                <span className="sr-only">Previous photo</span>
              </button>
              <button type="button" onClick={() => go(1)} className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-amp-ivory/25 text-amp-ivory">
                <span aria-hidden="true">→</span>
                <span className="sr-only">Next photo</span>
              </button>
            </div>
          </div>
        </>
      )}
    </dialog>
  )
}
