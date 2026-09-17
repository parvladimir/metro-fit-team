// Minimal offline-friendly shell for the PWA. Not an aggressive cache
// strategy — this app is data-heavy and mostly needs a live connection —
// but it lets the app shell (icons, manifest, the last-viewed page) load
// instantly and avoids the bare "no internet" browser error page.
const CACHE_NAME = 'metro-fit-team-shell-v2';
const SHELL_ASSETS = ['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS)).catch(() => undefined)
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => undefined);
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached || caches.match('/')))
  );
});

// ---------------------------------------------------------------------------
// Web Push — chat message notifications. The payload is a small JSON object
// ({ title, body, url }) set by the server in src/lib/server/push.ts; never
// health/fitness data, just a team name + sender + short message preview.
// ---------------------------------------------------------------------------
self.addEventListener('push', (event) => {
  let payload = { title: 'METRO Fit Team', body: '', url: '/team/chat' };
  if (event.data) {
    try {
      payload = { ...payload, ...event.data.json() };
    } catch {
      payload.body = event.data.text();
    }
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: payload.url },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data && event.notification.data.url ? event.notification.data.url : '/team/chat';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsArr) => {
      const existing = clientsArr.find((c) => new URL(c.url).pathname === targetUrl);
      if (existing) return existing.focus();
      const anyClient = clientsArr[0];
      if (anyClient && 'navigate' in anyClient) {
        return anyClient.navigate(targetUrl).then((c) => c && c.focus());
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});
