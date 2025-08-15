'use client'

import { useState, useEffect } from 'react'
import { XMarkIcon, ArrowDownTrayIcon } from '@heroicons/react/24/outline'
import { cn } from '@/lib/utils'

export function InstallPrompt() {
  const [showPrompt, setShowPrompt] = useState(false)
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null)
  const [isIOS, setIsIOS] = useState(false)
  const [isStandalone, setIsStandalone] = useState(false)

  useEffect(() => {
    // Check if already installed
    const standalone = window.matchMedia('(display-mode: standalone)').matches || 
                      (window.navigator as any).standalone ||
                      document.referrer.includes('android-app://');
    setIsStandalone(standalone)

    // Check if iOS
    const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream
    setIsIOS(iOS)

    // Check if prompt was previously dismissed
    const promptDismissed = localStorage.getItem('installPromptDismissed')
    const dismissedTime = promptDismissed ? parseInt(promptDismissed) : 0
    const daysSinceDismissed = (Date.now() - dismissedTime) / (1000 * 60 * 60 * 24)

    // Show prompt if not installed and not recently dismissed (7 days)
    if (!standalone && daysSinceDismissed > 7) {
      // For iOS, show custom prompt after 10 seconds
      if (iOS) {
        setTimeout(() => setShowPrompt(true), 10000)
      }
    }

    // Listen for beforeinstallprompt event (Android/Desktop Chrome)
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e)
      
      // Show prompt after 10 seconds
      setTimeout(() => setShowPrompt(true), 10000)
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)

    // Listen for app installed event
    const handleAppInstalled = () => {
      setShowPrompt(false)
      setDeferredPrompt(null)
    }

    window.addEventListener('appinstalled', handleAppInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
      window.removeEventListener('appinstalled', handleAppInstalled)
    }
  }, [])

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      // Show the install prompt
      deferredPrompt.prompt()
      
      // Wait for the user to respond
      const { outcome } = await deferredPrompt.userChoice
      
      if (outcome === 'accepted') {
        console.log('User accepted the install prompt')
      }
      
      setDeferredPrompt(null)
      setShowPrompt(false)
    }
  }

  const handleDismiss = () => {
    setShowPrompt(false)
    localStorage.setItem('installPromptDismissed', Date.now().toString())
  }

  if (!showPrompt || isStandalone) return null

  // iOS-specific prompt
  if (isIOS) {
    return (
      <div className="fixed bottom-20 left-4 right-4 z-50 animate-slide-up md:hidden">
        <div className="rounded-lg bg-white p-4 shadow-lg ring-1 ring-black ring-opacity-5">
          <div className="flex items-start">
            <div className="flex-shrink-0">
              <ArrowDownTrayIcon className="h-6 w-6 text-primary-600" />
            </div>
            <div className="ml-3 flex-1">
              <h3 className="text-sm font-medium text-gray-900">
                Install Anchor Tools
              </h3>
              <div className="mt-2 text-sm text-gray-500">
                <p>Install this app on your iPhone:</p>
                <ol className="mt-2 list-decimal list-inside text-xs">
                  <li>Tap the share button <span className="inline-block w-4 h-4 align-middle">⎙</span></li>
                  <li>Scroll down and tap "Add to Home Screen"</li>
                  <li>Tap "Add" to install</li>
                </ol>
              </div>
            </div>
            <button
              onClick={handleDismiss}
              className="ml-3 flex-shrink-0 rounded-md p-1 hover:bg-gray-100"
            >
              <XMarkIcon className="h-5 w-5 text-gray-400" />
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Android/Desktop Chrome prompt
  return (
    <div className="fixed bottom-20 left-4 right-4 z-50 animate-slide-up md:bottom-4 md:left-auto md:right-4 md:max-w-sm">
      <div className="rounded-lg bg-white p-4 shadow-lg ring-1 ring-black ring-opacity-5">
        <div className="flex items-start">
          <div className="flex-shrink-0">
            <ArrowDownTrayIcon className="h-6 w-6 text-primary-600" />
          </div>
          <div className="ml-3 flex-1">
            <h3 className="text-sm font-medium text-gray-900">
              Install Anchor Tools
            </h3>
            <p className="mt-1 text-sm text-gray-500">
              Install our app for quick access and offline support
            </p>
            <div className="mt-3 flex gap-3">
              <button
                onClick={handleInstallClick}
                className="rounded-md bg-primary-600 px-3 py-2 text-sm font-medium text-white hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
              >
                Install
              </button>
              <button
                onClick={handleDismiss}
                className="rounded-md bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2"
              >
                Not now
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// Hook to programmatically trigger install prompt
export function useInstallPrompt() {
  const [prompt, setPrompt] = useState<any>(null)
  const [isInstallable, setIsInstallable] = useState(false)

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault()
      setPrompt(e)
      setIsInstallable(true)
    }

    window.addEventListener('beforeinstallprompt', handler)

    return () => {
      window.removeEventListener('beforeinstallprompt', handler)
    }
  }, [])

  const install = async () => {
    if (!prompt) return false

    prompt.prompt()
    const { outcome } = await prompt.userChoice
    
    if (outcome === 'accepted') {
      setPrompt(null)
      setIsInstallable(false)
      return true
    }
    
    return false
  }

  return { isInstallable, install }
}