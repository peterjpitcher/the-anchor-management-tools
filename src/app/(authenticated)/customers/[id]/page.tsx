'use client'

import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'
import { formatDate } from '@/lib/dateUtils'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Customer, Booking, Event } from '@/types/database'

type BookingWithEvent = Omit<Booking, 'event'> & {
  event: Pick<Event, 'name' | 'date' | 'time'>
}

// @ts-expect-error - Next.js will provide the correct params type
export default function CustomerViewPage({ params }) {
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [bookings, setBookings] = useState<BookingWithEvent[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const supabase = createClientComponentClient()

  useEffect(() => {
    async function loadCustomer() {
      try {
        const { data: customerData, error: customerError } = await supabase
          .from('customers')
          .select('*')
          .eq('id', params.id)
          .single()

        if (customerError) throw customerError

        const { data: bookingsData, error: bookingsError } = await supabase
          .from('bookings')
          .select('*, event:events(name, date, time)')
          .eq('customer_id', params.id)
          .order('created_at', { ascending: true })

        if (bookingsError) throw bookingsError

        setCustomer(customerData)
        setBookings(bookingsData as BookingWithEvent[])
      } catch (error) {
        console.error('Error loading customer:', error)
      } finally {
        setIsLoading(false)
      }
    }

    loadCustomer()
  }, [params.id, supabase])

  if (isLoading) return <div>Loading...</div>
  if (!customer) return <div>Customer not found</div>

  const activeBookings = bookings.filter(booking => booking.seats && booking.seats > 0)
  const reminders = bookings.filter(booking => !booking.seats || booking.seats === 0)
  const totalSeats = activeBookings.reduce((sum, booking) => sum + (booking.seats ?? 0), 0)

  const BookingTable = ({ items, type }: { items: BookingWithEvent[], type: 'booking' | 'reminder' }) => (
    <table className="min-w-full divide-y divide-gray-200">
      <thead className="bg-gray-50">
        <tr>
          <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-black uppercase">Event</th>
          <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-black uppercase">Date</th>
          <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-black uppercase">Time</th>
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
                {booking.event.name}
              </Link>
            </td>
            <td className="px-4 py-2 whitespace-nowrap text-sm text-black">
              {formatDate(booking.event.date)}
            </td>
            <td className="px-4 py-2 whitespace-nowrap text-sm text-black">
              {booking.event.time}
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
            <td colSpan={type === 'booking' ? 5 : 4} className="px-4 py-2 text-center text-sm text-gray-500">
              No {type === 'booking' ? 'bookings' : 'reminders'} found
            </td>
          </tr>
        )}
      </tbody>
    </table>
  )

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4 text-black">Customer Details</h1>
      <div className="bg-white shadow rounded-lg overflow-hidden mb-6">
        <div className="px-4 py-5 sm:p-6">
          <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <dt className="text-sm font-medium text-black">Name</dt>
              <dd className="mt-1 text-black">{customer.first_name} {customer.last_name}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-black">Mobile</dt>
              <dd className="mt-1 text-black">{customer.mobile_number}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-black">Total Seats</dt>
              <dd className="mt-1 text-black">{totalSeats}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-black">Created</dt>
              <dd className="mt-1 text-black">{formatDate(customer.created_at)}</dd>
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