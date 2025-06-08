'use client'

import { formatDate } from '@/lib/dateUtils'
import Link from 'next/link'
import { use, useEffect, useState, useCallback } from 'react'
import { Customer, Booking, Event } from '@/types/database'
import { PencilIcon, TrashIcon, ArrowLeftIcon } from '@heroicons/react/24/outline'
import { BookingForm } from '@/components/BookingForm'
import toast from 'react-hot-toast'
import { useSearchParams, useRouter } from 'next/navigation'
import { useSupabase } from '@/components/providers/SupabaseProvider'

type BookingWithEvent = Omit<Booking, 'event'> & {
  event: Pick<Event, 'id' | 'name' | 'date' | 'time' | 'capacity' | 'created_at'>
}

export const dynamic = 'force-dynamic'

export default function CustomerViewPage({ params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = use(paramsPromise)
  const supabase = useSupabase()
  const router = useRouter()
  const searchParams = useSearchParams()

  const [customer, setCustomer] = useState<Customer | null>(null)
  const [bookings, setBookings] = useState<BookingWithEvent[]>([])
  const [allEvents, setAllEvents] = useState<Event[]>([])
  const [loading, setLoading] = useState(true)

  // Modal states
  const [editingBooking, setEditingBooking] = useState<BookingWithEvent | undefined>(undefined)
  const [isAddingBooking, setIsAddingBooking] = useState(false)
  const [eventForNewBooking, setEventForNewBooking] = useState<Event | undefined>(undefined)

  const loadData = useCallback(async () => {
    try {
      setLoading(true)
      const { data: customerData, error: customerError } = await supabase
        .from('customers')
        .select('*')
        .eq('id', params.id)
        .single()

      if (customerError) throw customerError
      setCustomer(customerData)

      const { data: bookingsData, error: bookingsError } = await supabase
        .from('bookings')
        .select('*, event:events(id, name, date, time, capacity, created_at)')
        .eq('customer_id', params.id)
        .order('created_at', { ascending: false })

      if (bookingsError) throw bookingsError
      setBookings(bookingsData as BookingWithEvent[])

      const { data: eventsData, error: eventsError } = await supabase.from('events').select('*').order('date')
      if (eventsError) throw eventsError
      setAllEvents(eventsData)
    } catch (error) {
      console.error('Error loading customer details:', error)
      toast.error('Failed to load customer details.')
    } finally {
      setLoading(false)
    }
  }, [params.id, supabase])

  useEffect(() => {
    loadData()
  }, [loadData])

  useEffect(() => {
    const bookingId = searchParams.get('booking_id')
    if (bookingId && bookings.length > 0) {
      const bookingToEdit = bookings.find(b => b.id === bookingId)
      if (bookingToEdit) {
        setEditingBooking(bookingToEdit)
      }
    }
  }, [bookings, searchParams])

  const closeModal = () => {
    setEditingBooking(undefined)
    setIsAddingBooking(false)
    setEventForNewBooking(undefined)
    const newParams = new URLSearchParams(searchParams.toString())
    newParams.delete('booking_id')
    router.push(`${window.location.pathname}?${newParams.toString()}`)
  }

  const handleUpdateBooking = async (data: Omit<Booking, 'id' | 'created_at'>) => {
    if (!editingBooking) return

    const { error } = await supabase.from('bookings').update(data).eq('id', editingBooking.id)

    if (error) {
      toast.error(`Failed to update booking: ${error.message}`)
    } else {
      toast.success('Booking updated successfully!')
      const returnTo = searchParams.get('return_to')
      if (returnTo) {
        router.push(returnTo)
      } else {
        closeModal()
        await loadData() // Refresh data
      }
    }
  }

  const handleAddBooking = async (data: Omit<Booking, 'id' | 'created_at'>) => {
    const { error } = await supabase.from('bookings').insert(data)

    if (error) {
      toast.error(`Failed to add booking: ${error.message}`)
    } else {
      toast.success('Booking added successfully!')
      const returnTo = searchParams.get('return_to')
      if (returnTo) {
        router.push(returnTo)
      } else {
        closeModal()
        await loadData() // Refresh data
      }
    }
  }

  const handleDeleteBooking = async (bookingId: string) => {
    if (window.confirm('Are you sure you want to delete this booking?')) {
      const { error } = await supabase.from('bookings').delete().eq('id', bookingId)
      if (error) {
        toast.error(`Failed to delete booking: ${error.message}`)
      } else {
        toast.success('Booking deleted.')
        setBookings(bookings.filter(b => b.id !== bookingId))
      }
    }
  }

  if (loading) return <div className="text-center p-4">Loading customer details...</div>
  if (!customer) return <div className="text-center p-4">Customer not found.</div>

  const showModal = !!editingBooking || isAddingBooking
  const activeBookings = bookings.filter(booking => booking.seats && booking.seats > 0)
  const reminders = bookings.filter(booking => !booking.seats || booking.seats === 0)
  const totalSeats = activeBookings.reduce((sum, booking) => sum + (booking.seats ?? 0), 0)

  const BookingTable = ({ items, type }: { items: BookingWithEvent[]; type: 'booking' | 'reminder' }) => (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-black uppercase">
              Event
            </th>
            <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-black uppercase">
              Date
            </th>
            {type === 'booking' && (
              <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-black uppercase">
                Seats
              </th>
            )}
            <th scope="col" className="relative py-3.5 pl-3 pr-4 sm:pr-6">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {items.map(booking => (
            <tr key={booking.id} className="hover:bg-gray-50">
              <td className="px-4 py-2 whitespace-nowrap">
                <Link href={`/events/${booking.event.id}`} className="text-blue-600 hover:text-blue-800">
                  {booking.event.name}
                </Link>
              </td>
              <td className="px-4 py-2 whitespace-nowrap text-sm text-black">
                {formatDate(booking.event.date)} @ {booking.event.time}
              </td>
              {type === 'booking' && (
                <td className="px-4 py-2 whitespace-nowrap">
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                    {booking.seats} Seats
                  </span>
                </td>
              )}
              <td className="relative whitespace-nowrap py-4 pl-3 pr-4 text-right text-sm font-medium sm:pr-6">
                <button
                  onClick={() => setEditingBooking(booking)}
                  className="text-indigo-600 hover:text-indigo-900 mr-4"
                >
                  <PencilIcon className="h-5 w-5" />
                  <span className="sr-only">Edit</span>
                </button>
                <button
                  onClick={() => handleDeleteBooking(booking.id)}
                  className="text-red-600 hover:text-red-900"
                >
                  <TrashIcon className="h-5 w-5" />
                  <span className="sr-only">Delete</span>
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
  )

  return (
    <div className="p-4 sm:p-6">
      <div className="flex justify-between items-start mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">
            {customer.first_name} {customer.last_name}
          </h1>
          <p className="text-sm text-gray-600 mt-1">{customer.mobile_number}</p>
        </div>
        <button
          onClick={() => setIsAddingBooking(true)}
          className="bg-blue-500 text-white px-4 py-2 rounded-md hover:bg-blue-600"
        >
          Add Booking
        </button>
      </div>

      <div className="bg-white shadow rounded-lg overflow-hidden mb-6">
        <div className="px-4 py-5 sm:p-6">
          <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <dt className="text-sm font-medium text-black">Name</dt>
              <dd className="mt-1 text-black">
                {customer.first_name} {customer.last_name}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-black">Mobile</dt>
              <dd className="mt-1 text-black">{customer.mobile_number}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-black">Total Seats Booked</dt>
              <dd className="mt-1 text-black">{totalSeats}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-black">Customer Since</dt>
              <dd className="mt-1 text-black">{formatDate(customer.created_at)}</dd>
            </div>
          </dl>
        </div>
      </div>

      <div className="space-y-8">
        {activeBookings.length > 0 && (
          <div>
            <h2 className="text-xl font-bold mb-4 text-black">Active Bookings</h2>
            <div className="bg-white shadow rounded-lg overflow-hidden">
              <BookingTable items={activeBookings} type="booking" />
            </div>
          </div>
        )}

        {reminders.length > 0 && (
          <div>
            <h2 className="text-xl font-bold mb-4 text-black">Reminders</h2>
            <div className="bg-white shadow rounded-lg overflow-hidden">
              <BookingTable items={reminders} type="reminder" />
            </div>
          </div>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-60 z-40 flex justify-center items-center p-4">
          <div className="bg-white p-6 rounded-lg shadow-2xl z-50 w-full max-w-lg max-h-[90vh] flex flex-col">
            {!eventForNewBooking && isAddingBooking ? (
              // Step 1: Select Event
              <>
                <h2 className="text-xl font-bold mb-4">Select an Event</h2>
                <div className="overflow-y-auto space-y-2">
                  {allEvents.map(event => (
                    <div
                      key={event.id}
                      onClick={() => setEventForNewBooking(event)}
                      className="p-3 bg-gray-100 rounded-md hover:bg-gray-200 cursor-pointer"
                    >
                      <p className="font-semibold">{event.name}</p>
                      <p className="text-sm text-gray-600">
                        {formatDate(event.date)} @ {event.time}
                      </p>
                    </div>
                  ))}
                </div>
                <button onClick={closeModal} className="mt-4 bg-gray-200 text-gray-800 px-4 py-2 rounded-md hover:bg-gray-300 self-start">
                  Cancel
                </button>
              </>
            ) : (
              // Step 2: Fill Booking Form
              <>
                <div className="flex items-center mb-4">
                  {isAddingBooking && (
                    <button onClick={() => setEventForNewBooking(undefined)} className="mr-4 p-1 rounded-full hover:bg-gray-200">
                      <ArrowLeftIcon className="h-5 w-5" />
                    </button>
                  )}
                  <h2 className="text-xl font-bold">
                    {editingBooking ? 'Edit Booking' : 'Add New Booking'}
                  </h2>
                </div>
                <BookingForm
                  booking={editingBooking}
                  event={editingBooking?.event || eventForNewBooking!}
                  onSubmit={editingBooking ? handleUpdateBooking : handleAddBooking}
                  onCancel={closeModal}
                />
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
} 