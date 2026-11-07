import { useEffect, useId, useState } from 'react'
import { cn } from '@/lib/utils'
import { LODGE_PLATE, LOGO_PATHS, LOGO_STROKE_MASK_WIDTH, LOGO_STROKES, LOGO_VIEWBOX } from '@/site/brand/logo-geometry'
import './brand-loader.css'

/** One loop of the animation (keep in step with --bl-loop in brand-loader.css). */
const LOOP_MS = 2200
/** Loads quicker than this never show the loader at all, so fast pages don't flash it. */
const APPEAR_MS = 140
/** A loader that mounts this soon after another one left takes over from it, mid-loop. */
const HANDOVER_MS = 400

// One clock for every loader. The app-wide fallback, the "verifying access" screen and a
// page's own loader follow one another while a page opens: each picks up the loop where
// the last one was, instead of starting again.
let mounted = 0
let epoch = 0
let lastGone = -Infinity

function useLoaderClock() {
  const [clock] = useState(() => {
    const now = performance.now()
    const handover = mounted > 0 || now - lastGone < HANDOVER_MS
    if (!handover) epoch = now + APPEAR_MS
    return { handover, delay: Math.round(epoch - now) }
  })
  useEffect(() => {
    mounted += 1
    return () => {
      mounted -= 1
      lastGone = performance.now()
    }
  }, [])
  return clock
}

const [DOT_A, DOT_M] = LOGO_PATHS.dots.split(/\s(?=M)/)
const MASK_REGION = { maskUnits: 'userSpaceOnUse', x: 100, y: 100, width: 960, height: 320 } as const

const VARIANTS = {
  /** Covers the whole window: while the app or a sign-in check loads. */
  screen: { box: 'fixed inset-0 z-50 bg-background', logo: 'w-[200px] sm:w-[232px]' },
  /** Fills a page's content area while the page loads. */
  page: { box: 'min-h-[60vh] w-full', logo: 'w-[188px]' },
  /** Inside a card or a panel. */
  section: { box: 'w-full py-12', logo: 'w-[132px]' },
} as const

interface BrandLoaderProps {
  /** What is loading, e.g. "Loading tasks". Shown under the logo and read out by screen readers. */
  label?: string
  variant?: keyof typeof VARIANTS
  className?: string
}

/**
 * The AMP Lodge loading mark: the logo writes itself, the LODGE bar wipes in, the dots
 * drop into place, and it starts over until the page is ready. A faint outline of the
 * logo stays underneath, so there is always something on screen.
 */
export function BrandLoader({ label = 'Loading', variant = 'page', className }: BrandLoaderProps) {
  const { handover, delay } = useLoaderClock()
  const id = `bl${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const v = VARIANTS[variant]
  const text = label.replace(/(\.\.\.|…)\s*$/, '').trim()

  return (
    <div
      role="status"
      aria-live="polite"
      data-handover={handover ? '' : undefined}
      className={cn('bl flex flex-col items-center justify-center gap-5', v.box, className)}
      style={{ '--bl-delay': `${delay}ms`, '--bl-loop': `${LOOP_MS}ms` } as React.CSSProperties}
    >
      <div className={cn('bl-appear', v.logo)}>
        <svg viewBox={LOGO_VIEWBOX} className="bl-svg" aria-hidden="true" focusable="false">
          <defs>
            {(['a', 'm', 'p'] as const).map((k) => (
              <mask key={k} id={`${id}-${k}`} {...MASK_REGION}>
                <path className={`bl-pen bl-pen--${k}`} pathLength={1} style={{ strokeWidth: LOGO_STROKE_MASK_WIDTH }} d={LOGO_STROKES[k]} />
              </mask>
            ))}
            <mask id={`${id}-bar`} {...MASK_REGION}>
              <path className="bl-pen bl-pen--bar" pathLength={1} d="M 124 350 L 1026 350" />
            </mask>
            <mask id={`${id}-shape`} {...MASK_REGION}>
              <g fill="#fff" fillRule="evenodd">
                <path d={LOGO_PATHS.a} />
                <path d={LOGO_PATHS.m} />
                <path d={LOGO_PATHS.p} />
                <path d={LOGO_PATHS.dots} />
                <path d={LOGO_PATHS.bar} />
              </g>
            </mask>
            <linearGradient id={`${id}-sheen`} x1="0" x2="1" y1="0" y2="0">
              <stop offset="0" stopColor="#fff7e0" stopOpacity="0" />
              <stop offset="0.5" stopColor="#fff7e0" stopOpacity="0.42" />
              <stop offset="1" stopColor="#fff7e0" stopOpacity="0" />
            </linearGradient>
          </defs>

          <g className="bl-mark">
            {/* The faint outline that is always there. */}
            <g className="bl-ghost" fillRule="evenodd">
              <path d={LOGO_PATHS.a} />
              <path d={LOGO_PATHS.m} />
              <path d={LOGO_PATHS.p} />
              <path d={LOGO_PATHS.dots} />
            </g>
            <path className="bl-ghost-bar" d={LOGO_PATHS.bar} fillRule="evenodd" />

            {/* The logo as it is drawn. */}
            <g className="bl-ink">
              <g className="bl-letter" fillRule="evenodd">
                <path d={LOGO_PATHS.a} mask={`url(#${id}-a)`} />
                <path d={LOGO_PATHS.m} mask={`url(#${id}-m)`} />
                <path d={LOGO_PATHS.p} mask={`url(#${id}-p)`} />
              </g>
              <g mask={`url(#${id}-bar)`}>
                <rect className="bl-plate" x={LODGE_PLATE.x} y={LODGE_PLATE.y} width={LODGE_PLATE.width} height={LODGE_PLATE.height} rx={LODGE_PLATE.rx} />
                <path className="bl-bar" d={LOGO_PATHS.bar} fillRule="evenodd" />
              </g>
              <path className="bl-dot bl-dot--a" d={DOT_A} />
              <path className="bl-dot bl-dot--m" d={DOT_M} />
              <g mask={`url(#${id}-shape)`}>
                <g className="bl-sheen">
                  <rect x={-110} y={100} width={150} height={320} transform="skewX(-20)" fill={`url(#${id}-sheen)`} />
                </g>
              </g>
            </g>
          </g>
        </svg>
      </div>
      <p className="bl-label text-[11px] font-medium uppercase tracking-[0.22em] text-muted-foreground">{text}</p>
    </div>
  )
}
