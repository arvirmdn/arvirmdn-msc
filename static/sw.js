// Service worker ARVIRMDN MUSIKIN — cache app shell (HTML/CSS/JS/ikon) saja.
// Endpoint /api/* (search, stream, home, info) SENGAJA tidak di-cache karena
// selalu butuh data terbaru / stream audio langsung dari server.

const CACHE_NAME = "musikin-shell-v3";

const SHELL_FILES = [
  "./",
  "./index.html",
  "./style.css?v=8",
  "./app.js?v=7",
  "./favicon.svg",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Jangan sentuh request ke API (search/stream/home/info) — selalu network.
  if (url.pathname.startsWith("/api/")) {
    return;
  }

  // Hanya tangani GET request untuk file shell sendiri.
  if (event.request.method !== "GET" || url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((response) => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
