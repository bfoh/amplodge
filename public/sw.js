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

const CACHE_NAME = 'amplodge-v1'
const SHELL_CACHE = 'amplodge-shell-v1'

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

  // Navigation requests (HTML pages): Network-first
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // Cache the latest version
          const clone = response.clone()
          caches.open(SHELL_CACHE).then((cache) => {
            cache.put(event.request, clone)
          })
          return response
        })
        .catch(() => {
          // Offline — serve cached shell or fallback to index.html
          return caches.match(event.request).then((cached) => {
            return cached || caches.match('/index.html')
          })
        })
    )
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
