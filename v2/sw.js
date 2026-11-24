// The old v2 test copy lived here. Remove its worker (and with it its alert subscription) and its cache,
// and send any window still open on it to the main app.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(
  Promise.all([caches.delete("sanfit-v2-app"), self.registration.unregister()])
    .then(() => self.clients.matchAll({ type: "window", includeUncontrolled: true }))
    .then((cs) => Promise.all(cs.map((c) => c.navigate("../").catch(() => {}))))
    .catch(() => {})));
