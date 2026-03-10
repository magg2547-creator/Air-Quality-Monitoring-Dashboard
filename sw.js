// Air Quality Monitor — Service Worker v2
const CACHE = 'aqm-v2';
const STATIC = [
  './',
  './index.html',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js',
  'https://cdn.jsdelivr.net/npm/flatpickr@4.6.13/dist/flatpickr.min.css',
  'https://cdn.jsdelivr.net/npm/flatpickr@4.6.13/dist/flatpickr.min.js',
  'https://cdn.jsdelivr.net/npm/flatpickr@4.6.13/dist/l10n/th.js',
];

// Install: cache assets individually so one failure doesn't abort all
self.addEventListener('install', e =>
  e.waitUntil(
    caches.open(CACHE).then(cache =>
      Promise.allSettled(STATIC.map(url =>
        cache.add(url).catch(err => console.warn('[SW] Failed to cache:', url, err))
      ))
    ).then(() => self.skipWaiting())
  )
);

self.addEventListener('activate', e =>
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  )
);

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = e.request.url;

  // Google Apps Script — network only (live sensor data), never cache
  if (url.includes('script.google.com')) {
    e.respondWith(
      fetch(e.request).catch(() =>
        new Response('{"error":"offline"}', { headers: { 'Content-Type': 'application/json' } })
      )
    );
    return;
  }

  // Google Fonts — stale-while-revalidate
  if (url.includes('fonts.googleapis.com') || url.includes('fonts.gstatic.com')) {
    e.respondWith(
      caches.open(CACHE).then(async cache => {
        const cached = await cache.match(e.request);
        const fresh = fetch(e.request)
          .then(res => { if (res.ok) cache.put(e.request, res.clone()); return res; })
          .catch(() => cached);
        return cached || fresh;
      })
    );
    return;
  }

  // Static assets — cache first, revalidate in background
  e.respondWith(
    caches.open(CACHE).then(async cache => {
      const cached = await cache.match(e.request);
      if (cached) {
        fetch(e.request).then(res => { if (res.ok) cache.put(e.request, res); }).catch(() => {});
        return cached;
      }
      const res = await fetch(e.request);
      if (res.ok) cache.put(e.request, res.clone());
      return res;
    })
  );
});
