'use client'

import { useEffect, useState } from 'react'
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'
import { Event } from '@/types/database'
import { formatDate } from '@/lib/dateUtils'
import Link from 'next/link'
import { 
  CalendarIcon, 
  UserGroupIcon,
  ChartBarIcon,
  ExclamationCircleIcon,
} from '@heroicons/react/24/outline'

interface EventWithBookings extends Event {
  total_seats: number
  total_bookings: number
}

interface DashboardStats {
  totalCustomers: number
  totalUpcomingEvents: number
  totalBookings: number
  averageSeatsPerEvent: number
  eventsAtCapacity: number
  eventsNearCapacity: number
}

export default function DashboardPage() {
  const [events, setEvents] = useState<EventWithBookings[]>([])
  const [stats, setStats] = useState<DashboardStats>({
    totalCustomers: 0,
    totalUpcomingEvents: 0,
    totalBookings: 0,
    averageSeatsPerEvent: 0,
    eventsAtCapacity: 0,
    eventsNearCapacity: 0
  })
  const [isLoading, setIsLoading] = useState(true)
  const supabase = createClientComponentClient()

  useEffect(() => {
    async function loadDashboardData() {
      try {
        // Get events for the next 30 days
        const thirtyDaysFromNow = new Date()
        thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30)
        const today = new Date().toISOString().split('T')[0]
        
        // Get events
        const { data: eventsData, error: eventsError } = await supabase
          .from('events')
          .select('*')
          .gte('date', today)
          .lte('date', thirtyDaysFromNow.toISOString().split('T')[0])
          .order('date', { ascending: true })

        if (eventsError) throw eventsError

        // Get bookings for these events
        const { data: bookingsData, error: bookingsError } = await supabase
          .from('bookings')
          .select('event_id, seats')
          .in('event_id', eventsData.map(e => e.id))

        if (bookingsError) throw bookingsError

        // Get total customers
        const { count: customerCount, error: customerError } = await supabase
          .from('customers')
          .select('*', { count: 'exact' })

        if (customerError) throw customerError

        // Calculate event statistics
        const eventsWithBookings = eventsData.map(event => {
          const eventBookings = bookingsData.filter(b => b.event_id === event.id)
          const total_seats = eventBookings.reduce((sum, booking) => sum + (booking.seats || 0), 0)
          const total_bookings = eventBookings.filter(b => b.seats && b.seats > 0).length
          return { ...event, total_seats, total_bookings }
        })

        // Calculate dashboard statistics
        const totalBookings = bookingsData.filter(b => b.seats && b.seats > 0).length
        const totalSeats = bookingsData.reduce((sum, booking) => sum + (booking.seats || 0), 0)
        const eventsAtCapacity = eventsWithBookings.filter(event => 
          event.capacity && event.total_seats >= event.capacity
        ).length
        const eventsNearCapacity = eventsWithBookings.filter(event => 
          event.capacity && 
          event.total_seats >= event.capacity * 0.8 && 
          event.total_seats < event.capacity
        ).length

        setEvents(eventsWithBookings)
        setStats({
          totalCustomers: customerCount || 0,
          totalUpcomingEvents: eventsData.length,
          totalBookings,
          averageSeatsPerEvent: eventsData.length ? Math.round(totalSeats / eventsData.length) : 0,
          eventsAtCapacity,
          eventsNearCapacity
        })
      } catch (error) {
        console.error('Error loading dashboard data:', error)
      } finally {
        setIsLoading(false)
      }
    }

    loadDashboardData()
  }, [supabase])

  if (isLoading) {
    return <div>Loading...</div>
  }

  return (
    <div className="space-y-6">
      {/* Stats Overview */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="p-5">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <UserGroupIcon className="h-6 w-6 text-gray-400" aria-hidden="true" />
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 truncate">Total Customers</dt>
                  <dd className="flex items-baseline">
                    <div className="text-2xl font-semibold text-gray-900">{stats.totalCustomers}</div>
                  </dd>
                </dl>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="p-5">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <CalendarIcon className="h-6 w-6 text-gray-400" aria-hidden="true" />
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 truncate">Upcoming Events</dt>
                  <dd className="flex items-baseline">
                    <div className="text-2xl font-semibold text-gray-900">{stats.totalUpcomingEvents}</div>
                  </dd>
                </dl>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="p-5">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <ChartBarIcon className="h-6 w-6 text-gray-400" aria-hidden="true" />
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 truncate">Average Seats per Event</dt>
                  <dd className="flex items-baseline">
                    <div className="text-2xl font-semibold text-gray-900">{stats.averageSeatsPerEvent}</div>
                  </dd>
                </dl>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Capacity Alerts */}
      {(stats.eventsAtCapacity > 0 || stats.eventsNearCapacity > 0) && (
        <div className="bg-white shadow sm:rounded-lg">
          <div className="px-4 py-5 sm:p-6">
            <h3 className="text-lg leading-6 font-medium text-gray-900">Capacity Alerts</h3>
            <div className="mt-5">
              <div className="rounded-md bg-yellow-50 p-4">
                <div className="flex">
                  <div className="flex-shrink-0">
                    <ExclamationCircleIcon className="h-5 w-5 text-yellow-400" aria-hidden="true" />
                  </div>
                  <div className="ml-3">
                    <h3 className="text-sm font-medium text-yellow-800">
                      Attention needed
                    </h3>
                    <div className="mt-2 text-sm text-yellow-700">
                      <ul className="list-disc pl-5 space-y-1">
                        {stats.eventsAtCapacity > 0 && (
                          <li>
                            {stats.eventsAtCapacity} event{stats.eventsAtCapacity > 1 ? 's' : ''} at full capacity
                          </li>
                        )}
                        {stats.eventsNearCapacity > 0 && (
                          <li>
                            {stats.eventsNearCapacity} event{stats.eventsNearCapacity > 1 ? 's' : ''} near capacity (≥80%)
                          </li>
                        )}
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Upcoming Events */}
      <div className="bg-white shadow sm:rounded-lg">
        <div className="px-4 py-5 sm:p-6">
          <h3 className="text-lg leading-6 font-medium text-gray-900">
            Events in Next 30 Days
          </h3>
          <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {events.map(event => {
              const capacityPercentage = event.capacity 
                ? Math.round((event.total_seats / event.capacity) * 100) 
                : null
              const isUnderCapacity = event.capacity 
                ? event.total_seats < event.capacity 
                : true
              const remainingSeats = event.capacity 
                ? event.capacity - event.total_seats 
                : null

              return (
                <div 
                  key={event.id} 
                  className={`relative bg-white rounded-lg shadow-sm overflow-hidden border-l-4 ${
                    !isUnderCapacity 
                      ? 'border-red-500' 
                      : remainingSeats && remainingSeats <= 5 
                        ? 'border-yellow-500' 
                        : 'border-green-500'
                  }`}
                >
                  <div className="p-4">
                    <div className="flex justify-between">
                      <div className="flex-1">
                        <Link 
                          href={`/events/${event.id}`}
                          className="text-lg font-medium text-gray-900 hover:text-indigo-600"
                        >
                          {event.name}
                        </Link>
                        <p className="mt-1 text-sm text-gray-500">
                          {formatDate(event.date)} at {event.time}
                        </p>
                      </div>
                      {event.capacity && (
                        <div className="ml-4">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            !isUnderCapacity 
                              ? 'bg-red-100 text-red-800' 
                              : remainingSeats && remainingSeats <= 5 
                                ? 'bg-yellow-100 text-yellow-800' 
                                : 'bg-green-100 text-green-800'
                          }`}>
                            {capacityPercentage}% Full
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-sm font-medium text-gray-500">Bookings</p>
                        <p className="mt-1 text-lg font-semibold text-gray-900">
                          {event.total_bookings}
                        </p>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-500">Seats</p>
                        <p className="mt-1 text-lg font-semibold text-gray-900">
                          {event.total_seats}
                          {event.capacity && (
                            <span className="text-sm font-normal text-gray-500 ml-1">
                              / {event.capacity}
                            </span>
                          )}
                        </p>
                      </div>
                    </div>

                    {event.capacity && (
                      <div className="mt-4">
                        <div className="w-full bg-gray-200 rounded-full h-2">
                          <div
                            className={`h-2 rounded-full ${
                              !isUnderCapacity 
                                ? 'bg-red-500' 
                                : remainingSeats && remainingSeats <= 5 
                                  ? 'bg-yellow-500' 
                                  : 'bg-green-500'
                            }`}
                            style={{ width: `${Math.min(capacityPercentage || 0, 100)}%` }}
                          />
                        </div>
                        {isUnderCapacity && remainingSeats !== null && (
                          <p className="mt-1 text-sm text-gray-500">
                            {remainingSeats} {remainingSeats === 1 ? 'seat' : 'seats'} remaining
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}

            {events.length === 0 && (
              <div className="col-span-full text-center py-12">
                <p className="text-sm text-gray-500">No upcoming events in the next 30 days</p>
                <Link
                  href="/events"
                  className="mt-4 inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                >
                  Create an Event
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
} 