const CACHE_NAME = "fractalsky"
const urlsToCache = [
    "/",
    "/index.html",
    "/LICENSE",
    "/main.js",
    "/worker.js",
    "/manifest.json",
    "/fractal.wasm",
    "/fractalUnshared.wasm"
]

self.addEventListener("install", e => {
    e.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log("Service Worker: Caching app shell")
                return cache.addAll(urlsToCache)
            })
            .then(() => {
                console.log("Service Worker: Forcing immediate activation (skipWaiting).")
                return self.skipWaiting()
            })
    )
})

self.addEventListener("activate", event => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cache => {
                    if (cache !== CACHE_NAME) {
                        console.log("Service Worker: Deleting old cache:", cache)
                        return caches.delete(cache)
                    }
                })
            )
        }).then(() => {
            console.log("Service Worker: Claiming clients.")
            return self.clients.claim()
        })
    )
})


self.addEventListener("fetch", e => {
    // Only handle GET requests
    if (e.request.method !== "GET") {
        return
    }

    e.respondWith(
        fetch(e.request)
            .then(async (networkResponse) => {
                const responseClone = networkResponse.clone()
                const cache = await caches.open(CACHE_NAME)
                cache.put(e.request, responseClone)
                return networkResponse
            })
            .catch(async (err) => {
                console.log("Service Worker: Network fetch failed for", e.request.url, "serving from cache.")
                const cachedResponse = await caches.match(e.request)

                if (cachedResponse) {
                    return cachedResponse
                }

                console.error(err)
                return Response.error()
            })
    )
});