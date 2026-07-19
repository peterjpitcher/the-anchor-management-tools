'use client'

import { useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Button, Field, Input } from '@/ds'

interface DateRangeControlProps {
  from?: string
  to?: string
}

/**
 * A from/to date filter. Applying navigates to the current path with ?from=&to=, which
 * re-runs the server page and re-fetches the metrics. The window is clamped server-side
 * (default rolling 30 days, hard cap 92, spec 9.4).
 */
export function DateRangeControl({ from, to }: DateRangeControlProps) {
  const router = useRouter()
  const pathname = usePathname()
  const [fromDate, setFromDate] = useState(from ?? '')
  const [toDate, setToDate] = useState(to ?? '')

  function apply() {
    const params = new URLSearchParams()
    if (fromDate) params.set('from', fromDate)
    if (toDate) params.set('to', toDate)
    const query = params.toString()
    router.push(query ? `${pathname}?${query}` : pathname)
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="w-44">
        <Field label="From">
          <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </Field>
      </div>
      <div className="w-44">
        <Field label="To">
          <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </Field>
      </div>
      <Button type="button" variant="secondary" onClick={apply}>
        Apply
      </Button>
    </div>
  )
}
