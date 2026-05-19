'use client'

import { useState, useCallback, useTransition, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getTodayIsoDate } from '@/lib/dateUtils'
import { PageHeader, Segmented } from '@/ds'
import { Button } from '@/ds'
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
} from '@/components/schedule-calendar'
import type { Event } from '@/types/database'
import type { EventCategory } from '@/types/event-categories'
import { getEvents, deleteEvent } from '@/app/actions/events'
import { fetchPrivateBookingsForCalendar } from '@/app/actions/private-bookings-dashboard'
import { listCalendarNotes } from '@/app/actions/calendar-notes'
import { listParkingBookings } from '@/app/actions/parking'
import { toast } from '@/ds'

type ViewMode = 'list' | 'calendar' | 'board'

const VIEW_OPTIONS = [
  { id: 'list', label: 'List' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'board', label: 'Board' },
]

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
}

export default function EventsClient({
  initialEvents,
  initialPagination,
  categories,
  initialCalendarEvents,
  initialCalendarBookings,
  initialCalendarNotes,
  initialCalendarParking,
}: EventsClientProps) {
  const router = useRouter()
  const [view, setView] = useState<ViewMode>('calendar')
  const [events, setEvents] = useState<Event[]>(initialEvents)
  const [calendarEvents, setCalendarEvents] = useState<VenueCalendarEvent[]>(
    () => (initialCalendarEvents ?? []).map(e => ({
      id: e.id,
      name: e.name,
      date: e.date,
      time: e.time,
      bookedSeatsCount: (e as Event & { booked_count?: number }).booked_count ?? 0,
      eventStatus: e.event_status,
    }))
  )
  const [calendarBookings, setCalendarBookings] = useState<VenueCalendarBooking[]>(initialCalendarBookings ?? [])
  const [calendarNotes, setCalendarNotes] = useState<VenueCalendarNote[]>(initialCalendarNotes ?? [])
  const [calendarParking, setCalendarParking] = useState<VenueCalendarParking[]>(initialCalendarParking ?? [])
  const [boardEvents, setBoardEvents] = useState<Event[]>([])

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
  const [isPending, startTransition] = useTransition()

  const fetchEvents = useCallback(
    (page: number, currentFilters: EventFilters) => {
      startTransition(async () => {
        const result = await getEvents({
          status: currentFilters.status === 'all' ? 'all' : currentFilters.status as 'scheduled' | 'cancelled' | 'postponed' | 'rescheduled' | 'sold_out',
          searchTerm: currentFilters.searchTerm || undefined,
          dateFrom: currentFilters.dateFrom || undefined,
          dateTo: currentFilters.dateTo || undefined,
          page,
          pageSize: 25,
        })
        if (result.data) {
          setEvents(result.data)
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
          listParkingBookings({ limit: 500 }),
        ])
        if (eventsResult.data) {
          setCalendarEvents(eventsResult.data.map(e => ({
            id: e.id,
            name: e.name,
            date: e.date,
            time: e.time,
            bookedSeatsCount: (e as Event & { booked_count?: number }).booked_count ?? 0,
            eventStatus: e.event_status,
          })))
        }
        if ('data' in bookingsResult && bookingsResult.data) {
          setCalendarBookings(bookingsResult.data as VenueCalendarBooking[])
        }
        if (notesResult.data) setCalendarNotes(notesResult.data)
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

  const handleNewEvent = useCallback(() => {
    setActiveEvent(null)
    setDrawerOpen(true)
  }, [])

  const handleDrawerClose = useCallback(() => {
    setDrawerOpen(false)
    setActiveEvent(null)
  }, [])

  const handleSave = useCallback(() => {
    handleDrawerClose()
    if (view === 'calendar') {
      fetchCalendarData()
    } else if (view === 'board') {
      fetchBoardEvents()
    } else {
      fetchEvents(pagination.currentPage, filters)
    }
  }, [handleDrawerClose, view, fetchCalendarData, fetchBoardEvents, fetchEvents, pagination.currentPage, filters])

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

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Events"
        subtitle="Manage venue events and bookings"
        actions={
          <div className="flex items-center gap-3">
            <Segmented
              options={VIEW_OPTIONS}
              value={view}
              onChange={(id) => setView(id as ViewMode)}
              size="sm"
            />
            <Button
              variant="primary"
              icon={<Icon name="plus" size={16} />}
              onClick={handleNewEvent}
            >
              New Event
            </Button>
          </div>
        }
      />

      {view === 'list' && (
        <EventFilterPanel
          filters={filters}
          onFilterChange={handleFilterChange}
          categories={categories}
        />
      )}

      <div className={isPending ? 'opacity-60 pointer-events-none' : ''}>
        {view === 'list' && (
          <EventListView
            events={events}
            pagination={pagination}
            selectedIds={selectedIds}
            onSelectionChange={setSelectedIds}
            onEventClick={handleEventClick}
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
          />
        )}

        {view === 'board' && (
          <EventBoardView
            events={boardEvents}
            onEventClick={handleEventClick}
          />
        )}
      </div>

      <EventDrawer
        open={drawerOpen}
        onClose={handleDrawerClose}
        event={activeEvent}
        categories={categories}
        onSave={handleSave}
      />
    </div>
  )
}
