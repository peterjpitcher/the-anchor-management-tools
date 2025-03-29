'use client'

import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'
import { formatDate } from '@/lib/dateUtils'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Event, Booking, Customer } from '@/types/database'

type BookingWithCustomer = Omit<Booking, 'customer'> & {
  customer: Pick<Customer, 'first_name' | 'last_name'>
}

// @ts-expect-error - Next.js will provide the correct params type
export default function EventViewPage({ params }) {
  const [event, setEvent] = useState<Event | null>(null)
  const [bookings, setBookings] = useState<BookingWithCustomer[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const supabase = createClientComponentClient()

  useEffect(() => {
    async function loadEvent() {
      try {
        const { data: eventData, error: eventError } = await supabase
          .from('events')
          .select('*')
          .eq('id', params.id)
          .single()

        if (eventError) throw eventError

        const { data: bookingsData, error: bookingsError } = await supabase
          .from('bookings')
          .select('*, customer:customers(first_name, last_name)')
          .eq('event_id', params.id)
          .order('created_at', { ascending: true })

        if (bookingsError) throw bookingsError

        setEvent(eventData)
        setBookings(bookingsData as BookingWithCustomer[])
      } catch (error) {
        console.error('Error loading event:', error)
      } finally {
        setIsLoading(false)
      }
    }

    loadEvent()
  }, [params.id, supabase])

  if (isLoading) return <div>Loading...</div>
  if (!event) return <div>Event not found</div>

  const activeBookings = bookings.filter(booking => booking.seats && booking.seats > 0)
  const reminders = bookings.filter(booking => !booking.seats || booking.seats === 0)
  const totalSeats = activeBookings.reduce((sum, booking) => sum + (booking.seats ?? 0), 0)

  const BookingTable = ({ items, type }: { items: BookingWithCustomer[], type: 'booking' | 'reminder' }) => (
    <table className="min-w-full divide-y divide-gray-200">
      <thead className="bg-gray-50">
        <tr>
          <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-black uppercase">Customer</th>
          {type === 'booking' && (
            <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-black uppercase">Seats</th>
          )}
          <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-black uppercase">Created</th>
        </tr>
      </thead>
      <tbody className="bg-white divide-y divide-gray-200">
        {items.map((booking) => (
          <tr key={booking.id} className="hover:bg-gray-50">
            <td className="px-4 py-2 whitespace-nowrap">
              <Link href={`/bookings/${booking.id}`} className="text-blue-600 hover:text-blue-800">
                {booking.customer.first_name} {booking.customer.last_name}
              </Link>
            </td>
            {type === 'booking' && (
              <td className="px-4 py-2 whitespace-nowrap">
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                  {booking.seats} Seats
                </span>
              </td>
            )}
            <td className="px-4 py-2 whitespace-nowrap text-sm text-black">
              {formatDate(booking.created_at)}
            </td>
          </tr>
        ))}
        {items.length === 0 && (
          <tr>
            <td colSpan={type === 'booking' ? 3 : 2} className="px-4 py-2 text-center text-sm text-black">
              No {type === 'booking' ? 'bookings' : 'reminders'} found
            </td>
          </tr>
        )}
      </tbody>
    </table>
  )

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4 text-black">Event Details</h1>
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