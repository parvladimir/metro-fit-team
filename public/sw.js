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

  const tasks = [
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      // Same tag = a newer notification for the same event replaces the old one.
      tag: payload.tag || undefined,
      renotify: !!payload.tag,
      data: { url: payload.url },
    }),
  ];

  // App icon badge for personal (reaction/reply) notifications where the
  // Badging API exists in the service worker — feature-detected, optional.
  if (typeof payload.badgeCount === 'number' && self.navigator && 'setAppBadge' in self.navigator) {
    tasks.push(self.navigator.setAppBadge(payload.badgeCount).catch(() => undefined));
  }

  event.waitUntil(Promise.all(tasks));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const rawUrl = event.notification.data && event.notification.data.url ? event.notification.data.url : '/team/chat';
  // Only ever open same-origin paths.
  const targetUrl = rawUrl.startsWith('/') && !rawUrl.startsWith('//') ? rawUrl : '/team/chat';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsArr) => {
      const sameOrigin = clientsArr.find((c) => new URL(c.url).origin === self.location.origin);
      if (sameOrigin && 'navigate' in sameOrigin) {
        return sameOrigin.navigate(targetUrl).then((c) => (c || sameOrigin).focus());
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});
