'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/ds/primitives/Button'
import { Spinner } from '@/ds/primitives/Spinner'
import { clockIn, clockOut, getOpenSessions } from '@/app/actions/timeclock'
import { formatTime12Hour } from '@/lib/dateUtils'
import { formatInTimeZone } from 'date-fns-tz'

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

  const handleClockIn = useCallback(async () => {
    setActionLoading(true)
    const result = await clockIn(employeeId)
    if (result.success) {
      await fetchStatus()
    }
    setActionLoading(false)
  }, [employeeId, fetchStatus])

  const handleClockOut = useCallback(async () => {
    setActionLoading(true)
    const result = await clockOut(employeeId)
    if (result.success) {
      await fetchStatus()
    }
    setActionLoading(false)
  }, [employeeId, fetchStatus])

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
