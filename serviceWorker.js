const CACHE_NAME = "fractal-wasm-cache-v1" // Tip: Change the cache name when you make big updates to invalidate old caches.
const urlsToCache = [
    "/",
    "/index.html",
    "/LICENSE",
    "/main.js",
    "/worker.js", // worker.js should also be cached
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
                // This is the key to forcing updates. It tells the new worker
                // to become active immediately, not wait for old tabs to close.
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
            // This tells the activated worker to take control of all open clients (tabs) immediately.
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
        // First, try to fetch the resource from the network.
        fetch(e.request)
            .then(async (networkResponse) => {
                // Clone the response then open our cache and put the new response in it for next time.
                const responseClone = networkResponse.clone()
                const cache = await caches.open(CACHE_NAME)
                cache.put(e.request, responseClone)

                // Return the fresh response from the network!
                return networkResponse
            })
            .catch(async (err) => {
                // If the network request fails (e.g., user is offline),
                // we then try to find a match in the cache.
                console.log("Service Worker: Network fetch failed for", e.request.url, "serving from cache.")
                const cachedResponse = await caches.match(e.request)

                if (cachedResponse) {
                    return cachedResponse
                }

                console.error("Service Worker: No network and no cache available for", err.request.url)
                return Response.error()
            })
    )
});