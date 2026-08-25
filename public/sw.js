// The PWA worker is retired. Keeping this small cleanup worker at the old URL lets
// browsers that installed it receive an update, remove its caches and unregister it.
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      self.registration.unregister(),
      caches.keys().then((names) => Promise.all(
        names
          .filter((name) => name.startsWith('anchor-tools-static-') || name.startsWith('anchor-tools-runtime-'))
          .map((name) => caches.delete(name)),
      )),
    ]),
  );
});
