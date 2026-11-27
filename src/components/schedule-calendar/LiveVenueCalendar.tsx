'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Alert, Button, Spinner } from '@/ds'
import { getVenueCalendarMonth } from '@/app/actions/venue-calendar'
import { VenueCalendar } from './VenueCalendar'
import type { VenueCalendarMonthData } from './month-data'
import { CAL_MONTH_PARAM, formatCalendarMonth, parseCalendarMonth } from './url-state'

export interface LiveVenueCalendarProps {
  /** The month the server already loaded, so the first paint is not empty. */
  initialData?: VenueCalendarMonthData | null
  /** Bump to reload the month on screen (after an event, note or booking is saved elsewhere). */
  refreshKey?: number
  canManageCalendarNotes?: boolean
  showFilters?: boolean
  /** Opens a repeating event. Without it a repeating night opens the Events page. */
  onRepeatingEventClick?: (seriesId: string) => void
  /** Extra warnings from the page itself, shown with the month's own. */
  extraWarnings?: string[]
  header?: ReactNode
  className?: string
}

const NO_WARNINGS: string[] = []

function monthLabel(month: string): string {
  const date = parseCalendarMonth(month)
  return date ? date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) : month
}

/**
 * The venue calendar, loaded one month at a time.
 *
 * Every month you page to is fetched whole (whatever happened to each item since), and kept, so
 * paging back and forth does not reload it. The month sits in the URL (`calMonth`), so a refresh
 * or a pasted link opens the same month. While a month loads, or if it fails, the grid is dimmed
 * under a message: an unloaded month never reads as a quiet one.
 */
export function LiveVenueCalendar({
  initialData = null,
  refreshKey = 0,
  canManageCalendarNotes,
  showFilters,
  onRepeatingEventClick,
  extraWarnings = NO_WARNINGS,
  header,
  className,
}: LiveVenueCalendarProps): ReactNode {
  const router = useRouter()
  const searchParams = useSearchParams()
  // Without a month in the URL, open on the month the server loaded: the server (UTC) and the
  // browser (London) can disagree about which month it is around midnight on the 1st.
  const defaultMonth = useMemo(
    () => (initialData ? parseCalendarMonth(initialData.month) : null) ?? new Date(),
    [initialData],
  )
  const month = formatCalendarMonth(parseCalendarMonth(searchParams.get(CAL_MONTH_PARAM)) ?? defaultMonth)

  const [cache, setCache] = useState<Record<string, VenueCalendarMonthData>>(() =>
    initialData ? { [initialData.month]: initialData } : {},
  )
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [loadingMonth, setLoadingMonth] = useState<string | null>(null)
  // The most recent month asked for: a slow reply for a month already paged past is dropped.
  const latestRequest = useRef<string | null>(null)
  const lastRefreshKey = useRef(refreshKey)
  const lastInitialData = useRef(initialData)

  // A server refresh (the dashboard's Refresh, or router.refresh after a save) hands over a fresh
  // month. Everything cached before it may be stale too, so start again from the new data.
  useEffect(() => {
    if (lastInitialData.current === initialData) return
    lastInitialData.current = initialData
    setCache(initialData ? { [initialData.month]: initialData } : {})
    setErrors({})
  }, [initialData])

  const load = useCallback(async (target: string) => {
    latestRequest.current = target
    setLoadingMonth(target)
    setErrors((current) => {
      if (!(target in current)) return current
      const next = { ...current }
      delete next[target]
      return next
    })
    let message: string | null = null
    let data: VenueCalendarMonthData | undefined
    try {
      const result = await getVenueCalendarMonth({ month: target })
      data = result.data
      if (!data) message = result.error ?? 'The calendar could not be loaded.'
    } catch {
      message = 'The calendar could not be loaded. Check your connection and try again.'
    }
    if (data) {
      const loaded = data
      setCache((current) => ({ ...current, [target]: loaded }))
    } else {
      const failure = message ?? 'The calendar could not be loaded.'
      setErrors((current) => ({ ...current, [target]: failure }))
    }
    if (latestRequest.current === target) setLoadingMonth(null)
  }, [])

  // Reload on a refresh request: the cached months may be stale, so drop them all.
  useEffect(() => {
    if (lastRefreshKey.current === refreshKey) return
    lastRefreshKey.current = refreshKey
    setCache({})
    void load(month)
  }, [refreshKey, month, load])

  // Load the month on screen the first time it is shown.
  useEffect(() => {
    if (cache[month] || errors[month] || loadingMonth === month) return
    void load(month)
  }, [month, cache, errors, loadingMonth, load])

  // Only this month's own data is drawn. Last month's items are never left on this month's
  // grid while it loads; the grid is dimmed under a message instead.
  const onScreen = cache[month] ?? null

  // Reload the month on screen. Used by Try Again (one failed month) and after a note is saved,
  // moved or deleted: a note can span or move into other months already visited, so the whole
  // cache is dropped and those months load afresh when shown again.
  const reloadMonth = useCallback(() => {
    setCache({})
    void load(month)
  }, [load, month])

  const error = errors[month] ?? null
  const overlay = onScreen
    ? null
    : error
      ? (
          <Alert tone="danger" size="sm">
            <div className="flex flex-wrap items-center gap-3">
              <span>
                {monthLabel(month)} could not be loaded. {error}
              </span>
              <Button size="sm" variant="secondary" type="button" onClick={reloadMonth}>
                Try Again
              </Button>
            </div>
          </Alert>
        )
      : (
          <div
            role="status"
            className="flex items-center gap-2 rounded-default border border-border bg-surface px-3 py-2 text-ui text-text shadow-sm"
          >
            <Spinner size="sm" />
            <span>Loading {monthLabel(month)}</span>
          </div>
        )

  return (
    <VenueCalendar
      events={onScreen?.events ?? []}
      repeatingEvents={onScreen?.repeatingEvents ?? []}
      privateBookings={onScreen?.privateBookings ?? []}
      balanceDueDates={onScreen?.balanceDueDates ?? []}
      employeeBirthdays={onScreen?.employeeBirthdays ?? []}
      specialHours={onScreen?.specialHours ?? []}
      calendarNotes={onScreen?.calendarNotes ?? []}
      parkingBookings={onScreen?.parkingBookings ?? []}
      marketingSends={onScreen?.marketingSends ?? []}
      textMessages={onScreen?.textMessages ?? []}
      dailyOps={onScreen?.dailyOps}
      canManageCalendarNotes={canManageCalendarNotes}
      showFilters={showFilters}
      onNotesChanged={reloadMonth}
      onRepeatingEventClick={onRepeatingEventClick ?? (() => router.push('/events'))}
      datasetWarnings={[...(onScreen?.warnings ?? []), ...extraWarnings]}
      overlay={overlay}
      defaultMonth={defaultMonth}
      header={header}
      className={className}
    />
  )
}
