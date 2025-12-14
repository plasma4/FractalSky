const CACHE_NAME = "fractalsky";
const urlsToCache = [
  "./",
  "./index.html",
  "./main.js",
  "./worker.js",
  "./manifest.json",
  "./fractal.wasm",
  "./fractalUnshared.wasm",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => {
        console.log("SW: Caching app shell");
        return cache.addAll(urlsToCache);
      })
      .then(() => {
        console.log("SW: Forcing immediate activation (skipWaiting).");
        return self.skipWaiting();
      })
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cache) => {
            if (cache !== CACHE_NAME) {
              console.log("SW: Deleting old cache:", cache);
              return caches.delete(cache);
            }
          })
        );
      })
      .then(() => {
        console.log("SW: Claiming clients.");
        return self.clients.claim();
      })
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") {
    return;
  }

  if (!e.request.url.startsWith(self.location.origin)) {
    // Return original fetch for cross-origin requests
    return e.respondWith(fetch(e.request));
  }

  e.respondWith(
    fetch(e.request)
      .then(async (networkResponse) => {
        if (networkResponse.status !== 200) {
          return networkResponse;
        }

        const cacheResponse = networkResponse.clone();
        const bodyResponse = networkResponse.clone();

        // Caching step
        const cache = await caches.open(CACHE_NAME);
        cache.put(e.request, cacheResponse);

        const newHeaders = new Headers(bodyResponse.headers);
        newHeaders.set("Cross-Origin-Opener-Policy", "same-origin");
        newHeaders.set("Cross-Origin-Embedder-Policy", "require-corp");

        const modifiedResponse = new Response(bodyResponse.body, {
          status: bodyResponse.status,
          statusText: bodyResponse.statusText,
          headers: newHeaders,
        });

        return modifiedResponse;
      })
      .catch(async (err) => {
        // Network failed (offline scenario)
        const cachedResponse = await caches.match(e.request);
        if (cachedResponse) {
          return cachedResponse;
        }

        return Response.error();
      })
  );
});
