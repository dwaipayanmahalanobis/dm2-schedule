// DM2 Schedule service worker: keeps the app itself available offline.
// Your schedule and attendance are stored separately (IndexedDB + localStorage) and are never touched here.
// Bump CACHE_VERSION when you publish a new index.html so phones pick it up.
const CACHE_VERSION = 'dm2-v1';
const APP_CACHE = `${CACHE_VERSION}-app`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];

// Libraries the page loads from CDNs; cached on install so the first offline launch works
const CDN_ASSETS = [
  'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/fa-solid-900.woff2',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/fa-regular-400.woff2',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const appCache = await caches.open(APP_CACHE);
    await appCache.addAll(APP_SHELL);

    // CDN files are best effort: a failure here must not block installing the app
    const runtime = await caches.open(RUNTIME_CACHE);
    await Promise.all(CDN_ASSETS.map(async (url) => {
      try {
        const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
        if (res.ok) await runtime.put(url, res);
      } catch (e) { /* offline during install; cached on first use instead */ }
    }));

    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => !k.startsWith(CACHE_VERSION)).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Never cache cloud-sync traffic
  if (/firestore|identitytoolkit|securetoken|googleapis\.com\/(identitytoolkit|v1)/.test(url.href) ||
      url.hostname.endsWith('gstatic.com') && url.pathname.includes('firebasejs')) {
    return;
  }

  // The page itself: network first (so updates arrive), cached copy when offline
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(APP_CACHE);
        cache.put('./index.html', fresh.clone());
        return fresh;
      } catch (e) {
        return (await caches.match('./index.html')) || (await caches.match('./')) || Response.error();
      }
    })());
    return;
  }

  // Everything else (icons, fonts, libraries): cache first, then network, and remember it
  event.respondWith((async () => {
    const cached = await caches.match(req, { ignoreVary: true }) || await caches.match(req.url, { ignoreVary: true });
    if (cached) return cached;
    try {
      const res = await fetch(req);
      if (res && (res.ok || res.type === 'opaque')) {
        const cache = await caches.open(url.origin === self.location.origin ? APP_CACHE : RUNTIME_CACHE);
        cache.put(req, res.clone());
      }
      return res;
    } catch (e) {
      return cached || Response.error();
    }
  })());
});
