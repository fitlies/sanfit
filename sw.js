// Service worker: only shows push notifications. No offline cache (shortcut: app needs a connection, add caching if that bites).
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
