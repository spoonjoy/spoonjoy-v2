// Spoonjoy service worker — push + notificationclick + offline-page fallback.
// Push payload shape: { title, body, url, icon? }.

var OFFLINE_CACHE = 'spoonjoy-offline-v1';
var OFFLINE_URL = '/offline.html';

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(OFFLINE_CACHE).then(function (cache) {
      // Bypass HTTP cache so deploys always fetch the latest offline page.
      return cache.add(new Request(OFFLINE_URL, { cache: 'reload' }));
    }),
  );
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.map(function (key) {
          if (key !== OFFLINE_CACHE) return caches.delete(key);
          return undefined;
        }),
      );
    }).then(function () {
      return self.clients.claim();
    }),
  );
});

self.addEventListener('fetch', function (event) {
  // Only intercept top-level navigation GETs. Everything else (assets,
  // API calls) goes straight to the network as before.
  if (event.request.mode !== 'navigate') return;
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request).catch(function () {
      return caches.match(OFFLINE_URL).then(function (cached) {
        return cached || new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
      });
    }),
  );
});

self.addEventListener('push', function (event) {
  if (!event.data) return;
  var data;
  try {
    data = event.data.json();
  } catch (_) {
    return;
  }
  if (!data || typeof data !== 'object') return;
  var title = data.title || 'Spoonjoy';
  var options = {
    body: data.body || '',
    icon: data.icon || '/logos/sj_black.svg',
    data: { url: data.url || '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(function (wins) {
        for (var i = 0; i < wins.length; i++) {
          if (wins[i].url && wins[i].url.endsWith(url)) {
            return wins[i].focus();
          }
        }
        return clients.openWindow(url);
      }),
  );
});
