'use client'

import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'
import { formatDate } from '@/lib/dateUtils'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Booking, Customer, Event } from '@/types/database'

type BookingWithDetails = Omit<Booking, 'customer' | 'event'> & {
  customer: Pick<Customer, 'first_name' | 'last_name'>
  event: Pick<Event, 'name' | 'date' | 'time'>
}

// @ts-expect-error - Next.js will provide the correct params type
export default function BookingViewPage({ params }) {
  const [booking, setBooking] = useState<BookingWithDetails | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const supabase = createClientComponentClient()

  useEffect(() => {
    async function loadBooking() {
      try {
        const { data: bookingData, error: bookingError } = await supabase
          .from('bookings')
          .select('*, customer:customers(first_name, last_name), event:events(name, date, time)')
          .eq('id', params.id)
          .single()

        if (bookingError) throw bookingError

        setBooking(bookingData as BookingWithDetails)
      } catch (error) {
        console.error('Error loading booking:', error)
      } finally {
        setIsLoading(false)
      }
    }

    loadBooking()
  }, [params.id, supabase])

  if (isLoading) return <div>Loading...</div>
  if (!booking) return <div>Booking not found</div>

  const isReminder = !booking.seats || booking.seats === 0

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4 text-black">
        {isReminder ? 'Reminder' : 'Booking'} Details
      </h1>
      <div className="bg-white shadow rounded-lg overflow-hidden">
        <div className="px-4 py-5 sm:p-6">
          <dl className="grid grid-cols-3 gap-4">
            <div>
              <dt className="text-sm font-medium text-black">Customer</dt>
              <dd className="mt-1">
                <Link href={`/customers/${booking.customer_id}`} className="text-blue-600 hover:text-blue-800">
                  {booking.customer.first_name} {booking.customer.last_name}
                </Link>
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-black">Event</dt>
              <dd className="mt-1">
                <Link href={`/events/${booking.event_id}`} className="text-blue-600 hover:text-blue-800">
                  {booking.event.name}
                </Link>
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-black">Type</dt>
              <dd className="mt-1">
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                  isReminder ? 'bg-purple-100 text-purple-800' : 'bg-green-100 text-green-800'
                }`}>
                  {isReminder ? 'Reminder' : `${booking.seats} Seats`}
                </span>
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-black">Date</dt>
              <dd className="mt-1 text-black">{formatDate(booking.event.date)}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-black">Time</dt>
              <dd className="mt-1 text-black">{booking.event.time}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-black">Created</dt>
              <dd className="mt-1 text-black">{formatDate(booking.created_at)}</dd>
            </div>
          </dl>
        </div>
      </div>
    </div>
  )
} 