'use client'

import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { Button } from '@/ds'

/** Print and Refresh. Refresh rebuilds the report from live data on the server. */
export function InsightsToolbar(): React.JSX.Element {
  const router = useRouter()
  const [refreshing, startRefresh] = useTransition()
  return (
    <div className="flex gap-2 print:hidden">
      <Button variant="secondary" onClick={() => startRefresh(() => router.refresh())} disabled={refreshing}>
        {refreshing ? 'Refreshing…' : 'Refresh'}
      </Button>
      <Button variant="primary" onClick={() => window.print()}>
        Print
      </Button>
    </div>
  )
}
