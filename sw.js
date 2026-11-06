/* Escadre — service worker : garde l'appli en mémoire pour l'ouvrir même sans réseau.
   ⚠️ Change VERSION à chaque mise à jour, sinon les téléphones gardent l'ancienne. */
const VERSION = "v1.0.0";
const CACHE = "escadre-" + VERSION;
const FICHIERS = [
  "./", "./index.html", "./style.css", "./manifest.json",
  "./js/regles.js", "./js/sons.js", "./js/reseau.js", "./js/app.js",
  "./vendor/peerjs-1.5.5.min.js",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FICHIERS)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((cles) => Promise.all(cles.filter((c) => c !== CACHE).map((c) => caches.delete(c))))
  );
  self.clients.claim();
});

// Fichiers de l'appli : d'abord la mémoire (rapide), sinon le réseau.
// Le reste (serveur de rendez-vous PeerJS) passe toujours par le réseau.
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((r) => r || fetch(e.request))
  );
});
