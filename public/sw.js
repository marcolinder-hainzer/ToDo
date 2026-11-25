/* Service Worker: zeigt Push-Erinnerungen an und öffnet beim Antippen das passende Todo. */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'Erinnerung', body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Erinnerung', {
      body: data.body || '',
      tag: data.tag || undefined,
      renotify: !!data.tag,
      requireInteraction: true,
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-96.png',
      data: { url: data.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/', self.location.origin);
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).origin === self.location.origin) {
          client.postMessage({ type: 'navigate', hash: target.hash || '#/' });
          return client.focus();
        }
      }
      return self.clients.openWindow(target.href);
    })(),
  );
});
