'use client'

import { useRouter } from 'next/navigation'
import { Segmented } from '@/ds'

const WINDOW_OPTIONS = [
  { id: '24h', label: '24 hours' },
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
]

/** The time window for the SMS failures page. The window lives in the URL, so it survives a reload. */
export function WindowSwitch({ value }: { value: '24h' | '7d' | '30d' }): React.JSX.Element {
  const router = useRouter()
  return (
    <Segmented
      size="sm"
      aria-label="Time window"
      options={WINDOW_OPTIONS}
      value={value}
      onChange={(id) => router.push(`/settings/sms-failures?window=${id}`)}
    />
  )
}
