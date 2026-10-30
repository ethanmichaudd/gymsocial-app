/* Cache the app shell so it opens with no connection. Bump CACHE on release. */
const CACHE = "gymsocial-v12";

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    // cache-bust the shell so a new worker never stores a stale copy
    caches.open(CACHE).then((c) => c.add(new Request("./", { cache: "reload" })))
  );
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
  const { request } = event;
  if (request.method !== "GET") return;

  // Navigations: network first, fall back to the cached shell when offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("./", { ignoreSearch: true }))
    );
    return;
  }

  // Everything else: serve from cache, refill in the background.
  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ||
        fetch(request).then((res) => {
          const copy = res.clone();
          if (res.ok && new URL(request.url).origin === location.origin) {
            caches.open(CACHE).then((c) => c.put(request, copy));
          }
          return res;
        })
    )
  );
});
