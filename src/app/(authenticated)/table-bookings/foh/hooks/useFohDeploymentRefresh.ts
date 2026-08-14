'use client'

import { useEffect, useState } from 'react'
import { hasDeploymentChanged } from '@/lib/foh/deployment-version'

const VERSION_CHECK_INTERVAL_MS = 5 * 60 * 1000

export function useFohDeploymentRefresh(input: {
  currentVersion: string
  pauseReload: boolean
}) {
  const { currentVersion, pauseReload } = input
  const [latestVersion, setLatestVersion] = useState(currentVersion)

  useEffect(() => {
    let cancelled = false

    async function checkVersion() {
      try {
        const response = await fetch('/api/app-version', { cache: 'no-store' })
        if (!response.ok) return
        const payload = (await response.json()) as { version?: string }
        if (!cancelled && typeof payload.version === 'string') {
          setLatestVersion(payload.version)
        }
      } catch {
        // A version check must never interrupt the live floor screen.
      }
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') void checkVersion()
    }

    void checkVersion()
    const intervalId = window.setInterval(checkVersion, VERSION_CHECK_INTERVAL_MS)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [currentVersion])

  useEffect(() => {
    if (!pauseReload && hasDeploymentChanged(currentVersion, latestVersion)) {
      window.location.reload()
    }
  }, [currentVersion, latestVersion, pauseReload])
}
