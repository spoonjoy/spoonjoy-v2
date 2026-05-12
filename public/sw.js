// Spoonjoy service worker — push + notificationclick only.
// No caching, no offline. Push payload shape: { title, body, url, icon? }.

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
