import { cn } from '@/lib/utils'
import { LODGE_PLATE, LOGO_COLORS, LOGO_PATHS, LOGO_VIEWBOX } from './logo-geometry'

interface AmpLogoProps {
  className?: string
  /** "light": ivory letters, for dark backgrounds. "dark": burgundy letters, for light backgrounds. */
  tone?: 'light' | 'dark'
  /** Accessible name. Pass null when the surrounding link already names it. */
  title?: string | null
}

/**
 * The AMP Lodge logo as inline SVG (traced stand-in, see logo-geometry.ts).
 * The LODGE bar keeps the brand colours in both tones; only the AMP letters
 * change, so the mark reads on photographs and on ivory alike.
 */
export function AmpLogo({ className, tone = 'dark', title = 'AMP Lodge' }: AmpLogoProps) {
  const letters = tone === 'light' ? LOGO_COLORS.ivory : LOGO_COLORS.burgundy
  return (
    <svg
      viewBox={LOGO_VIEWBOX}
      className={cn('block h-auto', className)}
      role={title ? 'img' : undefined}
      aria-label={title ?? undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <g fill={letters} fillRule="evenodd" style={{ transition: 'fill 0.5s cubic-bezier(0.4,0,0.2,1)' }}>
        <path d={LOGO_PATHS.a} />
        <path d={LOGO_PATHS.m} />
        <path d={LOGO_PATHS.p} />
        <path d={LOGO_PATHS.dots} />
      </g>
      <rect
        x={LODGE_PLATE.x}
        y={LODGE_PLATE.y}
        width={LODGE_PLATE.width}
        height={LODGE_PLATE.height}
        rx={LODGE_PLATE.rx}
        fill={LOGO_COLORS.burgundy}
      />
      <path d={LOGO_PATHS.bar} fill={LOGO_COLORS.barGold} fillRule="evenodd" />
    </svg>
  )
}
