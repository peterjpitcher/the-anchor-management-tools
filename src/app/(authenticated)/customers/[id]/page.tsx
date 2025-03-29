'use client'

import { Customer, Booking } from '@/types/database'
import { supabase } from '@/lib/supabase'
import { useEffect, useState } from 'react'
import { formatDate } from '@/lib/dateUtils'
import { useRouter } from 'next/navigation'
import { ArrowLeftIcon } from '@heroicons/react/24/outline'
import Link from 'next/link'

export default function CustomerViewPage({ params }: { params: { id: string } }) {
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [bookings, setBookings] = useState<Booking[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const router = useRouter()

  useEffect(() => {
    loadCustomer()
  }, [params.id])

  async function loadCustomer() {
    try {
      // Load customer details
      const { data: customerData, error: customerError } = await supabase
        .from('customers')
        .select('*')
        .eq('id', params.id)
        .single()

      if (customerError) throw customerError

      // Load related bookings
      const { data: bookingsData, error: bookingsError } = await supabase
        .from('bookings')
        .select(`
          *,
          event:events(*)
        `)
        .eq('customer_id', params.id)

      if (bookingsError) throw bookingsError

      setCustomer(customerData)
      setBookings(bookingsData)
    } catch (error) {
      console.error('Error loading customer:', error)
    } finally {
      setIsLoading(false)
    }
  }

  if (isLoading) {
    return <div>Loading...</div>
  }

  if (!customer) {
    return <div>Customer not found</div>
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
            Back to Customers
          </button>
        </div>

        <div className="bg-white shadow overflow-hidden sm:rounded-lg">
          <div className="px-4 py-5 sm:px-6">
            <h3 className="text-2xl font-bold leading-6 text-gray-900">
              {customer.first_name} {customer.last_name}
            </h3>
          </div>
          <div className="border-t border-gray-200">
            <dl>
              <div className="bg-gray-50 px-4 py-5 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                <dt className="text-sm font-medium text-gray-500">Mobile Number</dt>
                <dd className="mt-1 text-sm text-gray-900 sm:col-span-2">
                  {customer.mobile_number}
                </dd>
              </div>
              <div className="bg-white px-4 py-5 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                <dt className="text-sm font-medium text-gray-500">Customer Since</dt>
                <dd className="mt-1 text-sm text-gray-900 sm:col-span-2">
                  {formatDate(customer.created_at)}
                </dd>
              </div>
            </dl>
          </div>
        </div>

        <div className="mt-8">
          <h4 className="text-xl font-semibold mb-4">Bookings</h4>
          <div className="bg-white shadow overflow-hidden sm:rounded-lg">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Event
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Date
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Seats
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Booking Date
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {bookings.map((booking) => (
                  <tr key={booking.id}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      <Link
                        href={`/events/${booking.event_id}`}
                        className="text-indigo-600 hover:text-indigo-900"
                      >
                        {booking.event?.name}
                      </Link>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {booking.event?.date ? formatDate(booking.event.date) : '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {booking.seats || '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {formatDate(booking.created_at)}
                    </td>
                  </tr>
                ))}
                {bookings.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-6 py-4 text-center text-sm text-gray-500">
                      No bookings found for this customer.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
} 