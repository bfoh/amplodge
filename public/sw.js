/**
 * AmpLodge Service Worker — App Shell Caching
 *
 * Caches the app shell (HTML, JS, CSS, images) so the app loads
 * even without internet. Uses workbox-like strategies:
 *
 * - Static assets: Cache-first (served from cache, updated in background)
 * - HTML/navigation: Network-first (try network, fall back to cached shell)
 * - API calls: Network-only (let the offline cache layer handle data)
 */

// Bump these on every meaningful SW change so stale clients pick up the
// new fetch strategy and existing caches drop on activate.
const CACHE_NAME = 'amplodge-v2'
const SHELL_CACHE = 'amplodge-shell-v2'

// Assets to pre-cache on install
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/amp.png',
  '/amp-logo.png',
]

// Install: pre-cache the app shell
self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker...')
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => {
      return cache.addAll(PRECACHE_URLS).catch((err) => {
        console.warn('[SW] Pre-cache failed for some URLs:', err)
      })
    })
  )
  // Activate immediately
  self.skipWaiting()
})

// Activate: clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating service worker...')
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME && name !== SHELL_CACHE)
          .map((name) => {
            console.log('[SW] Removing old cache:', name)
            return caches.delete(name)
          })
      )
    })
  )
  // Take control of all pages immediately
  self.clients.claim()
})

// Fetch: route requests through appropriate strategy
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)

  // Skip non-GET requests
  if (event.request.method !== 'GET') return

  // Skip Supabase API calls — let the offline cache layer handle them
  if (url.hostname.includes('supabase') ||
      url.pathname.includes('.netlify/functions') ||
      url.pathname.startsWith('/api/')) {
    return
  }

  // Skip browser extension requests
  if (url.protocol === 'chrome-extension:' || url.protocol === 'moz-extension:') {
    return
  }

  // Navigation requests (HTML pages): Stale-while-revalidate with a 2.5s
  // network race. In Ghana the cold network often takes 3–5s for the HTML —
  // serving the cached shell instantly while we refresh in the background
  // makes the app feel native-fast. The cached shell is bytes-identical to
  // a network fetch (Vite emits the same index.html), so this is safe even
  // for new deploys: hashed asset URLs in the shell pull the new chunks the
  // moment the next reload happens.
  if (event.request.mode === 'navigate') {
    event.respondWith((async () => {
      const cached = await caches.match(event.request) || await caches.match('/index.html')

      const networkFetch = fetch(event.request)
        .then((response) => {
          if (response && response.ok) {
            const clone = response.clone()
            caches.open(SHELL_CACHE).then((cache) => cache.put(event.request, clone))
          }
          return response
        })
        .catch(() => null)

      if (cached) {
        // Refresh in background, return cached now
        networkFetch.catch(() => {})
        return cached
      }

      // No cache — race the network with a hard timeout so a stalled
      // connection doesn't hang the page indefinitely. If the timeout wins
      // we still wait briefly for whatever cached fallback we have.
      const timeoutFallback = new Promise((resolve) =>
        setTimeout(() => caches.match('/index.html').then(resolve), 2500)
      )
      return (await Promise.race([networkFetch, timeoutFallback])) ||
        (await caches.match('/index.html'))
    })())
    return
  }

  // Static assets (JS, CSS, images, fonts): Cache-first with background update
  if (isStaticAsset(url.pathname)) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        // Return cached version immediately
        const fetchPromise = fetch(event.request)
          .then((response) => {
            if (response && response.ok) {
              // Prevent cache poisoning: don't cache HTML responses for JS/CSS assets
              const contentType = response.headers.get('content-type') || ''
              if (contentType.includes('text/html') && (url.pathname.endsWith('.js') || url.pathname.endsWith('.css'))) {
                console.warn('[SW] 🛑 Refusing to cache HTML response for static asset:', url.pathname)
                return response
              }

              const clone = response.clone()
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(event.request, clone)
              })
            }
            return response
          })
          .catch(() => null)

        return cached || fetchPromise
      })
    )
    return
  }
})

function isStaticAsset(pathname) {
  return /\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|webp)(\?.*)?$/.test(pathname) ||
    pathname.startsWith('/assets/')
}
