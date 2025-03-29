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

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Event Details</h1>
      <div className="bg-white shadow rounded-lg p-6 mb-6">
        <h2 className="text-xl font-semibold mb-2">{event.name}</h2>
        <p className="text-gray-600">Date: {formatDate(event.date)}</p>
        <p className="text-gray-600">Time: {event.time}</p>
        <p className="text-gray-600">Created: {formatDate(event.created_at)}</p>
      </div>

      <h2 className="text-xl font-bold mb-4">Bookings</h2>
      <div className="grid gap-4">
        {bookings.map((booking) => (
          <div key={booking.id} className="bg-white shadow rounded-lg p-4">
            <Link href={`/bookings/${booking.id}`} className="text-blue-600 hover:text-blue-800 font-medium">
              {booking.customer.first_name} {booking.customer.last_name}
            </Link>
            <p className="text-gray-600">Seats: {booking.seats}</p>
            <p className="text-gray-600">Booked: {formatDate(booking.created_at)}</p>
          </div>
        ))}
      </div>
    </div>
  )
} 