import { AlertTriangle } from 'lucide-react'
import type { HandsFree } from '@/hooks/use-hands-free-read'

/** "Watching the encoder" while hands-free reading is on, or why the encoder cannot be read. */
export function HandsFreeHint({ state, what = 'a card laid on it is read by itself' }: { state: HandsFree; what?: string }) {
  if (state.problem) {
    return <p className="flex items-start gap-2 text-sm text-amber-900"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{state.problem}</p>
  }
  if (!state.listening) return null
  return (
    <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
      <span className="relative flex h-2 w-2" aria-hidden="true">
        <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 motion-safe:animate-ping" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
      </span>
      Watching the encoder: {what}.
    </p>
  )
}
