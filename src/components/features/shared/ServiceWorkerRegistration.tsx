'use client'

import { useEffect } from 'react'

const LEGACY_CACHE_PREFIXES = ['anchor-tools-static-', 'anchor-tools-runtime-']

/** Remove the retired PWA worker and the response caches it left behind. */
export function ServiceWorkerCleanup() {
  useEffect(() => {
    async function removeLegacyWorker(): Promise<void> {
      try {
        if ('serviceWorker' in navigator) {
          const registrations = await navigator.serviceWorker.getRegistrations()
          await Promise.all(
            registrations
              .filter((registration) => {
                const worker = registration.active ?? registration.waiting ?? registration.installing
                if (!worker || !registration.scope.startsWith(window.location.origin)) return false
                try {
                  return new URL(worker.scriptURL).pathname === '/sw.js'
                } catch {
                  return false
                }
              })
              .map((registration) => registration.unregister()),
          )
        }

        if ('caches' in window) {
          const names = await caches.keys()
          await Promise.all(
            names
              .filter((name) => LEGACY_CACHE_PREFIXES.some((prefix) => name.startsWith(prefix)))
              .map((name) => caches.delete(name)),
          )
        }
      } catch {
        // Cleanup is best-effort and must not interrupt the app.
      }
    }

    void removeLegacyWorker()
  }, [])

  return null
}
