'use client'

import { formatDate } from '@/lib/dateUtils'
import Link from 'next/link'
import { use, useEffect, useState, useCallback } from 'react'
import { Event as BaseEvent, Booking, Customer } from '@/types/database'
import { EventCategory } from '@/types/event-categories'

type Event = BaseEvent & {
  category?: EventCategory | null
}
import { PlusIcon, TrashIcon, UserGroupIcon, ClipboardDocumentIcon, PencilSquareIcon } from '@heroicons/react/24/outline'
import { BookingForm } from '@/components/BookingForm'
import { AddAttendeesModalWithCategories } from '@/components/AddAttendeesModalWithCategories'
import toast from 'react-hot-toast'
import { sendBookingConfirmationSync } from '@/app/actions/sms'
import { useSupabase } from '@/components/providers/SupabaseProvider'
import { Button } from '@/components/ui/Button'
import { EventTemplateManager } from '@/components/EventTemplateManager'

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
        .select('*, category:event_categories(*)')
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

  const handleCreateBooking = async (_data: Omit<Booking, 'id' | 'created_at'>) => {
    // The BookingForm now handles all the logic including duplicate checking
    // This function is called after successful creation/update
    setShowBookingForm(false)
    await loadEventData() // Refresh data
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

    try {
      // First, check which customers already have bookings for this event
      const { data: existingBookings, error: checkError } = await supabase
        .from('bookings')
        .select('customer_id')
        .eq('event_id', event.id)
        .in('customer_id', customerIds)

      if (checkError) {
        throw checkError
      }

      const existingCustomerIds = new Set(existingBookings?.map(b => b.customer_id) || [])
      const customersToAdd = customerIds.filter(id => !existingCustomerIds.has(id))
      const skippedCount = customerIds.length - customersToAdd.length

      if (customersToAdd.length === 0) {
        toast.error('All selected customers already have bookings for this event.')
        return
      }

      const newBookingsToInsert = customersToAdd.map(customerId => ({
        event_id: event.id,
        customer_id: customerId,
        seats: 0,
        notes: 'Added via bulk add',
      }))

      const { data: insertedBookings, error } = await supabase
        .from('bookings')
        .insert(newBookingsToInsert)
        .select('id')

      if (error || !insertedBookings) {
        throw error || new Error('Failed to insert bookings or retrieve their IDs.')
      }

      // Construct success message
      let successMessage = `${customersToAdd.length} attendee(s) added successfully!`
      if (skippedCount > 0) {
        successMessage += ` (${skippedCount} skipped - already booked)`
      }
      toast.success(successMessage)
      setShowAddAttendeesModal(false)
      await loadEventData() // Refresh data

      // Send SMS confirmations immediately
      let smsErrorCount = 0
      for (const booking of insertedBookings) {
        sendBookingConfirmationSync(booking.id).catch(smsError => {
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

  const handleCopyAttendeeList = () => {
    if (!event) return

    // Format event details
    let text = `Event: ${event.name}\n`
    text += `Date: ${formatDate(event.date)}\n`
    text += `Time: ${event.time}\n`
    text += `\n`

    // Add active bookings
    if (activeBookings.length > 0) {
      text += `Attendees (${totalSeats} seats):\n`
      activeBookings.forEach((booking, index) => {
        text += `${index + 1}. ${booking.customer.first_name} ${booking.customer.last_name} - ${booking.seats} ${booking.seats === 1 ? 'seat' : 'seats'}\n`
      })
    } else {
      text += 'No attendees yet.\n'
    }

    // Add reminders section
    if (reminders.length > 0) {
      text += `\nReminder List (${reminders.length}):\n`
      reminders.forEach((booking, index) => {
        text += `${index + 1}. ${booking.customer.first_name} ${booking.customer.last_name}\n`
      })
    }

    // Copy to clipboard
    navigator.clipboard.writeText(text).then(() => {
      toast.success('Attendee list copied to clipboard!')
    }).catch(() => {
      toast.error('Failed to copy to clipboard')
    })
  }

  if (isLoading) return <div className="p-6 text-center">Loading event details...</div>
  if (!event) return <div className="p-6 text-center">Event not found.</div>

  const activeBookings = bookings.filter(booking => booking.seats && booking.seats > 0)
  const reminders = bookings.filter(booking => !booking.seats || booking.seats === 0)
  const totalSeats = activeBookings.reduce((sum, booking) => sum + (booking.seats ?? 0), 0)

  const BookingTable = ({ items, type }: { items: BookingWithCustomer[], type: 'booking' | 'reminder' }) => (
    <div>
        {/* Desktop Table */}
        <div className="hidden md:block">
            <table className="min-w-full divide-y divide-gray-200">
            <thead>
                <tr>
                <th className="px-4 py-2 text-left text-sm font-medium text-gray-900">Customer</th>
                <th className="px-4 py-2 text-left text-sm font-medium text-gray-900">Created</th>
                {type === 'booking' && (
                    <th className="px-4 py-2 text-left text-sm font-medium text-gray-900">Seats</th>
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
                    <td className="px-4 py-2 align-top whitespace-nowrap text-sm text-gray-900">
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
        </div>
        {/* Mobile List */}
        <div className="block md:hidden">
            <ul className="divide-y divide-gray-200">
                {items.map(booking => (
                    <li key={booking.id} className="px-4 py-4">
                        <div className="flex items-center justify-between">
                             <Link
                                href={`/customers/${booking.customer.id}?booking_id=${booking.id}&return_to=/events/${params.id}`}
                                className="text-sm font-medium text-blue-600 hover:text-blue-800 truncate"
                            >
                                {booking.customer.first_name} {booking.customer.last_name}
                            </Link>
                            <div className="ml-2 flex-shrink-0 flex items-center space-x-2">
                                {type === 'booking' && (
                                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                        {booking.seats} {booking.seats === 1 ? 'Seat' : 'Seats'}
                                    </span>
                                )}
                                <button
                                    onClick={() => handleDeleteBooking(booking.id)}
                                    className="text-red-500 p-1 rounded-full hover:bg-gray-100"
                                    title="Delete Booking"
                                >
                                    <TrashIcon className="h-5 w-5" />
                                </button>
                            </div>
                        </div>
                        <div className="mt-2 sm:flex sm:justify-between">
                            <div className="sm:flex">
                                <p className="text-sm text-gray-500">
                                    Booked on: {formatDate(booking.created_at)}
                                </p>
                            </div>
                        </div>
                        {booking.notes && (
                            <p className="text-sm text-gray-500 mt-2 italic whitespace-pre-wrap">
                            {booking.notes}
                            </p>
                        )}
                    </li>
                ))}
                {items.length === 0 && (
                    <li className="px-4 py-4 text-center text-sm text-gray-500">
                        No {type === 'booking' ? 'bookings' : 'reminders'} found
                    </li>
                )}
            </ul>
        </div>
    </div>
  )

  return (
    <div className="space-y-6">
        {showBookingForm && event && (
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-6 max-w-lg w-full mx-4">
            <BookingForm event={event} onSubmit={handleCreateBooking} onCancel={() => setShowBookingForm(false)} />
          </div>
        </div>
      )}

      {showAddAttendeesModal && event && (
        <AddAttendeesModalWithCategories
          event={event}
          currentBookings={bookings}
          onClose={() => setShowAddAttendeesModal(false)}
          onAddAttendees={handleAddMultipleAttendees}
        />
      )}

      <div className="bg-white shadow sm:rounded-lg">
        <div className="px-4 py-5 sm:p-6">
          <div className="flex flex-col space-y-4 sm:flex-row sm:space-y-0 sm:justify-between sm:items-start">
            <div className="flex-1">
              <div className="flex items-start space-x-4">
                {event.hero_image_url && (
                  <div className="flex-shrink-0">
                    <img 
                      src={event.hero_image_url} 
                      alt={event.name}
                      className="h-24 w-24 rounded-lg object-cover border border-gray-200"
                    />
                  </div>
                )}
                <div>
                  <h1 className="text-2xl font-bold text-gray-900">{event.name}</h1>
                  <div className="mt-1 flex items-center space-x-2">
                    <p className="text-sm text-gray-500">
                      {formatDate(event.date)} at {event.time}
                    </p>
                    {event.category && (
                      <span 
                        className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium"
                        style={{ 
                          backgroundColor: event.category.color + '20',
                          color: event.category.color 
                        }}
                      >
                        {event.category.name}
                      </span>
                    )}
                  </div>
                  {event.description && (
                    <p className="mt-2 text-sm text-gray-600">{event.description}</p>
                  )}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href={`/events/${event.id}/edit`}>
                <Button variant="secondary">
                  <PencilSquareIcon className="h-5 w-5 mr-2" />
                  Edit Event
                </Button>
              </Link>
              <Button onClick={handleCopyAttendeeList} variant="secondary">
                <ClipboardDocumentIcon className="h-5 w-5 mr-2" />
                Copy List
              </Button>
              <Button onClick={() => setShowAddAttendeesModal(true)}>
                <UserGroupIcon className="h-5 w-5 mr-2" />
                Add Attendees
              </Button>
              <Button onClick={() => setShowBookingForm(true)}>
                <PlusIcon className="h-5 w-5 mr-2" />
                New Booking
              </Button>
              <Link href={`/loyalty/check-in?event=${event.id}`}>
                <Button variant="secondary">
                  <svg className="h-5 w-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Check-In
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white shadow sm:rounded-lg">
        <div className="px-4 py-5 sm:p-6">
          <h2 className="text-lg font-medium text-gray-900">
            Active Bookings ({activeBookings.length}) - {totalSeats} seats booked
            {event.capacity && ` of ${event.capacity}`}
          </h2>
          <div className="mt-4 flow-root">
            <div className="-mx-4 -my-2 overflow-x-auto sm:-mx-6 lg:-mx-8">
              <div className="inline-block min-w-full py-2 align-middle sm:px-6 lg:px-8">
                <BookingTable items={activeBookings} type="booking" />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white shadow sm:rounded-lg">
        <div className="px-4 py-5 sm:p-6">
          <h2 className="text-lg font-medium text-gray-900">Reminders ({reminders.length})</h2>
           <div className="mt-4 flow-root">
            <div className="-mx-4 -my-2 overflow-x-auto sm:-mx-6 lg:-mx-8">
              <div className="inline-block min-w-full py-2 align-middle sm:px-6 lg:px-8">
                <BookingTable items={reminders} type="reminder" />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white shadow sm:rounded-lg">
        <div className="px-4 py-5 sm:p-6">
          <EventTemplateManager eventId={event.id} eventName={event.name} />
        </div>
      </div>
    </div>
  )
} 