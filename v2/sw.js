// The old v2 test copy lived here. Remove its worker (and with it its alert subscription) and send open windows to the main app.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(
  self.registration.unregister()
    .then(() => self.clients.matchAll({ type: "window" }))
    .then((cs) => cs.forEach((c) => c.navigate("../")))));
