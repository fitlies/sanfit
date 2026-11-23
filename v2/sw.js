// Service worker: push notifications, and a copy of the app's own files so Sanfit opens with no connection.
const APP_CACHE = "sanfit-v2-app"; // v2 lives in /v2/ beside the live app; its own cache keeps the two apart
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

// The app's own files (its library is one of them, in vendor/): the network first, so updates arrive as before; the saved copy when offline.
// shortcut: no timeout, so on a very weak signal the app waits for the network; add one if opening feels slow.
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(caches.open(APP_CACHE).then(async (cache) => {
    try {
      // The app's own files always check with the server (a tiny "not changed" reply when they haven't), so a new
      // index.html never runs with an old app.js the phone kept from before.
      const res = await fetch(e.request, { cache: "no-cache" });
      if (res.ok) cache.put(e.request, res.clone());
      return res;
    } catch {
      return (await cache.match(e.request, { ignoreSearch: true })) ?? Response.error();
    }
  }));
});

self.addEventListener("push", (e) => {
  const d = e.data ? e.data.json() : {};
  e.waitUntil(self.registration.showNotification(d.title || "Sanfit", {
    body: d.body || "New message",
    icon: "icon-192.png",
    tag: "sanfit-chat",
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window" }).then((cs) =>
    cs.length ? cs[0].focus() : self.clients.openWindow("./")));
});
