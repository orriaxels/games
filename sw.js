// Offline support. When online, always fetch the newest files (skipping the browser's
// own cache) and keep a copy; when offline or very slow, use the copy instead.
const CACHE = 'leikir-v15';
const NETWORK_TIMEOUT_MS = 4000;
const ASSETS = [
  './',
  'index.html',
  'common.css',
  'common.js',
  'manifest.json',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
  'icons/namuleit.png',
  'icons/sudoku.png',
  'icons/reiknigata.png',
  'namuleit/',
  'namuleit/index.html',
  'namuleit/style.css',
  'namuleit/game.js',
  'sudoku/',
  'sudoku/index.html',
  'sudoku/style.css',
  'sudoku/game.js',
  'reiknigata/',
  'reiknigata/index.html',
  'reiknigata/style.css',
  'reiknigata/game.js',
  'leaderboard-config.js',
  'leaderboard.js',
  'stigatafla/',
  'stigatafla/index.html',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const network = fetch(new Request(url.href, { cache: 'no-cache', credentials: 'same-origin' }))
      .then((res) => {
        if (res.ok) cache.put(e.request, res.clone());
        return res;
      });
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), NETWORK_TIMEOUT_MS));
    try {
      return await Promise.race([network, timeout]);
    } catch {
      const cached = await cache.match(e.request, { ignoreSearch: true });
      return cached || network;
    }
  })());
});
