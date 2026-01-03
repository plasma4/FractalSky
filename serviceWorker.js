const CACHE_NAME = "fractalsky";
const urlsToCache = [
  "./",
  "./index.html",
  "./main.js",
  "./worker.js",
  "./manifest.json",
  "./fractal.wasm",
  "./favicon.ico",
];

const addHeaders = (response) => {
  if (!response) return response;

  const newHeaders = new Headers(response.headers);
  newHeaders.set("Cross-Origin-Opener-Policy", "same-origin");
  newHeaders.set("Cross-Origin-Embedder-Policy", "require-corp");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
};

self.addEventListener("install", (e) => {
  self.skipWaiting(); // Activate immediately
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log("SW: Pre-caching app shell");
      return cache.addAll(urlsToCache);
    })
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    Promise.all([
      clients.claim(), // Take control of all pages immediately
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cache) => {
            if (cache !== CACHE_NAME) {
              console.log("SW: Deleting old cache:", cache);
              return caches.delete(cache);
            }
          })
        );
      }),
    ])
  );
});

self.addEventListener("message", (event) => {
  if (event.data === 1) {
    self.clients.claim();
  }
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") {
    return e.respondWith(fetch(e.request)); // Not from this origin
  }

  e.respondWith(
    (async () => {
      try {
        const networkResponse = await fetch(e.request);
        if (networkResponse.status === 200) {
          const cacheCopy = networkResponse.clone();
          const cache = await caches.open(CACHE_NAME);
          cache.put(e.request, cacheCopy);
        }

        return addHeaders(networkResponse);

      } catch (err) {
        const cachedResponse = await caches.match(e.request);
        if (cachedResponse) {
          return addHeaders(cachedResponse);
        }

        return Response.error();
      }
    })()
  );
});