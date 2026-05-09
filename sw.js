// ─── Crawley Croquet Club — Service Worker ───────────────────────────────────
// Strategy:
//   • App shell (HTML, CSS, local assets) → Cache-first, falling back to network
//   • Firebase SDK & API calls           → Network-first, falling back to cache
//   • Everything else                    → Network-first, no cache fallback
//
// Bump CACHE_VERSION whenever you deploy a meaningful update to force old
// caches to be cleared on the next visit.
// ─────────────────────────────────────────────────────────────────────────────

const CACHE_VERSION  = 'ccc-v4';
const SHELL_CACHE    = `${CACHE_VERSION}-shell`;
const DYNAMIC_CACHE  = `${CACHE_VERSION}-dynamic`;

// Resources to pre-cache on install (the app shell).
const SHELL_URLS = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

// Domains whose requests should always go network-first.
const NETWORK_FIRST_HOSTS = [
  'firestore.googleapis.com',
  'firebase.googleapis.com',
  'fcmregistrations.googleapis.com',   // FCM token registration
  'fcm.googleapis.com',                // FCM message delivery
  'identitytoolkit.googleapis.com',
  'www.gstatic.com',           // Firebase SDK CDN
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'maps.googleapis.com',
  'maps.gstatic.com',
];


// ─── Install ─────────────────────────────────────────────────────────────────

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(function (cache) {
        return cache.addAll(SHELL_URLS);
      })
      .then(function () {
        // Activate immediately rather than waiting for existing tabs to close.
        return self.skipWaiting();
      })
  );
});


// ─── Activate ────────────────────────────────────────────────────────────────

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(
          keys
            .filter(function (key) {
              // Delete caches from previous versions.
              return key.startsWith('ccc-') && key !== SHELL_CACHE && key !== DYNAMIC_CACHE;
            })
            .map(function (key) { return caches.delete(key); })
        );
      })
      .then(function () {
        // Take control of all open clients immediately.
        return self.clients.claim();
      })
  );
});


// ─── Fetch ───────────────────────────────────────────────────────────────────

self.addEventListener('fetch', function (event) {
  var url = new URL(event.request.url);

  // Never intercept non-GET requests (POST to Firebase etc.).
  if (event.request.method !== 'GET') return;

  // Network-first for Firebase and third-party hosts.
  if (NETWORK_FIRST_HOSTS.some(function (host) { return url.hostname === host; })) {
    event.respondWith(networkFirst(event.request, DYNAMIC_CACHE));
    return;
  }

  // Cache-first for same-origin requests (the app shell).
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(event.request, SHELL_CACHE));
    return;
  }

  // Default: network only (e.g. Unsplash hero image).
  // Falls through — browser handles it normally.
});


// ─── Strategies ──────────────────────────────────────────────────────────────

function cacheFirst(request, cacheName) {
  return caches.match(request)
    .then(function (cached) {
      if (cached) return cached;
      return fetch(request)
        .then(function (response) {
          if (response && response.status === 200) {
            var clone = response.clone();
            caches.open(cacheName).then(function (cache) { cache.put(request, clone); });
          }
          return response;
        });
    });
}

function networkFirst(request, cacheName) {
  return fetch(request)
    .then(function (response) {
      if (response && response.status === 200) {
        var clone = response.clone();
        caches.open(cacheName).then(function (cache) { cache.put(request, clone); });
      }
      return response;
    })
    .catch(function () {
      return caches.match(request);
    });
}


// ─── Push Notifications ──────────────────────────────────────────────────────

self.addEventListener('push', function (event) {
  var data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) {}

  var title   = data.title || 'Crawley Croquet Club';
  var options = {
    body:    data.body  || 'New club update',
    icon:    './icons/icon-192.png',
    badge:   './icons/icon-192.png',
    tag:     data.tag   || 'ccc-notification',
    renotify: true,
    data:    {
      url:   data.url || './#calendar',
      // Store full event data so notificationclick can post it to the page.
      event: data.event || null,
    },
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();

  var notifData = event.notification.data || {};
  var targetUrl = notifData.url || './#calendar';
  var eventData = notifData.event || null;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(function (clientList) {
        // If the site is already open, focus it and post event data directly.
        for (var i = 0; i < clientList.length; i++) {
          var client = clientList[i];
          if ('focus' in client) {
            client.focus();
            // Post the event data to the page — avoids URL parameter issues.
            if (eventData) {
              client.postMessage({ type: 'NOTIFICATION_EVENT', event: eventData });
            }
            return;
          }
        }
        // Site not open — open it. Store event data in SW so the page can
        // retrieve it on load via a subsequent message.
        var openPromise = clients.openWindow(targetUrl);
        if (eventData) {
          openPromise.then(function (newClient) {
            if (newClient) {
              // Give the page time to load before posting.
              setTimeout(function () {
                newClient.postMessage({ type: 'NOTIFICATION_EVENT', event: eventData });
              }, 2000);
            }
          });
        }
        return openPromise;
      })
  );
});
