'use client'

import { useEffect, useState } from 'react'
import { WifiIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline'
import { cn } from '@/lib/utils'

export function NetworkStatus() {
  const [isOnline, setIsOnline] = useState(true)
  const [showStatus, setShowStatus] = useState(false)

  useEffect(() => {
    // Check initial online status
    setIsOnline(navigator.onLine)

    // Event handlers
    const handleOnline = () => {
      setIsOnline(true)
      setShowStatus(true)
      // Hide the status after 3 seconds when back online
      setTimeout(() => setShowStatus(false), 3000)
    }

    const handleOffline = () => {
      setIsOnline(false)
      setShowStatus(true)
    }

    // Add event listeners
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    // Show offline status immediately if offline
    if (!navigator.onLine) {
      setShowStatus(true)
    }

    // Cleanup
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  if (!showStatus) return null

  return (
    <div
      className={cn(
        'fixed top-0 left-0 right-0 z-50 flex items-center justify-center px-4 py-2 text-sm font-medium transition-all duration-300',
        isOnline
          ? 'bg-green-600 text-white'
          : 'bg-red-600 text-white'
      )}
    >
      <div className="flex items-center gap-2">
        {isOnline ? (
          <>
            <WifiIcon className="h-4 w-4" />
            <span>Back online</span>
          </>
        ) : (
          <>
            <ExclamationTriangleIcon className="h-4 w-4" />
            <span>No internet connection</span>
          </>
        )}
      </div>
    </div>
  )
}

// Hook to use network status in components
export function useNetworkStatus() {
  const [isOnline, setIsOnline] = useState(true)

  useEffect(() => {
    setIsOnline(navigator.onLine)

    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  return isOnline
}