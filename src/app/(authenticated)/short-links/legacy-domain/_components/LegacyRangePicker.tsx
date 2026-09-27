'use client'

import { useRouter } from 'next/navigation'
import { Segmented } from '@/ds'

export interface LegacyRangePickerProps {
  options: number[]
  days: number
}

/**
 * The reporting range for the legacy domain (30, 90, 180 or 365 days). It switches the view of
 * the same figures, so it is a Segmented header action. The range lives in the URL (`?days=`),
 * which the server page reads, so a choice navigates rather than holding state.
 */
export function LegacyRangePicker({ options, days }: LegacyRangePickerProps): React.JSX.Element {
  const router = useRouter()

  return (
    <Segmented
      aria-label="Reporting range"
      size="sm"
      options={options.map((option) => ({ id: String(option), label: `${option} days` }))}
      value={String(days)}
      onChange={(id) => router.push(`/short-links/legacy-domain?days=${id}`)}
    />
  )
}
