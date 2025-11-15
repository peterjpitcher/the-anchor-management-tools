'use client'

import { useEffect } from 'react'

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      // Only register in production
      if (process.env.NODE_ENV === 'production') {
        window.addEventListener('load', () => {
          navigator.serviceWorker
            .register('/sw.js')
            .then((registration) => {
              console.log('Service Worker registered:', registration)

              // Trigger a single update check after registration
              registration.update().catch(() => {
                // Ignore update failures; they'll retry on next navigation
              })
            })
            .catch((error) => {
              console.error('Service Worker registration failed:', error)
            })
        })
      }
    }
  }, [])

  return null
}
