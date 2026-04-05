const CACHE_NAME = "fanschedule-v1";

const PRECACHE_URLS = [
  "/",
  "/index.html",
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

// Install: cachea assets principales
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

// Activate: limpia caches viejos
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: network-first para API, cache-first para assets
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // API calls: siempre network, no cachear
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/") ||
      url.pathname.startsWith("/subscriptions") || url.pathname.startsWith("/matches")) {
    return;
  }

  // Assets: cache-first con fallback a network
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        // Cachear respuestas válidas de navegación y assets
        if (response.ok && event.request.method === "GET") {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    }).catch(() => {
      // Offline fallback para navegación
      if (event.request.mode === "navigate") {
        return caches.match("/index.html");
      }
    })
  );
});
