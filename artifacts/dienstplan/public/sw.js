/*
 * Minimaler Service Worker: App-Shell-Caching als Offline-Grundlage.
 *
 * Strategie:
 * - Navigationen (HTML): Network-first, Fallback auf gecachte App-Shell ("/").
 * - Statische Build-Assets (/assets/, Icons, Manifest): Cache-first —
 *   Vite-Assets sind inhalts-gehasht und damit unveränderlich.
 * - /api-Anfragen werden NIE gecacht (immer Netzwerk) — Live-Daten und
 *   Session-Cookies bleiben unangetastet.
 *
 * Bei jedem Deploy sollte CACHE_VERSION nicht angefasst werden müssen:
 * die Navigation ist network-first und Assets sind gehasht; alte Caches
 * werden bei "activate" aufgeräumt, sobald sich die Version doch ändert.
 */
const CACHE_VERSION = "v1";
const CACHE_NAME = `dienstplan-shell-${CACHE_VERSION}`;
const APP_SHELL = ["/", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  // Kein automatisches skipWaiting: ein neuer Worker wartet, bis der Nutzer
  // im Update-Hinweis "Neu laden" klickt (SKIP_WAITING-Message von der Seite).
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("dienstplan-shell-") && key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put("/", copy));
          return response;
        })
        .catch(() => caches.match("/")),
    );
    return;
  }

  if (
    url.pathname.startsWith("/assets/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/manifest.webmanifest" ||
    url.pathname === "/favicon.svg"
  ) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
  }
});
