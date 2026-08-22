// Minimal, hand-written service worker for installability + a bare offline
// shell. Deliberately dependency-free (no next-pwa/workbox): the caching rules
// below are short enough to read in one sitting, and getting them WRONG on a
// multi-tenant app leaks one family's data to another, so they stay explicit.
//
// Scope is intentionally narrow:
//  - Navigations (HTML page loads): network-first, falling back to the
//    cached /offline page when there is no network. We never cache authed
//    HTML — family data is per-tenant and a stale/cached page could leak
//    one family's data to a different signed-in user on a shared device.
//  - Static, unauthenticated, effectively-immutable assets (icons +
//    manifest): cache-first, since they don't vary per user/session.
//  - Everything else (API routes, server actions, POST requests, etc.) is
//    left completely alone — passthrough to the network with no caching.

const CACHE_VERSION = 'v1';
const CACHE_NAME = `fc-shell-${CACHE_VERSION}`;

const OFFLINE_URL = '/offline';

// The precached "app shell": just enough to render the offline fallback
// and satisfy installability checks. No authed/dynamic routes here.
const PRECACHE_URLS = [
  OFFLINE_URL,
  '/manifest.webmanifest',
  '/icons/icon-192.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('fc-shell-') && key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

// Static, unauthenticated assets we're willing to cache-first. Kept to an
// explicit allowlist (icons/ + the manifest) rather than a blanket
// same-origin rule, so we never accidentally serve stale/cached HTML or API
// responses.
function isCacheFirstAsset(url) {
  if (url.origin !== self.location.origin) return false;
  return url.pathname.startsWith('/icons/') || url.pathname === '/manifest.webmanifest';
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Never touch non-GET requests (server actions are POSTs, mutations,
  // etc.) — always go straight to the network.
  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);

  // Navigations: network-first, offline-fallback on failure. Never cache
  // the (authed, per-family) HTML response itself.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match(OFFLINE_URL).then((cached) => cached || Response.error())
      )
    );
    return;
  }

  // Static, immutable-ish assets: cache-first, network fallback (and
  // backfill the cache on a network hit).
  if (isCacheFirstAsset(url)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        });
      })
    );
    return;
  }

  // Everything else (API routes, other assets, etc.): no caching, just
  // fall through to the default network fetch.
});
