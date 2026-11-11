/* Cache the app shell so it opens with no connection. Bump CACHE on release. */
const CACHE = "gymsocial-v46";

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
  // Supabase (accounts, sync, photos) always goes straight to the network
  if (new URL(request.url).origin !== location.origin) return;

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

/* ---------- push notifications ----------
   The "notify" Edge Function sends { title, body, url, tag }. url is relative
   to the app (e.g. "?workout=<id>"), so it works on GitHub Pages and locally. */
self.addEventListener("push", (event) => {
  let note = {};
  try { note = event.data ? event.data.json() : {}; } catch (e) { note = { body: event.data && event.data.text() }; }
  event.waitUntil(
    self.registration.showNotification(note.title || "GymSocial", {
      body: note.body || "",
      tag: note.tag,                         // same tag replaces, so reactions don't pile up
      icon: "icon-192.png",
      badge: "icon-192.png",
      data: { url: note.url || "./" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data.url || "./", self.registration.scope).href;
  event.waitUntil((async () => {
    const open = await clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of open) {
      if (c.url.startsWith(self.registration.scope)) {
        // the app is already running: tell it what to show, then bring it up
        c.postMessage({ type: "open-url", url: target });
        return c.focus();
      }
    }
    return clients.openWindow(target);
  })());
});
