'use client'

import { useEffect, useState } from 'react'
import { Alert } from '@/ds'
import { getDateHoursNotice, type DateHoursNotice } from '@/app/actions/venue-night'

interface HireDateHoursNoticeProps {
  /** The date chosen on the form, YYYY-MM-DD; nothing shows without one. */
  date: string | null | undefined
}

/**
 * Says so when a private hire's date falls on a day the pub or kitchen is shut (review BK-076,
 * owner decision D24: warned about, never refused). Shown as the date is chosen on the new and edit
 * forms. A failed check shows nothing here: the booking page checks the night again and says so.
 */
export function HireDateHoursNotice({ date }: HireDateHoursNoticeProps): React.ReactElement | null {
  const [hours, setHours] = useState<DateHoursNotice | null>(null)

  useEffect(() => {
    let cancelled = false
    setHours(null)
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return () => { cancelled = true }
    getDateHoursNotice(date)
      .then((result) => {
        if (!cancelled && result.success) setHours(result.data ?? null)
      })
      .catch(() => {
        // Nothing to say: the booking page checks the night again after saving.
      })
    return () => { cancelled = true }
  }, [date])

  if (!hours?.known) return null
  if (hours.closed) {
    return (
      <Alert tone="warning" title="Closed on this date">
        The pub is closed on this date. You can still save the booking, but check the opening hours first.
      </Alert>
    )
  }
  if (hours.kitchenClosed) {
    return (
      <Alert tone="info" title="Kitchen closed on this date">
        The kitchen is closed on this date, so no food from the kitchen can be served at this hire.
      </Alert>
    )
  }
  return null
}
