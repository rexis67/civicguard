const CACHE_NAME = "civicguard-pwa-v1";
const STATIC_ASSETS = [
  "/",
  "/manifest.webmanifest",
  "/favicon.svg",
  "/icon-192.svg",
  "/icon-512.svg",
  "/fonts/geist-latin.woff2",
  "/fonts/space-grotesk-latin.woff2",
  "/fonts/jetbrains-mono-latin.woff2",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) return caches.delete(key);
          return null;
        }),
      ),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 1. Let non-GET requests pass through to the network
  if (request.method !== "GET") {
    return;
  }

  // 2. Map tiles: Cache-first for buttery smooth offline/cached maps
  if (url.hostname.includes("cartocdn.com") || url.hostname.includes("openstreetmap.org")) {
    event.respondWith(
      caches.open("civicguard-tiles").then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        try {
          const response = await fetch(request);
          if (response.ok) cache.put(request, response.clone());
          return response;
        } catch {
          return new Response("", { status: 408, statusText: "Offline tile unavailable" });
        }
      }),
    );
    return;
  }

  // 3. API requests: Network-first, fallback to offline JSON
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(
      fetch(request).catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        return new Response(
          JSON.stringify({ offline: true, error: "Network connection unavailable. Operating in offline mode." }),
          {
            status: 503,
            headers: { "Content-Type": "application/json" },
          },
        );
      }),
    );
    return;
  }

  // 4. App Shell & Static assets: Stale-while-revalidate / Network-fallback-to-cache
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      const fetchPromise = fetch(request)
        .then((networkResponse) => {
          if (networkResponse.ok && request.url.startsWith("http")) {
            caches.open(CACHE_NAME).then((cache) => cache.put(request, networkResponse.clone()));
          }
          return networkResponse;
        })
        .catch(() => cachedResponse || caches.match("/"));

      return cachedResponse || fetchPromise;
    }),
  );
});
