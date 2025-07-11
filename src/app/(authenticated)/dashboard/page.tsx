import { getSupabaseAdminClient } from '@/lib/supabase-singleton'
import { formatDate } from '@/lib/dateUtils'
import Link from 'next/link'
import { CalendarIcon, UsersIcon, PlusIcon, ChatBubbleLeftIcon } from '@heroicons/react/24/outline'

async function getUpcomingEvents() {
  const supabase = getSupabaseAdminClient()
  const today = new Date().toISOString().split('T')[0]
  
  const { data: events, error } = await supabase
    .from('events')
    .select(`
      id,
      name,
      date,
      time,
      capacity,
      bookings (id, seats)
    `)
    .gte('date', today)
    .order('date', { ascending: true })
    .order('time', { ascending: true })
  
  if (error) {
    console.error('Error fetching events:', error)
    return []
  }
  
  return events.map(event => ({
    ...event,
    bookingCount: event.bookings?.reduce((sum: number, booking: any) => sum + (booking.seats || 0), 0) || 0,
    bookings: undefined
  }))
}

async function getStats() {
  const supabase = getSupabaseAdminClient()
  
  const [customersResult, messagesResult] = await Promise.all([
    supabase.from('customers').select('id', { count: 'exact', head: true }),
    supabase.from('messages').select('id', { count: 'exact', head: true }).eq('direction', 'inbound').is('read_at', null)
  ])
  
  return {
    totalCustomers: customersResult.count || 0,
    unreadMessages: messagesResult.count || 0
  }
}

export default async function SimpleDashboardPage() {
  const [events, stats] = await Promise.all([
    getUpcomingEvents(),
    getStats()
  ])

  const todayEvents = events.filter(e => e.date === new Date().toISOString().split('T')[0])
  const upcomingEvents = events.filter(e => e.date !== new Date().toISOString().split('T')[0])

  return (
    <div className="space-y-6">
      <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="mt-1 text-sm text-gray-500">
          Welcome back! Here&apos;s what&apos;s happening today.
        </p>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="px-4 py-5 sm:p-6">
            <dt className="text-sm font-medium text-gray-500 truncate">Today&apos;s Events</dt>
            <dd className="mt-1 text-3xl font-semibold text-gray-900">{todayEvents.length}</dd>
          </div>
        </div>
        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="px-4 py-5 sm:p-6">
            <dt className="text-sm font-medium text-gray-500 truncate">Total Customers</dt>
            <dd className="mt-1 text-3xl font-semibold text-gray-900">{stats.totalCustomers}</dd>
          </div>
        </div>
        <Link href="/messages" className="bg-white overflow-hidden shadow rounded-lg hover:shadow-md transition-shadow">
          <div className="px-4 py-5 sm:p-6">
            <dt className="text-sm font-medium text-gray-500 truncate">Unread Messages</dt>
            <dd className="mt-1 text-3xl font-semibold text-gray-900">{stats.unreadMessages}</dd>
          </div>
        </Link>
      </div>

      {/* Today's Events */}
      {todayEvents.length > 0 && (
        <div className="bg-white shadow rounded-lg">
          <div className="px-4 py-5 sm:p-6">
            <h2 className="text-lg font-medium text-gray-900 mb-4">Today&apos;s Events</h2>
            <div className="space-y-3">
              {todayEvents.map((event) => (
                <Link
                  key={event.id}
                  href={`/events/${event.id}`}
                  className="block hover:bg-gray-50 -mx-4 px-4 py-3 transition duration-150 ease-in-out rounded"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{event.name}</p>
                      <p className="text-sm text-gray-500">{event.time}</p>
                    </div>
                    <div className="flex items-center text-sm text-gray-500">
                      <UsersIcon className="h-5 w-5 mr-1" />
                      {event.bookingCount}/{event.capacity || '∞'}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Upcoming Events */}
      <div className="bg-white shadow rounded-lg">
        <div className="px-4 py-5 sm:p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-medium text-gray-900">Upcoming Events</h2>
            <Link href="/events" className="text-sm text-blue-600 hover:text-blue-900 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 rounded">
              View all
            </Link>
          </div>
          
          {upcomingEvents.length === 0 ? (
            <p className="text-gray-500 text-sm">No upcoming events scheduled.</p>
          ) : (
            <div className="space-y-3">
              {upcomingEvents.slice(0, 10).map((event) => {
                const eventDate = new Date(event.date)
                const isThisWeek = eventDate.getTime() - Date.now() < 7 * 24 * 60 * 60 * 1000
                
                return (
                  <Link
                    key={event.id}
                    href={`/events/${event.id}`}
                    className="block hover:bg-gray-50 -mx-4 px-4 py-3 transition duration-150 ease-in-out rounded"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-gray-900">{event.name}</p>
                        <p className="text-sm text-gray-500">
                          {formatDate(eventDate)} at {event.time}
                          {isThisWeek && <span className="ml-2 text-xs bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded">This week</span>}
                        </p>
                      </div>
                      <div className="flex items-center text-sm text-gray-500">
                        <UsersIcon className="h-5 w-5 mr-1" />
                        {event.bookingCount}/{event.capacity || '∞'}
                      </div>
                    </div>
                  </Link>
                )
              })}
              {upcomingEvents.length > 10 && (
                <p className="text-sm text-gray-500 text-center pt-2">
                  And {upcomingEvents.length - 10} more events...
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Link href="/events/new" className="bg-white shadow rounded-lg p-4 text-center hover:shadow-md transition-shadow">
          <CalendarIcon className="h-8 w-8 mx-auto text-gray-400 mb-2" />
          <p className="text-sm font-medium text-gray-900">New Event</p>
        </Link>
        <Link href="/customers" className="bg-white shadow rounded-lg p-4 text-center hover:shadow-md transition-shadow">
          <UsersIcon className="h-8 w-8 mx-auto text-gray-400 mb-2" />
          <p className="text-sm font-medium text-gray-900">Customers</p>
        </Link>
        <Link href="/messages" className="bg-white shadow rounded-lg p-4 text-center hover:shadow-md transition-shadow">
          <div className="relative inline-block">
            <ChatBubbleLeftIcon className="h-8 w-8 mx-auto text-gray-400 mb-2" />
            {stats.unreadMessages > 0 && (
              <span className="absolute -top-1 -right-1 h-3 w-3 bg-red-500 rounded-full"></span>
            )}
          </div>
          <p className="text-sm font-medium text-gray-900">Messages</p>
        </Link>
        <Link href="/private-bookings/new" className="bg-white shadow rounded-lg p-4 text-center hover:shadow-md transition-shadow">
          <PlusIcon className="h-8 w-8 mx-auto text-gray-400 mb-2" />
          <p className="text-sm font-medium text-gray-900">Private Booking</p>
        </Link>
      </div>
    </div>
  )
}