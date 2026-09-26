'use client'

import { useRouter } from 'next/navigation'
import { Segmented } from '@/ds'

const WINDOW_OPTIONS = [
  { id: '24h', label: '24h' },
  { id: '7d', label: '7d' },
  { id: '30d', label: '30d' },
]

/** The time window for the SMS failures page. The window lives in the URL, so it survives a reload. */
export function WindowSwitch({ value }: { value: '24h' | '7d' | '30d' }): React.JSX.Element {
  const router = useRouter()
  return (
    <Segmented
      aria-label="Time window"
      options={WINDOW_OPTIONS}
      value={value}
      onChange={(id) => router.push(`/settings/sms-failures?window=${id}`)}
    />
  )
}
