'use client'

import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { Button, toast } from '@/ds'
import { refreshInsightsReport } from '@/app/actions/insights'

export interface InsightsToolbarProps {
  /** London wall-clock time the figures were worked out, "14:32", formatted on the server. */
  workedOutAt: string
}

/**
 * Print and Refresh now. The report is cached for five minutes; Refresh now clears that cache
 * on the server and re-renders the page, so the figures are rebuilt from live data.
 */
export function InsightsToolbar({ workedOutAt }: InsightsToolbarProps): React.JSX.Element {
  const router = useRouter()
  const [refreshing, startRefresh] = useTransition()

  const refresh = (): void => {
    startRefresh(async () => {
      try {
        const result = await refreshInsightsReport()
        if (result.error) {
          toast.error(result.error)
          return
        }
        router.refresh()
      } catch {
        toast.error('The report could not be refreshed. Try again in a moment.')
      }
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      <span className="text-sm text-text-muted">Figures worked out at {workedOutAt}</span>
      <Button variant="secondary" size="sm" onClick={refresh} loading={refreshing}>
        Refresh now
      </Button>
      <Button variant="primary" size="sm" onClick={() => window.print()}>
        Print
      </Button>
    </div>
  )
}
