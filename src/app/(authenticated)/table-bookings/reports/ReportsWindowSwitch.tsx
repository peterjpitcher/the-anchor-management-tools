'use client'

import { useRouter } from 'next/navigation'
import { Segmented } from '@/ds'

export interface ReportsWindowOption {
  key: string
  label: string
}

interface ReportsWindowSwitchProps {
  options: ReadonlyArray<ReportsWindowOption>
  value: string
}

/**
 * The Day / Week / Month / Year switch. The window lives in the URL (?window=), so a report can be
 * bookmarked and shared; picking an option navigates and the server page renders the new window.
 */
export function ReportsWindowSwitch({ options, value }: ReportsWindowSwitchProps): React.JSX.Element {
  const router = useRouter()

  return (
    <Segmented
      aria-label="Report period"
      options={options.map((option) => ({ id: option.key, label: option.label }))}
      value={value}
      size="sm"
      onChange={(id) => {
        if (id !== value) router.push(`/table-bookings/reports?window=${id}`)
      }}
    />
  )
}
