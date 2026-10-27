'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Alert, Button } from '@/ds'

const AUTO_RETRY_MS = 10_000

/**
 * Shown when the permission lookup failed (a network blip), not when access was refused
 * (BK-095). It re-renders the page from the server every ten seconds, and on a button press,
 * so staff are back on the screen as soon as the connection recovers. It grants nothing.
 */
export function PermissionsUnavailable(): React.ReactElement {
  const router = useRouter()
  const [retrying, setRetrying] = useState(false)

  useEffect(() => {
    const timer = window.setInterval(() => router.refresh(), AUTO_RETRY_MS)
    return () => window.clearInterval(timer)
  }, [router])

  const retry = () => {
    setRetrying(true)
    router.refresh()
    window.setTimeout(() => setRetrying(false), 2_000)
  }

  return (
    <div className="mx-auto max-w-xl p-4">
      <Alert tone="warning" title="Connection problem, retrying">
        <p>We could not check what you can see on this screen. This is usually a brief network blip.</p>
        <div className="mt-3">
          <Button variant="primary" size="sm" onClick={retry} loading={retrying}>
            Try again
          </Button>
        </div>
      </Alert>
    </div>
  )
}
