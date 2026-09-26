'use client'

import { useRouter } from 'next/navigation'
import { Segmented } from '@/ds'
import type { CustomerInsightsWindow } from '@/lib/analytics/customer-insights'

export interface InsightsWindowPickerProps {
  options: Array<{ key: CustomerInsightsWindow; label: string }>
  value: CustomerInsightsWindow
}

/**
 * The time window for Customers Insights (30 days, 90 days, 12 months). It switches the view of
 * the same figures, so it is a Segmented header action. The window lives in the URL
 * (`?window=`), which the server page reads, so a choice navigates rather than holding state.
 */
export function InsightsWindowPicker({ options, value }: InsightsWindowPickerProps): React.JSX.Element {
  const router = useRouter()

  return (
    <Segmented
      aria-label="Time window"
      size="sm"
      options={options.map((option) => ({ id: option.key, label: option.label }))}
      value={value}
      onChange={(id) => router.push(`/customers/insights?window=${id}`)}
    />
  )
}
