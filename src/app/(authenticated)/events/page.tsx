'use client'

import { Event } from '@/types/database'
import { supabase } from '@/lib/supabase'
import { useEffect, useState } from 'react'
import { EventForm } from '@/components/EventForm'
import { PlusIcon, PencilIcon, TrashIcon } from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'
import { formatDate } from '@/lib/dateUtils'
import Link from 'next/link'

type EventWithBookings = Event & {
  booked_seats: number
}

export default function EventsPage() {
  const [events, setEvents] = useState<EventWithBookings[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingEvent, setEditingEvent] = useState<Event | null>(null)

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    try {
      // Load events without date filter
      const { data: eventsData, error: eventsError } = await supabase
        .from('events')
        .select('*')
        .order('date', { ascending: true })

      if (eventsError) throw eventsError

      // Load bookings to calculate seats
      const { data: bookingsData, error: bookingsError } = await supabase
        .from('bookings')
        .select('event_id, seats')
        .gt('seats', 0)

      if (bookingsError) throw bookingsError

      // Calculate booked seats for each event
      const bookedSeatsMap = bookingsData.reduce((acc, booking) => {
        acc[booking.event_id] = (acc[booking.event_id] || 0) + (booking.seats || 0)
        return acc
      }, {} as Record<string, number>)

      // Combine events with their booking counts
      const eventsWithBookings = eventsData.map(event => ({
        ...event,
        booked_seats: bookedSeatsMap[event.id] || 0
      }))

      setEvents(eventsWithBookings)
    } catch (error) {
      console.error('Error loading data:', error)
      toast.error('Failed to load data')
    } finally {
      setIsLoading(false)
    }
  }

  async function handleCreateEvent(eventData: Omit<Event, 'id' | 'created_at'>) {
    try {
      const { error } = await supabase.from('events').insert([eventData])
      if (error) throw error

      toast.success('Event created successfully')
      setShowForm(false)
      loadData()
    } catch (error) {
      console.error('Error creating event:', error)
      toast.error('Failed to create event')
    }
  }

  async function handleUpdateEvent(eventData: Omit<Event, 'id' | 'created_at'>) {
    if (!editingEvent) return

    try {
      const { error } = await supabase
        .from('events')
        .update(eventData)
        .eq('id', editingEvent.id)

      if (error) throw error

      toast.success('Event updated successfully')
      setEditingEvent(null)
      loadData()
    } catch (error) {
      console.error('Error updating event:', error)
      toast.error('Failed to update event')
    }
  }

  async function handleDeleteEvent(event: Event) {
    if (!confirm('Are you sure you want to delete this event?')) return

    try {
      const { error } = await supabase
        .from('events')
        .delete()
        .eq('id', event.id)

      if (error) throw error

      toast.success('Event deleted successfully')
      loadData()
    } catch (error) {
      console.error('Error deleting event:', error)
      toast.error('Failed to delete event')
    }
  }

  if (isLoading) {
    return <div>Loading...</div>
  }

  if (showForm || editingEvent) {
    return (
      <div className="max-w-2xl mx-auto py-6">
        <h1 className="text-2xl font-bold mb-6">
          {editingEvent ? 'Edit Event' : 'Create New Event'}
        </h1>
        <EventForm
          event={editingEvent ?? undefined}
          onSubmit={editingEvent ? handleUpdateEvent : handleCreateEvent}
          onCancel={() => {
            setShowForm(false)
            setEditingEvent(null)
          }}
        />
      </div>
    )
  }

  const now = new Date()
  const upcomingEvents = events.filter(event => new Date(event.date) >= now)
  const pastEvents = events.filter(event => new Date(event.date) < now)

  const EventsTable = ({ events, title }: { events: EventWithBookings[], title: string }) => (
    <div className="bg-white shadow overflow-hidden sm:rounded-lg">
      <div className="px-4 py-5 sm:px-6">
        <h3 className="text-lg leading-6 font-medium text-black">{title}</h3>
      </div>
      
      {/* Desktop Table View */}
      <div className="hidden md:block">
        <table className="min-w-full divide-y divide-gray-300">
          <thead className="bg-gray-50">
            <tr>
              <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-black">
                Event
              </th>
              <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-black">
                Date & Time
              </th>
              <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-black">
                Capacity
              </th>
              <th scope="col" className="relative py-3.5 pl-3 pr-4 sm:pr-6">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white">
            {events.map((event) => (
              <tr key={event.id}>
                <td className="whitespace-nowrap px-3 py-4 text-sm text-black">
                  <Link href={`/events/${event.id}`} className="font-medium hover:text-indigo-600">
                    {event.name}
                  </Link>
                </td>
                <td className="whitespace-nowrap px-3 py-4 text-sm text-black">
                  {formatDate(event.date)} at {event.time}
                </td>
                <td className="px-3 py-4 text-sm text-black">
                  <div className="flex flex-col space-y-1">
                    <div className="text-sm">
                      {event.booked_seats} {event.booked_seats === 1 ? 'seat' : 'seats'} booked
                      {event.capacity ? ` (${event.capacity - event.booked_seats} remaining)` : ''}
                    </div>
                    {event.capacity && (
                      <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            event.booked_seats >= event.capacity
                              ? 'bg-red-500'
                              : event.booked_seats >= event.capacity * 0.8
                              ? 'bg-yellow-500'
                              : 'bg-green-500'
                          }`}
                          style={{ width: `${Math.min((event.booked_seats / event.capacity) * 100, 100)}%` }}
                        />
                      </div>
                    )}
                  </div>
                </td>
                <td className="relative whitespace-nowrap py-4 pl-3 pr-4 text-right text-sm font-medium sm:pr-6">
                  <button
                    onClick={() => setEditingEvent(event)}
                    className="text-indigo-600 hover:text-indigo-900 mr-4"
                  >
                    <PencilIcon className="h-5 w-5" />
                    <span className="sr-only">Edit</span>
                  </button>
                  <button
                    onClick={() => handleDeleteEvent(event)}
                    className="text-red-600 hover:text-red-900"
                  >
                    <TrashIcon className="h-5 w-5" />
                    <span className="sr-only">Delete</span>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile Card View */}
      <div className="md:hidden divide-y divide-gray-200">
        {events.map((event) => (
          <div key={event.id} className="p-4 space-y-3">
            <div className="flex justify-between items-start">
              <Link href={`/events/${event.id}`} className="flex-1">
                <h3 className="text-base font-medium text-black hover:text-indigo-600">
                  {event.name}
                </h3>
                <p className="mt-1 text-sm text-gray-500">
                  {formatDate(event.date)} at {event.time}
                </p>
              </Link>
              <div className="flex space-x-2 ml-4">
                <button
                  onClick={() => setEditingEvent(event)}
                  className="p-2 text-indigo-600 hover:text-indigo-900"
                >
                  <PencilIcon className="h-5 w-5" />
                </button>
                <button
                  onClick={() => handleDeleteEvent(event)}
                  className="p-2 text-red-600 hover:text-red-900"
                >
                  <TrashIcon className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-sm text-gray-700">
                {event.booked_seats} {event.booked_seats === 1 ? 'seat' : 'seats'} booked
                {event.capacity ? ` (${event.capacity - event.booked_seats} remaining)` : ''}
              </div>
              {event.capacity && (
                <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${
                      event.booked_seats >= event.capacity
                        ? 'bg-red-500'
                        : event.booked_seats >= event.capacity * 0.8
                        ? 'bg-yellow-500'
                        : 'bg-green-500'
                    }`}
                    style={{ width: `${Math.min((event.booked_seats / event.capacity) * 100, 100)}%` }}
                  />
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )

  return (
    <div className="py-6">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-2xl font-bold text-black">Events</h1>
          <button
            onClick={() => setShowForm(true)}
            className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
          >
            <PlusIcon className="-ml-1 mr-2 h-5 w-5" />
            New Event
          </button>
        </div>

        {events.length === 0 ? (
          <div className="text-center text-black bg-white shadow ring-1 ring-black ring-opacity-5 md:rounded-lg p-4">
            No events found. Create one to get started.
          </div>
        ) : (
          <>
            {upcomingEvents.length > 0 && (
              <EventsTable events={upcomingEvents} title="Upcoming Events" />
            )}
            {pastEvents.length > 0 && (
              <EventsTable events={pastEvents} title="Past Events" />
            )}
          </>
        )}
      </div>
    </div>
  )
}