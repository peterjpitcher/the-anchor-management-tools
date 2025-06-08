'use client'

import { formatDate } from '@/lib/dateUtils'
import Link from 'next/link'
import { use, useEffect, useState, useCallback } from 'react'
import { Event, Booking, Customer } from '@/types/database'
import { PlusIcon, TrashIcon, UserGroupIcon } from '@heroicons/react/24/outline'
import { BookingForm } from '@/components/BookingForm'
import { AddAttendeesModal } from '@/components/AddAttendeesModal'
import toast from 'react-hot-toast'
import { sendBookingConfirmation } from '@/app/actions/sms'
import { useSupabase } from '@/components/providers/SupabaseProvider'

type BookingWithCustomer = Omit<Booking, 'customer'> & {
  customer: Pick<Customer, 'first_name' | 'last_name' | 'id'>
}

export const dynamic = 'force-dynamic'

export default function EventViewPage({ params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = use(paramsPromise)
  const supabase = useSupabase()
  const [event, setEvent] = useState<Event | null>(null)
  const [bookings, setBookings] = useState<BookingWithCustomer[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showBookingForm, setShowBookingForm] = useState(false)
  const [showAddAttendeesModal, setShowAddAttendeesModal] = useState(false)

  const loadEventData = useCallback(async () => {
    try {
      setIsLoading(true)
      const { data: eventData, error: eventError } = await supabase
        .from('events')
        .select('*')
        .eq('id', params.id)
        .single()

      if (eventError) throw eventError
      setEvent(eventData)

      const { data: bookingsData, error: bookingsError } = await supabase
        .from('bookings')
        .select('*, customer:customers!inner(id, first_name, last_name)')
        .eq('event_id', params.id)
        .order('created_at', { ascending: true })

      if (bookingsError) throw bookingsError
      setBookings(bookingsData as BookingWithCustomer[])
    } catch (error) {
      console.error('Error loading event:', error)
      toast.error('Failed to load event details.')
    } finally {
      setIsLoading(false)
    }
  }, [params.id, supabase])

  useEffect(() => {
    loadEventData()
  }, [loadEventData])

  const handleCreateBooking = async (data: Omit<Booking, 'id' | 'created_at'>) => {
    try {
      const { data: newBookingData, error } = await supabase.from('bookings').insert(data).select('id').single()

      if (error || !newBookingData) {
        throw error || new Error('Failed to create booking or get its ID')
      }

      toast.success('Booking created successfully')
      setShowBookingForm(false)
      await loadEventData() // Refresh data

      // Send SMS confirmation in the background
      sendBookingConfirmation(newBookingData.id).catch(smsError => {
        console.error('Failed to send booking confirmation SMS:', smsError)
        toast.error('Booking created, but failed to send confirmation SMS.')
      })
    } catch (error) {
      console.error('Error creating booking:', error)
      toast.error('Failed to create booking')
    }
  }

  const handleAddMultipleAttendees = async (customerIds: string[]): Promise<void> => {
    if (!event) {
      toast.error('Event details not loaded.')
      return
    }
    if (customerIds.length === 0) {
      toast.error('No customers selected.')
      return
    }

    const newBookingsToInsert = customerIds.map(customerId => ({
      event_id: event.id,
      customer_id: customerId,
      seats: 0,
      notes: 'Added via bulk add',
    }))

    try {
      const { data: insertedBookings, error } = await supabase
        .from('bookings')
        .insert(newBookingsToInsert)
        .select('id')

      if (error || !insertedBookings) {
        throw error || new Error('Failed to insert bookings or retrieve their IDs.')
      }

      toast.success(`${customerIds.length} attendee(s) added successfully!`)
      setShowAddAttendeesModal(false)
      await loadEventData() // Refresh data

      // Send SMS confirmations in the background
      let smsErrorCount = 0
      for (const booking of insertedBookings) {
        sendBookingConfirmation(booking.id).catch(smsError => {
          smsErrorCount++
          console.error(`Failed to send SMS for booking ID ${booking.id}:`, smsError)
          if (smsErrorCount === insertedBookings.length) {
            toast.error('Attendees added, but all confirmation SMS failed to send.')
          }
        })
      }
    } catch (error) {
      console.error('Failed to add multiple attendees:', error)
      toast.error('An error occurred while adding attendees. Please try again.')
    }
  }

  const handleDeleteBooking = async (bookingId: string) => {
    if (!window.confirm('Are you sure you want to delete this booking?')) return

    try {
      const { error } = await supabase.from('bookings').delete().eq('id', bookingId)
      if (error) throw error
      toast.success('Booking deleted successfully')
      setBookings(bookings.filter(b => b.id !== bookingId)) // Optimistic update
    } catch (error) {
      console.error('Error deleting booking:', error)
      toast.error('Failed to delete booking')
      await loadEventData() // Re-fetch on error
    }
  }

  if (isLoading) return <div className="p-6 text-center">Loading event details...</div>
  if (!event) return <div className="p-6 text-center">Event not found.</div>

  const activeBookings = bookings.filter(booking => booking.seats && booking.seats > 0)
  const reminders = bookings.filter(booking => !booking.seats || booking.seats === 0)
  const totalSeats = activeBookings.reduce((sum, booking) => sum + (booking.seats ?? 0), 0)

  const BookingTable = ({ items, type }: { items: BookingWithCustomer[], type: 'booking' | 'reminder' }) => (
    <table className="min-w-full divide-y divide-gray-200">
      <thead>
        <tr>
          <th className="px-4 py-2 text-left text-sm font-medium text-black">Customer</th>
          <th className="px-4 py-2 text-left text-sm font-medium text-black">Created</th>
          {type === 'booking' && (
            <th className="px-4 py-2 text-left text-sm font-medium text-black">Seats</th>
          )}
          <th className="relative px-4 py-2">
            <span className="sr-only">Actions</span>
          </th>
        </tr>
      </thead>
      <tbody className="bg-white divide-y divide-gray-200">
        {items.map(booking => (
          <tr key={booking.id} className="hover:bg-gray-50">
            <td className="px-4 py-2 align-top whitespace-nowrap">
              <Link
                href={`/customers/${booking.customer.id}?booking_id=${booking.id}&return_to=/events/${params.id}`}
                className="text-blue-600 hover:text-blue-800 font-medium"
              >
                {booking.customer.first_name} {booking.customer.last_name}
              </Link>
              {booking.notes && (
                <p className="text-xs text-gray-500 mt-1 italic whitespace-pre-wrap">
                  {booking.notes}
                </p>
              )}
            </td>
            <td className="px-4 py-2 align-top whitespace-nowrap text-sm text-black">
              {formatDate(booking.created_at)}
            </td>
            {type === 'booking' && (
              <td className="px-4 py-2 whitespace-nowrap">
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                  {booking.seats} {booking.seats === 1 ? 'Seat' : 'Seats'}
                </span>
              </td>
            )}
            <td className="px-4 py-2 whitespace-nowrap text-right text-sm font-medium">
              <button
                onClick={() => handleDeleteBooking(booking.id)}
                className="text-red-600 hover:text-red-900"
                title="Delete Booking"
              >
                <TrashIcon className="h-5 w-5" />
                <span className="sr-only">Delete Booking</span>
              </button>
            </td>
          </tr>
        ))}
        {items.length === 0 && (
          <tr>
            <td colSpan={type === 'booking' ? 4 : 3} className="px-4 py-2 text-center text-sm text-gray-500">
              No {type === 'booking' ? 'bookings' : 'reminders'} found
            </td>
          </tr>
        )}
      </tbody>
    </table>
  )

  return (
    <div className="p-6">
      {showBookingForm && event && (
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-6 max-w-lg w-full mx-4">
            <BookingForm event={event} onSubmit={handleCreateBooking} onCancel={() => setShowBookingForm(false)} />
          </div>
        </div>
      )}

      {showAddAttendeesModal && event && (
        <AddAttendeesModal
          eventName={event.name}
          currentBookings={bookings}
          onClose={() => setShowAddAttendeesModal(false)}
          onAddAttendees={handleAddMultipleAttendees}
        />
      )}

      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold text-black">Event Details</h1>
        <div className="flex space-x-3">
          <button
            onClick={() => setShowAddAttendeesModal(true)}
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
          >
            <UserGroupIcon className="h-5 w-5 mr-2" />
            Add Attendees
          </button>
          <button
            onClick={() => setShowBookingForm(true)}
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            <PlusIcon className="h-5 w-5 mr-2" />
            Quick Book
          </button>
        </div>
      </div>
      <div className="bg-white shadow rounded-lg overflow-hidden mb-6">
        <div className="px-4 py-5 sm:p-6">
          <dl className="grid grid-cols-4 gap-4">
            <div>
              <dt className="text-sm font-medium text-black">Name</dt>
              <dd className="mt-1 text-black">{event.name}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-black">Date</dt>
              <dd className="mt-1 text-black">{formatDate(event.date)}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-black">Time</dt>
              <dd className="mt-1 text-black">{event.time}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-black">Total Seats</dt>
              <dd className="mt-1 text-black">{totalSeats}</dd>
            </div>
          </dl>
        </div>
      </div>

      {activeBookings.length > 0 && (
        <>
          <h2 className="text-xl font-bold mb-4 text-black">Bookings</h2>
          <div className="bg-white shadow rounded-lg overflow-hidden mb-8">
            <BookingTable items={activeBookings} type="booking" />
          </div>
        </>
      )}

      {reminders.length > 0 && (
        <>
          <h2 className="text-xl font-bold mb-4 text-black">Reminders</h2>
          <div className="bg-white shadow rounded-lg overflow-hidden">
            <BookingTable items={reminders} type="reminder" />
          </div>
        </>
      )}

      {bookings.length === 0 && (
        <div className="text-center text-black mt-8">
          No bookings or reminders found
        </div>
      )}
    </div>
  )
} 