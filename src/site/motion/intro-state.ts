/**
 * Coordinates the brand intro with page intros. BrandIntro calls
 * `releaseIntro()` as its curtain opens; hero animations wait on `onIntro()`.
 * When the intro is not playing (seen this session, reduced motion,
 * client-side navigation) intros run straight away.
 */
type Listener = () => void

let released = false
const listeners = new Set<Listener>()

export function introWillPlay(): boolean {
  const html = document.documentElement
  return html.dataset.intro === 'play' && !('introDone' in html.dataset) && html.dataset.motion === 'full'
}

export function releaseIntro() {
  if (released) return
  released = true
  for (const fn of listeners) fn()
  listeners.clear()
}

/** Runs `fn` once the intro is released. Returns an unsubscribe. */
export function onIntro(fn: Listener): () => void {
  if (released || !introWillPlay()) {
    fn()
    return () => {}
  }
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
