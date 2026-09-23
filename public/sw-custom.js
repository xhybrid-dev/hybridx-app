// Custom service worker code for notifications and auth handling
// This will be imported into the main service worker

// CRITICAL FIX: Prevent caching of Firebase Auth and session endpoints
// Firebase auth responses should NEVER be cached
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // List of endpoints that should NEVER be cached (auth-related)
  const noCachePatterns = [
    /firebaseapp\.com.*\/auth\//,
    /googleapis\.com.*\/identitytoolkit/,
    /securetoken\.googleapis\.com/,
    /\/api\/auth\//,  // Your session cookie endpoint
  ];

  // Check if this request matches any no-cache patterns
  const shouldNotCache = noCachePatterns.some(pattern => pattern.test(event.request.url));

  if (shouldNotCache) {
    // Force network-only for auth endpoints, bypass cache completely
    event.respondWith(
      fetch(event.request, { cache: 'no-store' })
        .catch(err => {
          console.error('Auth request failed:', err);
          return new Response('Network error', { status: 503 });
        })
    );
    return;
  }

  // For all other requests, let the default service worker handle it
});

// Push notification event
self.addEventListener('push', (event) => {
  console.log('Push notification received:', event);

  let data = {
    title: 'HYBRIDX Workout',
    body: 'Time to train!',
    icon: '/icon-maskable-192.png',
    badge: '/icon-maskable-192.png',
  };

  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      console.error('Error parsing push data:', e);
    }
  }

  const options = {
    body: data.body,
    icon: data.icon || '/icon-maskable-192.png',
    badge: data.badge || '/icon-maskable-192.png',
    vibrate: [200, 100, 200],
    data: {
      url: data.url || '/dashboard',
      dateOfArrival: Date.now(),
    },
    actions: [
      {
        action: 'view',
        title: 'View Workout',
      },
      {
        action: 'close',
        title: 'Dismiss',
      },
    ],
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// Notification click event
self.addEventListener('notificationclick', (event) => {
  console.log('Notification clicked:', event);

  event.notification.close();

  if (event.action === 'view' || !event.action) {
    const urlToOpen = event.notification.data?.url || '/dashboard';

    event.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
        // Check if there's already a window open
        for (const client of clientList) {
          if (client.url.includes(urlToOpen.split('?')[0]) && 'focus' in client) {
            return client.focus();
          }
        }
        // If no window is open, open a new one
        if (self.clients.openWindow) {
          return self.clients.openWindow(urlToOpen);
        }
      })
    );
  }
});
