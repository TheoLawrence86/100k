/* Network-first service worker: the app always prefers fresh data, but the
   shell keeps working offline (e.g. mid-trail with no signal). */
const CACHE = "tpu-journal-9";
const SHELL = [
  "/",
  "/journal",
  "/index.html",
  "/splash.html",
  "/styles.css?v=journal-6",
  "/js/main.js?v=journal-6",
  "/assets/badge.png",
  "/assets/hero-thames.jpg",
  "/assets/runner.png",
  "/js/api.js",
  "/js/state.js",
  "/js/charts.js",
  "/js/views.js",
  "/js/route.js",
  "/js/mapstyle.js",
  "/manifest.webmanifest",
  "/assets/icon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  // API calls go straight to the network: caching them serves stale data,
  // and a cache miss after a network error surfaces as a bare
  // "Failed to fetch" that hides the real problem.
  if (new URL(event.request.url).pathname.startsWith("/api/")) return;
  event.respondWith(
    // cache: "no-cache" revalidates with the server (ETag) so a new deploy
    // is picked up on the next load instead of being pinned by the HTTP cache.
    fetch(event.request, { cache: "no-cache" })
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy)).catch(() => {});
        return response;
      })
      .catch(() => caches.match(event.request, { ignoreSearch: false }))
  );
});
