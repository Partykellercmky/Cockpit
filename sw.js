// Cockpit Service Worker: App-Huelle offline verfuegbar, data.json immer frisch vom Netz.
const CACHE = "cockpit-v15";
const SHELL = ["./", "index.html", "style.css", "app.js", "features.js", "layout.js", "data.json", "manifest.webmanifest", "icon-192.png", "apple-touch-icon.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  // Netz zuerst, damit Aenderungen sofort ankommen; ohne Netz aus dem Cache
  // immer am Browser-Cache vorbei frisch laden, damit Updates sofort ankommen
  e.respondWith(fetch(e.request.url, { cache: "no-cache" }).then(r => {
    const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r;
  }).catch(() => caches.match(e.request)));
});
