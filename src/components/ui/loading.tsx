import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg' | 'xl'
  className?: string
  label?: string
}

const sizeClasses = {
  sm: 'w-4 h-4',
  md: 'w-6 h-6',
  lg: 'w-8 h-8',
  xl: 'w-12 h-12'
}

/**
 * Standard loading spinner component
 * Use this for consistent loading states across the app
 */
export function LoadingSpinner({ size = 'md', className, label }: LoadingSpinnerProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3">
      <Loader2 className={cn('animate-spin text-primary', sizeClasses[size], className)} />
      {label && (
        <p className="text-sm text-muted-foreground">{label}</p>
      )}
    </div>
  )
}

/**
 * Full page loading spinner
 * Use this for page-level loading states
 */
export function LoadingPage({ label = 'Loading...' }: { label?: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-secondary/30">
      <LoadingSpinner size="lg" label={label} />
    </div>
  )
}

/**
 * Card content loading spinner
 * Use this inside cards and containers
 */
export function LoadingCard({ label = 'Loading...' }: { label?: string }) {
  return (
    <div className="py-16 text-center">
      <LoadingSpinner size="md" label={label} />
    </div>
  )
}

/**
 * Inline loading spinner
 * Use this for button loading states and inline loading
 */
export function LoadingInline({ size = 'sm', className }: { size?: 'sm' | 'md'; className?: string }) {
  return (
    <Loader2 className={cn('animate-spin', sizeClasses[size], className)} />
  )
}

/**
 * Loading skeleton for content placeholders
 */
export function LoadingSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('animate-pulse rounded-md bg-muted', className)} />
  )
}

/**
 * Table loading skeleton
 */
export function TableLoadingSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-4">
          <LoadingSkeleton className="h-12 flex-1" />
          <LoadingSkeleton className="h-12 w-32" />
          <LoadingSkeleton className="h-12 w-24" />
        </div>
      ))}
    </div>
  )
}

/**
 * Form loading skeleton
 */
export function FormLoadingSkeleton() {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <LoadingSkeleton className="h-4 w-24" />
        <LoadingSkeleton className="h-10 w-full" />
      </div>
      <div className="space-y-2">
        <LoadingSkeleton className="h-4 w-32" />
        <LoadingSkeleton className="h-10 w-full" />
      </div>
      <div className="space-y-2">
        <LoadingSkeleton className="h-4 w-28" />
        <LoadingSkeleton className="h-20 w-full" />
      </div>
    </div>
  )
}

