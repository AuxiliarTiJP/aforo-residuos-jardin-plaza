const CACHE_NAME = "jp-aforo-shell-v3";
const STATIC_ASSETS = [
  "/manifest.webmanifest",
  "/logo-jardin-plaza.png",
  "/logo-jardin-plaza-trim.png",
];

async function precacheApplication() {
  const cache = await caches.open(CACHE_NAME);
  const response = await fetch("/", { cache: "reload" });

  if (response.ok) {
    await cache.put("/", response.clone());
    const html = await response.text();
    const discoveredAssets = Array.from(html.matchAll(/(?:src|href)=["']([^"']+)["']/g))
      .map((match) => match[1])
      .filter((path) => path.startsWith("/_next/static/") || path === "/manifest.webmanifest");

    await Promise.allSettled(
      Array.from(new Set([...STATIC_ASSETS, ...discoveredAssets])).map(async (path) => {
        const assetResponse = await fetch(path, { cache: "reload" });
        if (assetResponse.ok) await cache.put(path, assetResponse);
      }),
    );
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(precacheApplication().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(async () => (await caches.match(request)) || (await caches.match("/"))),
    );
    return;
  }

  if (url.pathname.startsWith("/_next/static/") || STATIC_ASSETS.includes(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        });
      }),
    );
    return;
  }

  event.respondWith(
    fetch(request).catch(async () => {
      const cached = await caches.match(request);
      return cached || Response.error();
    }),
  );
});
