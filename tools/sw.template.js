/* Alcancía: funciona sin internet. Este archivo lo genera tools/build-web.py. */
const CACHE = "alcancia-__VERSION__";
const FILES = [
  __FILES__
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith("alcancia-") && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  // La página: primero la red (para recibir actualizaciones), si no hay, la copia guardada.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put("index.html", copy)); return r; })
        .catch(() => caches.match("index.html"))
    );
    return;
  }
  // Lo demás (fuentes, íconos, código): primero la copia guardada.
  e.respondWith(caches.match(req).then(hit => hit || fetch(req)));
});
