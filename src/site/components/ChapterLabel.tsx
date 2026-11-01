import { cn } from '@/lib/utils'

interface ChapterLabelProps {
  no: string
  children: React.ReactNode
  tone?: 'light' | 'dark'
  className?: string
}

/** "02 —— Welcome": the chapter number and name above a section heading. */
export function ChapterLabel({ no, children, tone = 'light', className }: ChapterLabelProps) {
  return (
    <p className={cn('amp-eyebrow flex items-center gap-3', tone === 'dark' ? 'text-amp-gold' : 'text-amp-bronze', className)}>
      <span className={cn('amp-chapter-no', tone === 'dark' ? 'text-amp-ivory/70' : 'text-amp-ink-muted')}>{no}</span>
      <span aria-hidden="true" className={cn('h-px w-8', tone === 'dark' ? 'bg-amp-gold/60' : 'bg-amp-bronze/50')} />
      {children}
    </p>
  )
}
