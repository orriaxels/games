// Offline support. When online, always fetch the newest files (skipping the browser's
// own cache) and keep a copy; when offline or very slow, use the copy instead.
const CACHE = 'leikir-v12';
const FONT_CACHE = 'leikir-fonts';   // Google Fonts, kept across versions
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];
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
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== FONT_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;

  // Fonts never change at the same address: use the saved copy, fetch once otherwise.
  if (FONT_HOSTS.includes(url.hostname)) {
    e.respondWith(caches.open(FONT_CACHE).then(async (cache) => {
      const hit = await cache.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok || res.type === 'opaque') cache.put(e.request, res.clone());
      return res;
    }));
    return;
  }
  if (url.origin !== location.origin) return;
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
