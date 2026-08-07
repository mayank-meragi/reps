/* Service worker: PWA installability + offline app shell. GitHub Pages is static. */
const BASE = '/reps/'
const SHELL_CACHE = 'reps-shell-v1'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return

  // Network-first with cache fallback: the app shell keeps working offline
  event.respondWith(
    (async () => {
      try {
        const res = await fetch(event.request)
        const cache = await caches.open(SHELL_CACHE)
        cache.put(event.request, res.clone())
        return res
      } catch {
        const cached = await caches.match(event.request)
        return cached ?? caches.match(BASE)
      }
    })(),
  )
})
