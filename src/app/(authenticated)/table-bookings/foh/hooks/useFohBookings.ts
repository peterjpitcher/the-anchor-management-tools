'use client'

import { useCallback, useEffect, useState } from 'react'
import type {
  FohScheduleResponse,
  FohUpcomingEvent,
  FohUpcomingEventsResponse,
} from '../types'

export type UseFohBookingsReturn = {
  schedule: FohScheduleResponse['data'] | null
  setSchedule: React.Dispatch<React.SetStateAction<FohScheduleResponse['data'] | null>>
  loading: boolean
  errorMessage: string | null
  setErrorMessage: React.Dispatch<React.SetStateAction<string | null>>
  reloadSchedule: (opts?: { requestedDate?: string; surfaceError?: boolean }) => Promise<void>
  upcomingEvents: FohUpcomingEvent[]
  upcomingEventsLoaded: boolean
}

export function useFohBookings(input: {
  date: string
  clockNow: Date
}): UseFohBookingsReturn {
  const { date, clockNow } = input

  const [schedule, setSchedule] = useState<FohScheduleResponse['data'] | null>(null)
  const [loading, setLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [upcomingEvents, setUpcomingEvents] = useState<FohUpcomingEvent[]>([])
  const [upcomingEventsLoaded, setUpcomingEventsLoaded] = useState(false)

  const fetchSchedule = useCallback(async (requestedDate: string) => {
    const response = await fetch(`/api/foh/schedule?date=${encodeURIComponent(requestedDate)}`, {
      cache: 'no-store'
    })

    const payload = (await response.json()) as FohScheduleResponse
    if (!response.ok || !payload.success || !payload.data) {
      throw new Error(payload.error || 'Failed to load Front of House schedule')
    }

    return payload.data
  }, [])

  const fetchUpcomingEvents = useCallback(async () => {
    const response = await fetch('/api/foh/events/upcoming?limit=1', {
      cache: 'no-store'
    })

    const payload = (await response.json()) as FohUpcomingEventsResponse
    if (!response.ok || !payload.success) {
      throw new Error(payload.error || 'Failed to load upcoming events')
    }

    return Array.isArray(payload.data) ? payload.data : []
  }, [])

  // Initial schedule load and date-change load
  useEffect(() => {
    let isCancelled = false

    async function load() {
      setLoading(true)
      setErrorMessage(null)
      try {
        const payload = await fetchSchedule(date)

        if (!isCancelled) {
          setSchedule(payload)
        }
      } catch (error) {
        if (!isCancelled) {
          setErrorMessage(error instanceof Error ? error.message : 'Failed to load Front of House schedule')
          setSchedule(null)
        }
      } finally {
        if (!isCancelled) {
          setLoading(false)
        }
      }
    }

    void load()

    return () => {
      isCancelled = true
    }
  }, [date, fetchSchedule])

  const reloadSchedule = useCallback(
    async ({ requestedDate = date, surfaceError = true }: { requestedDate?: string; surfaceError?: boolean } = {}) => {
      try {
        const data = await fetchSchedule(requestedDate)
        setSchedule(data)
      } catch (error) {
        if (surfaceError) {
          setErrorMessage(error instanceof Error ? error.message : 'Failed to reload Front of House schedule')
        }
        throw error
      }
    },
    [date, fetchSchedule]
  )

  // Upcoming events loader
  useEffect(() => {
    let cancelled = false

    const loadUpcomingEvents = async () => {
      try {
        const rows = await fetchUpcomingEvents()
        if (!cancelled) {
          setUpcomingEvents(rows.slice(0, 1))
        }
      } catch {
        if (!cancelled) {
          setUpcomingEvents([])
        }
      } finally {
        if (!cancelled) {
          setUpcomingEventsLoaded(true)
        }
      }
    }

    void loadUpcomingEvents()

    return () => {
      cancelled = true
    }
  }, [clockNow, fetchUpcomingEvents])

  return {
    schedule,
    setSchedule,
    loading,
    errorMessage,
    setErrorMessage,
    reloadSchedule,
    upcomingEvents,
    upcomingEventsLoaded,
  }
}
