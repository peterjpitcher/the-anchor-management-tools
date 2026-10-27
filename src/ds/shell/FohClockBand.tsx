'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/ds/primitives/Button'
import { Spinner } from '@/ds/primitives/Spinner'
import { clockIn, clockOut, getOpenSessions } from '@/app/actions/timeclock'
import { formatTime12Hour } from '@/lib/dateUtils'
import { formatInTimeZone } from 'date-fns-tz'
import toast from 'react-hot-toast'
import { isStaleServerActionError, reloadStalePage } from '@/lib/foh/stale-page'

interface FohClockBandProps {
  employeeId: string
}

export function FohClockBand({ employeeId }: FohClockBandProps) {
  const [clockedIn, setClockedIn] = useState(false)
  const [clockInTime, setClockInTime] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)

  const fetchStatus = useCallback(async () => {
    const result = await getOpenSessions()
    if (result.success) {
      const mySession = result.data.find(s => s.employee_id === employeeId)
      if (mySession) {
        setClockedIn(true)
        // Convert UTC clock_in_at to London local HH:MM for display
        const localTime = formatInTimeZone(
          new Date(mySession.clock_in_at),
          'Europe/London',
          'HH:mm'
        )
        setClockInTime(localTime)
      } else {
        setClockedIn(false)
        setClockInTime(null)
      }
    }
    setLoading(false)
  }, [employeeId])

  useEffect(() => {
    fetchStatus()
  }, [fetchStatus])

  // Clocking must never spin forever or fail silently: payroll depends on it (BK-096).
  const runClockAction = useCallback(async (action: typeof clockIn, label: string) => {
    setActionLoading(true)
    try {
      const result = await action(employeeId)
      if (result.success) {
        await fetchStatus()
      } else {
        toast.error(result.error || `Could not ${label}. Please try again.`)
      }
    } catch (error) {
      if (isStaleServerActionError(error)) {
        reloadStalePage()
      } else {
        toast.error(`Could not ${label}: the connection dropped. Please try again.`)
      }
    } finally {
      setActionLoading(false)
    }
  }, [employeeId, fetchStatus])

  const handleClockIn = useCallback(() => runClockAction(clockIn, 'clock in'), [runClockAction])
  const handleClockOut = useCallback(() => runClockAction(clockOut, 'clock out'), [runClockAction])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-10 bg-surface-2 border-b border-border">
        <Spinner size="sm" />
      </div>
    )
  }

  if (clockedIn) {
    return (
      <div className="flex items-center h-10 px-4 bg-primary/10 border-b border-primary/20">
        <span className="text-sm font-medium text-primary">
          Clocked in since {formatTime12Hour(clockInTime)}
        </span>
        <div className="ml-auto">
          <Button
            variant="secondary"
            size="sm"
            onClick={handleClockOut}
            disabled={actionLoading}
            loading={actionLoading}
          >
            Clock Out
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center h-10 px-4 bg-surface-2 border-b border-border">
      <span className="text-sm font-medium text-text-muted">
        Not clocked in
      </span>
      <div className="ml-auto">
        <Button
          variant="primary"
          size="sm"
          onClick={handleClockIn}
          disabled={actionLoading}
          loading={actionLoading}
        >
          Clock In
        </Button>
      </div>
    </div>
  )
}
