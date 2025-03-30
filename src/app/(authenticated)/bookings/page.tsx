'use client'

import { Booking, Event, Customer } from '@/types/database'
import { supabase } from '@/lib/supabase'
import { useEffect, useState } from 'react'
import { BookingForm } from '@/components/BookingForm'
import { PlusIcon, PencilIcon, TrashIcon } from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'
import { sendBookingConfirmation } from '@/app/actions/sms'
import { formatDate } from '@/lib/dateUtils'
import Link from 'next/link'

type BookingWithDetails = Booking & {
  customer: Required<Pick<Customer, 'first_name' | 'last_name'>>
  event: Required<Pick<Event, 'name' | 'date' | 'time'>>
  notes?: string
}

type GroupedBookings = {
  event: Pick<Event, 'id' | 'name' | 'date' | 'time'>
  bookings: BookingWithDetails[]
  reminders: BookingWithDetails[]
}

export default function BookingsPage() {
  const [bookings, setBookings] = useState<BookingWithDetails[]>([])
  const [events, setEvents] = useState<Event[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null)
  const [editingBooking, setEditingBooking] = useState<BookingWithDetails | null>(
    null
  )

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    try {
      // Load events
      const { data: eventsData, error: eventsError } = await supabase
        .from('events')
        .select('*')
        .order('date', { ascending: true })
        .gte('date', new Date().toISOString().split('T')[0])

      if (eventsError) throw eventsError
      setEvents(eventsData)

      // Load bookings with customer and event details
      const { data: bookingsData, error: bookingsError } = await supabase
        .from('bookings')
        .select(
          '*, customer:customers(first_name, last_name), event:events(name, date, time)'
        )
        .order('created_at', { ascending: false })

      if (bookingsError) throw bookingsError
      setBookings(bookingsData as BookingWithDetails[])
    } catch (error) {
      console.error('Error loading data:', error)
      toast.error('Failed to load data')
    } finally {
      setIsLoading(false)
    }
  }

  async function handleCreateBooking(
    bookingData: Omit<Booking, 'id' | 'created_at'>
  ) {
    try {
      const { data, error } = await supabase
        .from('bookings')
        .insert([bookingData])
        .select()
        .single()

      if (error) throw error

      // Try to send SMS but don't block on failure
      try {
        await sendBookingConfirmation(data.id)
      } catch (error) {
        console.error('Failed to send SMS:', error)
        // Don't show error toast for SMS failure
      }

      toast.success('Booking created successfully')
      await loadData() // Reload the bookings list
      
      // Don't reset the form state - let the BookingForm handle this
      // The form will clear itself if needed for "Save and Add Another"
    } catch (error) {
      console.error('Error creating booking:', error)
      toast.error('Failed to create booking')
      setShowForm(false) // Only close the form on error
      setSelectedEvent(null) // Only reset selected event on error
    }
  }

  async function handleUpdateBooking(
    bookingData: Omit<Booking, 'id' | 'created_at'>
  ) {
    if (!editingBooking) return

    try {
      const { error } = await supabase
        .from('bookings')
        .update(bookingData)
        .eq('id', editingBooking.id)

      if (error) throw error

      toast.success('Booking updated successfully')
      setEditingBooking(null)
      loadData()
    } catch (error) {
      console.error('Error updating booking:', error)
      toast.error('Failed to update booking')
    }
  }

  async function handleDeleteBooking(booking: BookingWithDetails) {
    if (!confirm('Are you sure you want to delete this booking?')) return

    try {
      const { error } = await supabase
        .from('bookings')
        .delete()
        .eq('id', booking.id)

      if (error) throw error

      toast.success('Booking deleted successfully')
      loadData()
    } catch (error) {
      console.error('Error deleting booking:', error)
      toast.error('Failed to delete booking')
    }
  }

  if (isLoading) {
    return <div>Loading...</div>
  }

  if (showForm || editingBooking) {
    const event = editingBooking?.event_id
      ? events.find((e) => e.id === editingBooking.event_id)
      : selectedEvent

    if (!event) {
      return <div>Event not found</div>
    }

    return (
      <div className="max-w-2xl mx-auto py-4">
        <h1 className="text-2xl font-bold mb-4">
          {editingBooking ? 'Edit Booking' : 'Create New Booking'}
        </h1>
        <BookingForm
          booking={editingBooking ?? undefined}
          event={event}
          onSubmit={editingBooking ? handleUpdateBooking : handleCreateBooking}
          onCancel={() => {
            setShowForm(false)
            setEditingBooking(null)
            setSelectedEvent(null)
          }}
        />
      </div>
    )
  }

  // Group bookings by event and sort them
  const groupedBookings: GroupedBookings[] = events
    .map(event => {
      const eventBookings = bookings.filter(b => b.event_id === event.id)
      return {
        event: {
          id: event.id,
          name: event.name,
          date: event.date,
          time: event.time
        },
        bookings: eventBookings
          .filter(b => b.seats && b.seats > 0)
          .sort((a, b) => (b.seats ?? 0) - (a.seats ?? 0)),
        reminders: eventBookings.filter(b => !b.seats || b.seats === 0)
      }
    })
    .filter(group => group.bookings.length > 0 || group.reminders.length > 0)
    .sort((a, b) => new Date(a.event.date).getTime() - new Date(b.event.date).getTime())

  return (
    <div className="py-4">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="sm:flex sm:items-center">
          <div className="sm:flex-auto">
            <h1 className="text-2xl font-bold text-black">Bookings</h1>
          </div>
          <div className="mt-2 sm:mt-0 sm:ml-16 sm:flex-none">
            <div className="flex items-center space-x-4">
              <select
                value={selectedEvent?.id ?? ''}
                onChange={(e) => {
                  const event = events.find((ev) => ev.id === e.target.value)
                  setSelectedEvent(event ?? null)
                }}
                className="rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
              >
                <option value="">Select an event</option>
                {events.map((event) => (
                  <option key={event.id} value={event.id}>
                    {event.name} ({formatDate(event.date)} at {event.time})
                  </option>
                ))}
              </select>
              <button
                onClick={() => {
                  if (!selectedEvent) {
                    toast.error('Please select an event first')
                    return
                  }
                  setShowForm(true)
                }}
                disabled={!selectedEvent}
                className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <PlusIcon className="-ml-1 mr-2 h-5 w-5" />
                New Booking
              </button>
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-col space-y-4">
          {groupedBookings.map(group => (
            <div key={group.event.id} className="bg-white shadow ring-1 ring-black ring-opacity-5 md:rounded-lg overflow-hidden">
              <div className="px-4 py-3 sm:px-6 bg-gray-50 border-b border-gray-200">
                <h3 className="text-lg font-medium leading-6 text-black">
                  {group.event.name}
                </h3>
                <div className="mt-0.5 flex justify-between items-center">
                  <p className="text-sm text-black">
                    {formatDate(group.event.date)} at {group.event.time}
                  </p>
                  <div className="text-sm text-black">
                    <span className="font-medium">Total Seats:</span> {group.bookings.reduce((sum, b) => sum + (b.seats || 0), 0)} 
                    {group.reminders.length > 0 && (
                      <span className="ml-4">
                        <span className="font-medium">Reminders:</span> {group.reminders.length}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {group.bookings.length > 0 && (
                <table className="min-w-full divide-y divide-gray-300">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-3.5 text-left text-sm font-semibold text-black">
                        Customer
                      </th>
                      <th className="px-3 py-3.5 text-left text-sm font-semibold text-black">
                        Seats
                      </th>
                      <th className="px-3 py-3.5 text-left text-sm font-semibold text-black">
                        Notes
                      </th>
                      <th className="relative py-3.5 pl-3 pr-4 sm:pr-6">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 bg-white">
                    {group.bookings.map((booking) => (
                      <tr key={booking.id}>
                        <td className="whitespace-nowrap px-3 py-4 text-sm text-black">
                          {booking.customer.first_name} {booking.customer.last_name}
                        </td>
                        <td className="whitespace-nowrap px-3 py-4 text-sm text-black">
                          {booking.seats}
                        </td>
                        <td className="whitespace-nowrap px-3 py-4 text-sm text-black">
                          {booking.notes || '-'}
                        </td>
                        <td className="relative whitespace-nowrap py-4 pl-3 pr-4 text-right text-sm font-medium sm:pr-6">
                          <button
                            onClick={() => setEditingBooking(booking)}
                            className="text-indigo-600 hover:text-indigo-900 mr-4"
                          >
                            <PencilIcon className="h-5 w-5" />
                            <span className="sr-only">Edit</span>
                          </button>
                          <button
                            onClick={() => handleDeleteBooking(booking)}
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
              )}

              {group.reminders.length > 0 && (
                <div className="px-4 py-3 bg-gray-50 border-t border-gray-200">
                  <h4 className="text-sm font-medium text-black mb-2">Reminders ({group.reminders.length})</h4>
                  <div className="text-sm text-black">
                    {group.reminders.map((reminder, index) => (
                      <span key={reminder.id} className="inline-block">
                        {reminder.customer.first_name} {reminder.customer.last_name}
                        {index < group.reminders.length - 1 ? ', ' : ''}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}

          {groupedBookings.length === 0 && (
            <div className="text-center text-black bg-white shadow ring-1 ring-black ring-opacity-5 md:rounded-lg p-4">
              No bookings found. Create one to get started.
            </div>
          )}
        </div>
      </div>
    </div>
  )
} 