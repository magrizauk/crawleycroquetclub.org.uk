// ─── Crawley Croquet Club — Firebase Messaging Service Worker ────────────────
// This file MUST be named firebase-messaging-sw.js and served from the root.
// FCM uses it specifically to deliver push notifications when the site is closed.
// ─────────────────────────────────────────────────────────────────────────────

importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey:            'AIzaSyCNF0Frimcii1tdnP9bQRodKUcI8uLJst0',
  authDomain:        'crawley-croquet-club.firebaseapp.com',
  projectId:         'crawley-croquet-club',
  storageBucket:     'crawley-croquet-club.firebasestorage.app',
  messagingSenderId: '460114961964',
  appId:             '1:460114961964:web:48df356888cd2d058d1389',
});

const messaging = firebase.messaging();

// Handle background messages — fires when the site is closed or in background.
messaging.onBackgroundMessage(function (payload) {
  var title   = (payload.notification && payload.notification.title) || 'Crawley Croquet Club';
  var body    = (payload.notification && payload.notification.body)  || 'New club update';

  self.registration.showNotification(title, {
    body:      body,
    icon:      './icons/icon-192.png',
    badge:     './icons/icon-192.png',
    tag:       'ccc-notification',
    renotify:  true,
    data:      { url: 'https://magrizauk.github.io/crawleycroquetclub.org.uk/#calendar' },
  });
});

// Handle notification tap — focus existing window or open a new one.
self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var targetUrl = (event.notification.data && event.notification.data.url)
    ? event.notification.data.url
    : 'https://magrizauk.github.io/crawleycroquetclub.org.uk/#calendar';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(function (clientList) {
        for (var i = 0; i < clientList.length; i++) {
          var client = clientList[i];
          if ('focus' in client) {
            client.focus();
            return;
          }
        }
        if (clients.openWindow) return clients.openWindow(targetUrl);
      })
  );
});
