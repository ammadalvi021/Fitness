/**
 * FitFusion AI service worker.
 *
 * Caching strategy:
 * - /api/*           -> network only, NEVER cached.
 * - static assets    -> cache-first (/_next/static, /icons, /brand, images/fonts).
 * - navigations      -> network-first, fall back to cached page, then /offline.
 */

const VERSION = "ff-v1";
const STATIC_CACHE = `${VERSION}-static`;
const PAGE_CACHE = `${VERSION}-pages`;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(PAGE_CACHE)
      .then((cache) => cache.add("/offline"))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => !k.startsWith(VERSION))
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

function isStaticAsset(pathname) {
  return (
    pathname.startsWith("/_next/static/") ||
    pathname.startsWith("/icons/") ||
    pathname.startsWith("/brand/") ||
    /\.(png|jpg|jpeg|gif|webp|svg|ico|woff2?|ttf|otf)$/i.test(pathname)
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // API calls: always go to the network, never touch the cache.
  if (url.pathname.startsWith("/api/")) return;

  // Static assets: cache-first.
  if (isStaticAsset(url.pathname)) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const hit = await cache.match(request);
        if (hit) return hit;
        try {
          const res = await fetch(request);
          if (res.ok) cache.put(request, res.clone());
          return res;
        } catch (err) {
          throw err;
        }
      })
    );
    return;
  }

  // Page navigations: network-first, then cached page, then /offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(PAGE_CACHE).then((cache) => cache.put(request, copy));
          return res;
        })
        .catch(async () => {
          const cache = await caches.open(PAGE_CACHE);
          const hit = await cache.match(request);
          return hit || cache.match("/offline");
        })
    );
  }
});
