// Minimal service worker: cache the app shell for offline launch, but always go
// to the network first for API calls (logging, state, Claude) so data is fresh.
var CACHE = "daybloom-v1";
var SHELL = ["/", "/index.html", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/apple-touch-icon.png"];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener("fetch", function (e) {
  var url = new URL(e.request.url);
  if (e.request.method !== "GET") return;                 // never cache POSTs
  if (url.pathname.indexOf("/api/") === 0 || url.pathname.indexOf("/uploads/") === 0) return; // network only
  // App shell: cache-first, fall back to network, then update the cache.
  e.respondWith(
    caches.match(e.request).then(function (hit) {
      var net = fetch(e.request).then(function (res) {
        if (res && res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(e.request, copy); }); }
        return res;
      }).catch(function () { return hit; });
      return hit || net;
    })
  );
});
