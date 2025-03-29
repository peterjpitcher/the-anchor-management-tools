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

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Customer Details</h1>
      <div className="bg-white shadow rounded-lg p-6 mb-6">
        <h2 className="text-xl font-semibold mb-2">{customer.first_name} {customer.last_name}</h2>
        <p className="text-gray-600">Mobile: {customer.mobile_number}</p>
        <p className="text-gray-600">Created: {formatDate(customer.created_at)}</p>
      </div>

      <h2 className="text-xl font-bold mb-4">Bookings</h2>
      <div className="grid gap-4">
        {bookings.map((booking) => (
          <div key={booking.id} className="bg-white shadow rounded-lg p-4">
            <Link href={`/bookings/${booking.id}`} className="text-blue-600 hover:text-blue-800 font-medium">
              {booking.event.name}
            </Link>
            <p className="text-gray-600">Date: {formatDate(booking.event.date)}</p>
            <p className="text-gray-600">Time: {booking.event.time}</p>
            <p className="text-gray-600">Seats: {booking.seats}</p>
          </div>
        ))}
      </div>
    </div>
  )
} 