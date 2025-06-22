'use client'

import { Event } from '@/types/database'
import { useSupabase } from '@/components/providers/SupabaseProvider'
import { useEffect, useState, useMemo } from 'react'
import { EventForm } from '@/components/EventForm'
import { PlusIcon, PencilIcon, TrashIcon, Cog6ToothIcon } from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'
import { formatDate } from '@/lib/dateUtils'
import Link from 'next/link'
import { Button } from '@/components/ui/Button'
import { createEvent, updateEvent, deleteEvent } from '@/app/actions/events'
import { usePagination } from '@/hooks/usePagination'
import { Pagination } from '@/components/Pagination'
import { PageLoadingSkeleton } from '@/components/ui/SkeletonLoader'

type EventWithBookings = Event & {
  booked_seats: number
  category?: {
    id: string
    name: string
    color: string
    icon: string
  } | null
}

export default function EventsPage() {
  const supabase = useSupabase()
  const [showForm, setShowForm] = useState(false)
  const [editingEvent, setEditingEvent] = useState<Event | null>(null)
  const [showPastEvents, setShowPastEvents] = useState(false)
  const [bookedSeatsMap, setBookedSeatsMap] = useState<Record<string, number>>({})

  // Memoize the query object to prevent re-renders
  const paginationQuery = useMemo(() => ({
    select: '*, category:event_categories(*)',
    orderBy: { column: 'date', ascending: true }
  }), [])

  const paginationOptions = useMemo(() => ({ pageSize: 50 }), [])

  // Use pagination hook - load all events without date filter
  const {
    data: events,
    currentPage,
    totalPages,
    totalCount,
    pageSize,
    isLoading,
    setPage,
    refresh: loadEvents
  } = usePagination<Event>(
    supabase,
    'events',
    paginationQuery,
    paginationOptions
  )

  // Load booking counts when events change
  useEffect(() => {
    if (events.length === 0) return
    
    async function loadBookings() {
      try {
        const { data: bookingsData, error: bookingsError } = await supabase
          .from('bookings')
          .select('event_id, seats')
          .gt('seats', 0)

        if (bookingsError) throw bookingsError

        const seatsMap = bookingsData.reduce((acc, booking) => {
          acc[booking.event_id] = (acc[booking.event_id] || 0) + (booking.seats || 0)
          return acc
        }, {} as Record<string, number>)

        setBookedSeatsMap(seatsMap)
      } catch (error) {
        console.error('Error loading bookings:', error)
      }
    }
    loadBookings()
  }, [supabase, events])

  // Process events with booking counts
  const eventsWithBookings = useMemo(() => {
    return events.map(event => ({
      ...event,
      booked_seats: bookedSeatsMap[event.id] || 0
    }))
  }, [events, bookedSeatsMap])

  async function handleCreateEvent(eventData: Omit<Event, 'id' | 'created_at'>) {
    try {
      const formData = new FormData()
      formData.append('name', eventData.name)
      formData.append('date', eventData.date)
      formData.append('time', eventData.time)
      // Always append capacity, even if null
      formData.append('capacity', eventData.capacity !== null ? eventData.capacity.toString() : '')
      if (eventData.category_id) {
        formData.append('category_id', eventData.category_id)
      }
      
      const result = await createEvent(formData)
      
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success('Event created successfully')
        handleCloseForm()
        await loadEvents()
      }
    } catch (error) {
      console.error('Error creating event:', error)
      toast.error('Failed to create event')
    }
  }

  async function handleUpdateEvent(eventData: Omit<Event, 'id' | 'created_at'>) {
    if (!editingEvent) return

    try {
      const formData = new FormData()
      formData.append('name', eventData.name)
      formData.append('date', eventData.date)
      formData.append('time', eventData.time)
      // Always append capacity, even if null
      formData.append('capacity', eventData.capacity !== null ? eventData.capacity.toString() : '')
      if (eventData.category_id) {
        formData.append('category_id', eventData.category_id)
      }
      
      const result = await updateEvent(editingEvent.id, formData)
      
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success('Event updated successfully')
        handleCloseForm()
        await loadEvents()
      }
    } catch (error) {
      console.error('Error updating event:', error)
      toast.error('Failed to update event')
    }
  }

  async function handleDeleteEvent(event: Event) {
    const confirmMessage = `Are you sure you want to delete the event "${event.name}"? This action cannot be undone.`
    if (!confirm(confirmMessage)) return
    
    try {
      const result = await deleteEvent(event.id)
      
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success('Event deleted successfully')
        await loadEvents()
      }
    } catch (error) {
      console.error('Error deleting event:', error)
      toast.error('Failed to delete event')
    }
  }

  const handleOpenForm = (event?: Event) => {
    setEditingEvent(event || null)
    setShowForm(true)
  }

  const handleCloseForm = () => {
    setEditingEvent(null)
    setShowForm(false)
  }

  if (isLoading) {
    return <PageLoadingSkeleton />
  }

  if (showForm) {
    return (
      <div className="bg-white shadow sm:rounded-lg">
        <div className="px-4 py-5 sm:p-6">
          <h2 className="text-xl font-semibold mb-4">
            {editingEvent ? 'Edit Event' : 'Create New Event'}
          </h2>
          <EventForm
            event={editingEvent ?? undefined}
            onSubmit={editingEvent ? handleUpdateEvent : handleCreateEvent}
            onCancel={handleCloseForm}
          />
        </div>
      </div>
    )
  }

  const now = new Date()
  now.setHours(0, 0, 0, 0)
  const allUpcomingEvents = eventsWithBookings.filter(event => new Date(event.date) >= now)
  const allPastEvents = eventsWithBookings.filter(event => new Date(event.date) < now).sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime())
  
  // Only show events based on current view
  const upcomingEvents = allUpcomingEvents
  const pastEvents = showPastEvents ? allPastEvents : []

  const EventsList = ({ events }: { events: EventWithBookings[]}) => (
    <div className="bg-white shadow overflow-hidden sm:rounded-lg">
       <div className="hidden md:block">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Event</th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date & Time</th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Capacity</th>
              <th scope="col" className="relative px-6 py-3"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {events.map((event) => (
              <tr key={event.id}>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                  <div className="flex items-center space-x-2">
                    <Link href={`/events/${event.id}`} className="text-blue-600 hover:text-blue-700">
                      {event.name}
                    </Link>
                    {event.category && (
                      <span 
                        className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
                        style={{ 
                          backgroundColor: event.category.color + '20',
                          color: event.category.color 
                        }}
                      >
                        {event.category.name}
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {formatDate(event.date)} at {event.time}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  <div className="flex items-center">
                    <span>{event.booked_seats} / {event.capacity || '∞'}</span>
                    {event.capacity && (
                      <div className="w-24 h-2 bg-gray-200 rounded-full ml-3 overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            event.booked_seats >= event.capacity ? 'bg-red-500' :
                            event.booked_seats >= event.capacity * 0.8 ? 'bg-yellow-500' : 'bg-green-500'
                          }`}
                          style={{ width: `${Math.min((event.booked_seats / (event.capacity || 1)) * 100, 100)}%` }}
                        />
                      </div>
                    )}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                  <button onClick={() => handleOpenForm(event)} className="text-blue-600 hover:text-blue-700 mr-4" aria-label="Edit event">
                    <PencilIcon className="h-5 w-5" />
                  </button>
                  <button onClick={() => handleDeleteEvent(event)} className="text-red-600 hover:text-red-900" aria-label="Delete event">
                    <TrashIcon className="h-5 w-5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
       <div className="block md:hidden">
        <ul className="divide-y divide-gray-200">
          {events.map((event) => (
            <li key={event.id} className="px-4 py-4 sm:px-6">
               <div className="flex items-center justify-between">
                 <Link href={`/events/${event.id}`} className="block hover:bg-gray-50 flex-1 min-w-0">
                    <div className="flex items-center space-x-2">
                      <p className="text-sm font-medium text-blue-600 truncate">{event.name}</p>
                      {event.category && (
                        <span 
                          className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
                          style={{ 
                            backgroundColor: event.category.color + '20',
                            color: event.category.color 
                          }}
                        >
                          {event.category.name}
                        </span>
                      )}
                    </div>
                 </Link>
                <div className="ml-2 flex-shrink-0 flex">
                    <button onClick={() => handleOpenForm(event)} className="p-1 text-gray-500 rounded-full hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500" aria-label="Edit event">
                        <PencilIcon className="h-5 w-5" />
                    </button>
                    <button onClick={() => handleDeleteEvent(event)} className="p-1 text-red-500 rounded-full hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 ml-2" aria-label="Delete event">
                        <TrashIcon className="h-5 w-5" />
                    </button>
                </div>
              </div>
              <div className="mt-2 sm:flex sm:justify-between">
                <div className="sm:flex">
                  <p className="flex items-center text-sm text-gray-500">
                    {formatDate(event.date)} at {event.time}
                  </p>
                </div>
                <div className="mt-2 flex items-center text-sm text-gray-500 sm:mt-0">
                  <p>{event.booked_seats} / {event.capacity || '∞'} seats</p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )

  return (
    <div className="space-y-6">
      <div className="bg-white shadow sm:rounded-lg">
        <div className="px-4 py-5 sm:p-6">
          <div className="flex flex-col space-y-4 sm:flex-row sm:space-y-0 sm:justify-between sm:items-center">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Events</h1>
              <p className="mt-1 text-sm text-gray-500">
                Manage your upcoming and past events.
              </p>
            </div>
            <div className="flex space-x-3">
              <Link
                href="/settings/event-categories"
                className="inline-flex items-center px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
              >
                <Cog6ToothIcon className="-ml-1 mr-2 h-5 w-5 text-gray-500" />
                Manage Categories
              </Link>
              <Button onClick={() => handleOpenForm()}>
                <PlusIcon className="-ml-1 mr-2 h-5 w-5" />
                Add Event
              </Button>
            </div>
          </div>
        </div>
      </div>

      {upcomingEvents.length > 0 && (
        <div>
          <h2 className="text-lg font-medium text-gray-900 mb-2">Upcoming Events ({upcomingEvents.length})</h2>
          <EventsList events={upcomingEvents} />
        </div>
      )}
      
      {allPastEvents.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-lg font-medium text-gray-900">Past Events ({allPastEvents.length})</h2>
            <button
              onClick={() => setShowPastEvents(!showPastEvents)}
              className="text-sm text-blue-600 hover:text-blue-700 font-medium"
            >
              {showPastEvents ? 'Hide' : 'Show'} Past Events
            </button>
          </div>
          {showPastEvents && <EventsList events={allPastEvents} />}
        </div>
      )}
      
      {upcomingEvents.length === 0 && !showPastEvents && !isLoading && (
         <div className="bg-white shadow sm:rounded-lg text-center py-12">
            <h3 className="text-lg font-medium text-gray-900">No upcoming events</h3>
            <p className="mt-1 text-sm text-gray-500">
                {allPastEvents.length > 0 
                  ? 'All events are in the past. Click "Show Past Events" above to view them.'
                  : 'Get started by creating a new event.'}
            </p>
        </div>
      )}
      
      {/* Pagination */}
      {totalPages > 1 && (
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          totalItems={totalCount}
          itemsPerPage={pageSize}
          onPageChange={setPage}
        />
      )}
    </div>
  )
}