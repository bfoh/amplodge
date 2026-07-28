// Kill-switch service worker: the PWA layer has been removed from AmpLodge.
// This file must stay deployed indefinitely so devices that installed the old
// cache-first service worker (amplodge-v4 and earlier) pick it up on their
// hourly update check, wipe their caches, unregister, and load fresh builds
// straight from the network. Deleting this file would 404 the update check
// and strand those devices on a stale cached app shell forever.
self.addEventListener('install', () => self.skipWaiting())

// Old clients post { type: 'SKIP_WAITING' } to promote updates; accept silently.
self.addEventListener('message', () => {})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(keys.map((key) => caches.delete(key)))
      await self.registration.unregister()
      // Reload every open tab so it re-fetches index.html (served no-cache)
      // and runs the new, service-worker-free bundle.
      const clients = await self.clients.matchAll({ type: 'window' })
      clients.forEach((client) => client.navigate(client.url))
    })()
  )
})
