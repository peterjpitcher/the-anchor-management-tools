'use client'

import { useState, useCallback, useTransition } from 'react'
import { PageHeader, Segmented } from '@/ds'
import { Button } from '@/ds'
import { Icon } from '@/ds/icons'
import { EventListView } from './EventListView'
import { EventCalendarView } from './EventCalendarView'
import { EventBoardView } from './EventBoardView'
import { EventDrawer } from './EventDrawer'
import { EventFilterPanel, type EventFilters } from './EventFilterPanel'
import type { Event } from '@/types/database'
import type { EventCategory } from '@/types/event-categories'
import { getEvents, deleteEvent } from '@/app/actions/events'
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
}

export default function EventsClient({
  initialEvents,
  initialPagination,
  categories,
}: EventsClientProps) {
  const [view, setView] = useState<ViewMode>('list')
  const [events, setEvents] = useState<Event[]>(initialEvents)
  const [pagination, setPagination] = useState(
    initialPagination ?? { totalCount: 0, currentPage: 1, pageSize: 25, totalPages: 1 }
  )
  const [filters, setFilters] = useState<EventFilters>({
    searchTerm: '',
    category: 'all',
    status: 'all',
    dateFrom: '',
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

  const handleSave = useCallback(() => {
    handleDrawerClose()
    fetchEvents(pagination.currentPage, filters)
  }, [handleDrawerClose, fetchEvents, pagination.currentPage, filters])

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

      <EventFilterPanel
        filters={filters}
        onFilterChange={handleFilterChange}
        categories={categories}
      />

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
          <EventCalendarView
            events={events}
            onEventClick={handleEventClick}
          />
        )}

        {view === 'board' && (
          <EventBoardView
            events={events}
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
