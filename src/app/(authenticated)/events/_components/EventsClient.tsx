'use client'

import { useState, useCallback, useTransition, useEffect, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { getTodayIsoDate } from '@/lib/dateUtils'
import { Alert, PageLayout, PageLoading, Segmented, Button } from '@/ds'
import { Icon } from '@/ds/icons'
import { EventListView } from './EventListView'
import { EventBoardView } from './EventBoardView'
import { EventDrawer } from './EventDrawer'
import { EventFilterPanel, type EventFilters } from './EventFilterPanel'
import { VenueCalendar } from '@/components/schedule-calendar'
import type {
  VenueCalendarEvent,
  VenueCalendarBooking,
  VenueCalendarNote,
  VenueCalendarParking,
  VenueCalendarSpecialHours,
  VenueCalendarBalanceDue,
  VenueCalendarEmployeeBirthday,
  VenueCalendarMarketingSend,
  ScheduleDailyOps,
} from '@/components/schedule-calendar'
import type { Event } from '@/types/database'
import type { ParkingBookingStatus } from '@/types/parking'
import type { EventCategory } from '@/types/event-categories'
import { getEvents, deleteEvent } from '@/app/actions/events'
import { fetchPrivateBookingsForCalendar } from '@/app/actions/private-bookings-dashboard'
import { listCalendarNotes } from '@/app/actions/calendar-notes'
import { listParkingBookings } from '@/app/actions/parking'
import { toast } from '@/ds'

type ViewMode = 'list' | 'calendar' | 'board'

/**
 * Parking statuses worth showing on a calendar: the ones that still represent a
 * car arriving. Matches the dashboard. Without this the events calendar rendered
 * cancelled and expired bookings as live green blocks that no filter could hide,
 * because the adapter also discarded their status.
 */
const CALENDAR_PARKING_STATUSES: ParkingBookingStatus[] = ['pending_payment', 'confirmed', 'completed']

const VIEW_OPTIONS = [
  { id: 'list', label: 'List' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'board', label: 'Board' },
]

function getFilenameFromHeaders(headers: Headers): string | null {
  const disposition = headers.get('content-disposition') ?? ''
  const filenameMatch = disposition.match(/filename="?([^";]+)"?/i)
  return filenameMatch?.[1] ?? null
}

function toCalendarEvent(e: Event): VenueCalendarEvent {
  return {
    id: e.id,
    name: e.name,
    date: e.date,
    time: e.time,
    bookedSeatsCount: (e as Event & { booked_count?: number }).booked_count ?? 0,
    eventStatus: e.event_status,
    // Content readiness, so the calendar can flag and filter what still needs
    // artwork or copy before it can be published.
    hasImage: Boolean(e.hero_image_url || e.poster_image_url || e.thumbnail_image_url),
    hasBrief: Boolean(e.brief && e.brief.trim()),
    hasDescription: Boolean(
      (e.short_description && e.short_description.trim()) ||
      (e.long_description && e.long_description.trim())
    ),
  }
}

interface EventsClientProps {
  initialEvents: Event[]
  initialPagination?: {
    totalCount: number
    currentPage: number
    pageSize: number
    totalPages: number
  }
  categories: EventCategory[]
  initialCalendarEvents?: Event[]
  initialCalendarBookings?: VenueCalendarBooking[]
  initialCalendarNotes?: VenueCalendarNote[]
  initialCalendarParking?: VenueCalendarParking[]
  canManageCalendarNotes?: boolean
  /**
   * Surfaced rather than swallowed. Both call sites used to drop this, so a user
   * whose permission denied the note read simply saw a calendar with no notes and
   * no explanation, which is the same silent-empty failure as a broken query.
   */
  calendarNotesError?: string | null
  /**
   * Datasets the events calendar used to lack entirely, so it looked like a
   * different product from the dashboard's. Each is permission-gated at source;
   * an empty array here can mean "denied" as well as "none", which is why the
   * page also passes any failure messages separately.
   */
  initialSpecialHours?: VenueCalendarSpecialHours[]
  initialBirthdays?: VenueCalendarEmployeeBirthday[]
  initialBalanceDues?: VenueCalendarBalanceDue[]
  initialDailyOps?: ScheduleDailyOps | null
  initialMarketingSends?: VenueCalendarMarketingSend[]
  calendarDatasetWarnings?: string[]
  /**
   * Why the first page of the list, or the calendar's events, could not be loaded. A failed
   * load is shown as a failure, never as an empty list or an empty calendar.
   */
  initialEventsError?: string | null
  initialCalendarEventsError?: string | null
  /** The outstanding todos panel, shown beside the events from the xl breakpoint up. */
  todosPanel?: ReactNode
}

export default function EventsClient({
  initialEvents,
  initialPagination,
  categories,
  initialCalendarEvents,
  initialCalendarBookings,
  initialCalendarNotes,
  initialCalendarParking,
  canManageCalendarNotes,
  calendarNotesError = null,
  initialSpecialHours = [],
  initialBirthdays = [],
  initialBalanceDues = [],
  initialDailyOps = null,
  initialMarketingSends = [],
  calendarDatasetWarnings = [],
  initialEventsError = null,
  initialCalendarEventsError = null,
  todosPanel,
}: EventsClientProps) {
  const router = useRouter()
  const [view, setView] = useState<ViewMode>('calendar')
  const [events, setEvents] = useState<Event[]>(initialEvents)
  const [calendarEvents, setCalendarEvents] = useState<VenueCalendarEvent[]>(
    () => (initialCalendarEvents ?? []).map(toCalendarEvent)
  )
  const [calendarBookings, setCalendarBookings] = useState<VenueCalendarBooking[]>(initialCalendarBookings ?? [])
  const [calendarNotes, setCalendarNotes] = useState<VenueCalendarNote[]>(initialCalendarNotes ?? [])
  const [calendarParking, setCalendarParking] = useState<VenueCalendarParking[]>(initialCalendarParking ?? [])
  const [notesError, setNotesError] = useState<string | null>(calendarNotesError)
  const [boardEvents, setBoardEvents] = useState<Event[]>([])
  const [listError, setListError] = useState<string | null>(initialEventsError)
  const [calendarEventsError, setCalendarEventsError] = useState<string | null>(initialCalendarEventsError)
  // The board fetches on first open, so until it has an answer it shows a loading state, not
  // five empty columns.
  const [boardLoaded, setBoardLoaded] = useState(false)
  const [boardError, setBoardError] = useState<string | null>(null)

  const [pagination, setPagination] = useState(
    initialPagination ?? { totalCount: 0, currentPage: 1, pageSize: 25, totalPages: 1 }
  )
  const [filters, setFilters] = useState<EventFilters>({
    searchTerm: '',
    category: 'all',
    status: 'all',
    dateFrom: getTodayIsoDate(),
    dateTo: '',
  })
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [activeEvent, setActiveEvent] = useState<Event | null>(null)
  const [isExporting, setIsExporting] = useState(false)
  const [isBuildingQrPack, setIsBuildingQrPack] = useState(false)
  const [isPending, startTransition] = useTransition()

  const fetchEvents = useCallback(
    (page: number, currentFilters: EventFilters) => {
      startTransition(async () => {
        const result = await getEvents({
          status: currentFilters.status === 'all' ? 'all' : currentFilters.status as 'scheduled' | 'cancelled' | 'postponed' | 'rescheduled' | 'sold_out',
          searchTerm: currentFilters.searchTerm || undefined,
          dateFrom: currentFilters.dateFrom || undefined,
          dateTo: currentFilters.dateTo || undefined,
          categoryId: currentFilters.category === 'all' ? undefined : currentFilters.category,
          page,
          pageSize: 25,
        })
        if (result.data) {
          setEvents(result.data)
          setListError(null)
        } else if (result.error) {
          setListError(result.error)
        }
        if (result.pagination) {
          setPagination(result.pagination)
        }
      })
    },
    []
  )

  const fetchCalendarData = useCallback(
    () => {
      startTransition(async () => {
        const [eventsResult, bookingsResult, notesResult, parkingResult] = await Promise.all([
          getEvents({ status: 'all', page: 1, pageSize: 500 }),
          fetchPrivateBookingsForCalendar(),
          listCalendarNotes(),
          listParkingBookings({ limit: 500, statuses: CALENDAR_PARKING_STATUSES }),
        ])
        if (eventsResult.data) {
          setCalendarEvents(eventsResult.data.map(toCalendarEvent))
          setCalendarEventsError(null)
        } else if (eventsResult.error) {
          // Keep what is on screen; report that it could not be refreshed.
          setCalendarEventsError(eventsResult.error)
        }
        if ('data' in bookingsResult && bookingsResult.data) {
          setCalendarBookings(bookingsResult.data as VenueCalendarBooking[])
        }
        if (notesResult.data) {
          setCalendarNotes(notesResult.data)
          setNotesError(null)
        } else if (notesResult.error) {
          // Keep the rest of the calendar; report only what failed.
          setNotesError(notesResult.error)
        }
        if ('data' in parkingResult && parkingResult.data) {
          setCalendarParking(parkingResult.data as VenueCalendarParking[])
        }
      })
    },
    []
  )

  const fetchBoardEvents = useCallback(() => {
    startTransition(async () => {
      const result = await getEvents({
        status: 'all',
        page: 1,
        pageSize: 200,
      })
      if (result.data) {
        setBoardEvents(result.data)
        setBoardError(null)
        setBoardLoaded(true)
      } else if (result.error) {
        setBoardError(result.error)
      }
    })
  }, [])

  const [calendarInitialised, setCalendarInitialised] = useState(!!initialCalendarEvents?.length)

  useEffect(() => {
    if (view === 'calendar' && !calendarInitialised) {
      fetchCalendarData()
      setCalendarInitialised(true)
    } else if (view === 'board') {
      fetchBoardEvents()
    }
  }, [view, calendarInitialised, fetchCalendarData, fetchBoardEvents])

  const handleFilterChange = useCallback(
    (newFilters: EventFilters) => {
      setFilters(newFilters)
      setSelectedIds(new Set())
      fetchEvents(1, newFilters)
    },
    [fetchEvents]
  )

  const handlePageChange = useCallback(
    (page: number) => {
      setSelectedIds(new Set())
      fetchEvents(page, filters)
    },
    [fetchEvents, filters]
  )

  const handleEventClick = useCallback((event: Event) => {
    router.push(`/events/${event.id}`)
  }, [router])

  const handleEditEvent = useCallback((event: Event) => {
    setActiveEvent(event)
    setDrawerOpen(true)
  }, [])

  const handleNewEvent = useCallback(() => {
    setActiveEvent(null)
    setDrawerOpen(true)
  }, [])

  const handleDrawerClose = useCallback(() => {
    setDrawerOpen(false)
    setActiveEvent(null)
  }, [])

  // Refresh only. The drawer closes itself, because after creating an event it
  // has to stay open long enough to upload any artwork queued beforehand.
  const handleSave = useCallback(() => {
    if (view === 'calendar') {
      fetchCalendarData()
    } else if (view === 'board') {
      fetchBoardEvents()
    } else {
      fetchEvents(pagination.currentPage, filters)
    }
  }, [view, fetchCalendarData, fetchBoardEvents, fetchEvents, pagination.currentPage, filters])

  const handleDeleteSelected = useCallback(() => {
    startTransition(async () => {
      const ids = Array.from(selectedIds)
      let deleted = 0
      for (const id of ids) {
        const result = await deleteEvent(id)
        if ('success' in result && result.success) {
          deleted++
        }
      }
      toast.success(`Deleted ${deleted} event(s)`)
      setSelectedIds(new Set())
      fetchEvents(pagination.currentPage, filters)
    })
  }, [selectedIds, fetchEvents, pagination.currentPage, filters])

  const handleExportQrPack = useCallback(async () => {
    const startDate = filters.dateFrom
    const endDate = filters.dateTo

    if (!startDate || !endDate) {
      toast.error('Select a start and end date first.')
      return
    }
    if (startDate > endDate) {
      toast.error('Start date must be before the end date.')
      return
    }

    setIsBuildingQrPack(true)
    // A pack of 28 codes per event takes a while, and a silent button for a
    // minute reads as broken. The id lets the result replace this rather than
    // stack under it.
    toast.loading('Building the QR pack. This can take a minute.', { id: 'qr-pack' })

    try {
      const response = await fetch('/api/events/qr-pack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startDate, endDate }),
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => null)
        const detail = Array.isArray(payload?.events) ? ` ${payload.events.join(', ')}` : ''
        throw new Error(`${payload?.error ?? 'Could not build the QR pack.'}${detail}`)
      }

      const blob = await response.blob()
      const filename =
        getFilenameFromHeaders(response.headers) ?? `anchor-qr-pack-${startDate}-to-${endDate}.zip`
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
      toast.success('QR pack downloaded.', { id: 'qr-pack' })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not build the QR pack.', { id: 'qr-pack' })
    } finally {
      setIsBuildingQrPack(false)
    }
  }, [filters.dateFrom, filters.dateTo])

  const handleExportDateRange = useCallback(async () => {
    const startDate = filters.dateFrom
    const endDate = filters.dateTo

    if (!startDate || !endDate) {
      toast.error('Select a start and end date first.')
      return
    }

    if (startDate > endDate) {
      toast.error('Start date must be before the end date.')
      return
    }

    setIsExporting(true)

    try {
      const params = new URLSearchParams({
        start_date: startDate,
        end_date: endDate,
      })
      const response = await fetch(`/api/events/export?${params.toString()}`)

      if (!response.ok) {
        const message = await response.text().catch(() => '')
        throw new Error(message || 'Failed to export events.')
      }

      const blob = await response.blob()
      const filename = getFilenameFromHeaders(response.headers) ?? `events_${startDate}_to_${endDate}.csv`
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)

      toast.success('CSV export downloaded.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to export events.')
    } finally {
      setIsExporting(false)
    }
  }, [filters.dateFrom, filters.dateTo])

  return (
    <PageLayout
      title="Events"
      subtitle="Manage venue events and bookings"
      headerActions={
        <>
          {view === 'list' && (
            <>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                icon={<Icon name="download" size={14} />}
                loading={isExporting}
                onClick={handleExportDateRange}
              >
                Export CSV
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                icon={<Icon name="download" size={14} />}
                loading={isBuildingQrPack}
                aria-busy={isBuildingQrPack || undefined}
                onClick={handleExportQrPack}
              >
                QR Pack for Designer
              </Button>
            </>
          )}
          <Segmented
            options={VIEW_OPTIONS}
            value={view}
            onChange={(id) => setView(id as ViewMode)}
            size="sm"
          />
          <Button
            variant="primary"
            size="sm"
            icon={<Icon name="plus" size={14} />}
            onClick={handleNewEvent}
          >
            New Event
          </Button>
        </>
      }
    >
      {/* Two columns from xl up: the events, and the outstanding todos beside them. */}
      <div className="flex flex-col gap-6 xl:flex-row">
        <div className="min-w-0 flex-1 space-y-6">
          {view === 'list' && (
            <EventFilterPanel
              filters={filters}
              onFilterChange={handleFilterChange}
              categories={categories}
            />
          )}

          <div className={isPending ? 'opacity-50 pointer-events-none' : ''}>
            {view === 'list' && listError && (
              <Alert
                tone="danger"
                title="Events could not be loaded"
                actions={
                  <Button type="button" variant="secondary" size="sm" onClick={() => fetchEvents(pagination.currentPage, filters)}>
                    Try Again
                  </Button>
                }
              >
                {listError}
              </Alert>
            )}

            {view === 'list' && !listError && (
              <EventListView
                events={events}
                pagination={pagination}
                selectedIds={selectedIds}
                onSelectionChange={setSelectedIds}
                onEventClick={handleEventClick}
                onEditEvent={handleEditEvent}
                onPageChange={handlePageChange}
                onDeleteSelected={handleDeleteSelected}
              />
            )}

            {view === 'calendar' && (
              <VenueCalendar
                events={calendarEvents}
                privateBookings={calendarBookings}
                calendarNotes={calendarNotes}
                parkingBookings={calendarParking}
                specialHours={initialSpecialHours}
                employeeBirthdays={initialBirthdays}
                balanceDueDates={initialBalanceDues}
                marketingSends={initialMarketingSends}
                dailyOps={initialDailyOps ?? undefined}
                canManageCalendarNotes={canManageCalendarNotes}
                showFilters
                onNotesChanged={fetchCalendarData}
                datasetWarnings={[
                  ...(calendarEventsError ? [`Events could not be loaded: ${calendarEventsError}`] : []),
                  ...(notesError ? [`Calendar notes could not be loaded: ${notesError}`] : []),
                  ...calendarDatasetWarnings,
                ]}
              />
            )}

            {view === 'board' && boardError && (
              <Alert
                tone="danger"
                title="Events could not be loaded"
                actions={
                  <Button type="button" variant="secondary" size="sm" onClick={fetchBoardEvents}>
                    Try Again
                  </Button>
                }
              >
                {boardError}
              </Alert>
            )}

            {view === 'board' && !boardError && !boardLoaded && (
              <PageLoading inline label="Loading events" />
            )}

            {view === 'board' && !boardError && boardLoaded && (
              <EventBoardView
                events={boardEvents}
                onEventClick={handleEventClick}
              />
            )}
          </div>
        </div>

        {todosPanel ? <aside className="xl:w-80 xl:shrink-0">{todosPanel}</aside> : null}
      </div>

      <EventDrawer
        open={drawerOpen}
        onClose={handleDrawerClose}
        event={activeEvent}
        categories={categories}
        onSave={handleSave}
      />
    </PageLayout>
  )
}
