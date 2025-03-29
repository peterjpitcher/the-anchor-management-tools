'use client'

import { Booking } from '@/types/database'
import { supabase } from '@/lib/supabase'
import { useEffect, useState } from 'react'
import { formatDate } from '@/lib/dateUtils'
import { useRouter } from 'next/navigation'
import { ArrowLeftIcon } from '@heroicons/react/24/outline'
import Link from 'next/link'

export default function BookingViewPage({ params }: { params: { id: string } }) {
  const [booking, setBooking] = useState<Booking | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const router = useRouter()

  useEffect(() => {
    loadBooking()
  }, [params.id])

  async function loadBooking() {
    try {
      const { data, error } = await supabase
        .from('bookings')
        .select(`
          *,
          customer:customers(*),
          event:events(*)
        `)
        .eq('id', params.id)
        .single()

      if (error) throw error
      setBooking(data)
    } catch (error) {
      console.error('Error loading booking:', error)
    } finally {
      setIsLoading(false)
    }
  }

  if (isLoading) {
    return <div>Loading...</div>
  }

  if (!booking) {
    return <div>Booking not found</div>
  }

  return (
    <div className="py-6">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-6">
          <button
            onClick={() => router.back()}
            className="flex items-center text-gray-600 hover:text-gray-900"
          >
            <ArrowLeftIcon className="h-5 w-5 mr-2" />
            Back to Bookings
          </button>
        </div>

        <div className="bg-white shadow overflow-hidden sm:rounded-lg">
          <div className="px-4 py-5 sm:px-6">
            <h3 className="text-2xl font-bold leading-6 text-gray-900">
              Booking Details
            </h3>
          </div>
          <div className="border-t border-gray-200">
            <dl>
              <div className="bg-gray-50 px-4 py-5 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                <dt className="text-sm font-medium text-gray-500">Customer</dt>
                <dd className="mt-1 text-sm text-gray-900 sm:col-span-2">
                  <Link
                    href={`/customers/${booking.customer_id}`}
                    className="text-indigo-600 hover:text-indigo-900"
                  >
                    {booking.customer?.first_name} {booking.customer?.last_name}
                  </Link>
                </dd>
              </div>
              <div className="bg-white px-4 py-5 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                <dt className="text-sm font-medium text-gray-500">Event</dt>
                <dd className="mt-1 text-sm text-gray-900 sm:col-span-2">
                  <Link
                    href={`/events/${booking.event_id}`}
                    className="text-indigo-600 hover:text-indigo-900"
                  >
                    {booking.event?.name}
                  </Link>
                </dd>
              </div>
              <div className="bg-gray-50 px-4 py-5 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                <dt className="text-sm font-medium text-gray-500">Event Date</dt>
                <dd className="mt-1 text-sm text-gray-900 sm:col-span-2">
                  {booking.event?.date ? formatDate(booking.event.date) : '-'}
                </dd>
              </div>
              <div className="bg-white px-4 py-5 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                <dt className="text-sm font-medium text-gray-500">Event Time</dt>
                <dd className="mt-1 text-sm text-gray-900 sm:col-span-2">
                  {booking.event?.time || '-'}
                </dd>
              </div>
              <div className="bg-gray-50 px-4 py-5 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                <dt className="text-sm font-medium text-gray-500">Seats</dt>
                <dd className="mt-1 text-sm text-gray-900 sm:col-span-2">
                  {booking.seats || '-'}
                </dd>
              </div>
              <div className="bg-white px-4 py-5 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                <dt className="text-sm font-medium text-gray-500">Booking Date</dt>
                <dd className="mt-1 text-sm text-gray-900 sm:col-span-2">
                  {formatDate(booking.created_at)}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </div>
    </div>
  )
} 