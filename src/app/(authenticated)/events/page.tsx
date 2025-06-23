import { getSupabaseAdminClient } from '@/lib/supabase-singleton'
import { formatDate } from '@/lib/dateUtils'
import Link from 'next/link'
import { PlusIcon, CalendarIcon, Cog6ToothIcon } from '@heroicons/react/24/outline'
import { Button } from '@/components/ui/Button'

async function getEvents() {
  const supabase = getSupabaseAdminClient()
  
  const { data: events, error } = await supabase
    .from('events')
    .select(`
      *,
      category:event_categories(*),
      bookings (id)
    `)
    .order('date', { ascending: true })
    .order('time', { ascending: true })
  
  if (error) {
    console.error('Error fetching events:', error)
    return []
  }
  
  return events.map(event => ({
    ...event,
    booked_seats: event.bookings?.length || 0,
    bookings: undefined
  }))
}

export default async function EventsPage() {
  const events = await getEvents()
  const today = new Date().toISOString().split('T')[0]
  
  const pastEvents = events.filter(e => e.date < today)
  const futureEvents = events.filter(e => e.date >= today)
  
  return (
    <div className="space-y-6">
      <div className="bg-white shadow sm:rounded-lg">
        <div className="px-4 py-5 sm:p-6">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Events</h1>
              <p className="mt-1 text-sm text-gray-500">
                Manage your events and track bookings
              </p>
            </div>
            <div className="flex space-x-3">
              <Link
                href="/settings/event-categories"
                className="inline-flex items-center px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
              >
                <Cog6ToothIcon className="-ml-1 mr-2 h-5 w-5 text-gray-500" />
                Manage Categories
              </Link>
              <Link href="/events/new">
                <Button>
                  <PlusIcon className="-ml-1 mr-2 h-5 w-5" />
                  Create Event
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Upcoming Events */}
      <div className="bg-white shadow overflow-hidden sm:rounded-lg">
        <div className="px-4 py-5 sm:px-6 bg-gray-50">
          <h2 className="text-lg font-medium text-gray-900">Upcoming Events</h2>
        </div>
        <div className="border-t border-gray-200">
          {futureEvents.length === 0 ? (
            <div className="px-4 py-12 text-center">
              <CalendarIcon className="mx-auto h-12 w-12 text-gray-400" />
              <h3 className="mt-2 text-sm font-medium text-gray-900">No upcoming events</h3>
              <p className="mt-1 text-sm text-gray-500">Get started by creating a new event.</p>
              <div className="mt-6">
                <Link href="/events/new">
                  <Button size="sm">
                    <PlusIcon className="-ml-1 mr-2 h-5 w-5" />
                    New Event
                  </Button>
                </Link>
              </div>
            </div>
          ) : (
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Event
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Date & Time
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Bookings
                  </th>
                  <th scope="col" className="relative px-6 py-3">
                    <span className="sr-only">View</span>
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {futureEvents.map((event) => {
                  const eventDate = new Date(event.date)
                  const isToday = event.date === today
                  const isFull = event.capacity && event.booked_seats >= event.capacity
                  
                  return (
                    <tr key={event.id} className={isToday ? 'bg-yellow-50' : ''}>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div>
                          <div className="text-sm font-medium text-gray-900">
                            {event.name}
                          </div>
                          {event.category && (
                            <div className="text-sm text-gray-500">
                              <span 
                                className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
                                style={{ 
                                  backgroundColor: `${event.category.color}20`,
                                  color: event.category.color 
                                }}
                              >
                                {event.category.name}
                              </span>
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        <div>
                          {formatDate(eventDate)}
                          {isToday && <span className="ml-2 text-xs bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded">Today</span>}
                        </div>
                        <div className="text-sm text-gray-500">{event.time}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">
                          {event.booked_seats} / {event.capacity || '∞'}
                        </div>
                        {event.capacity && (
                          <div className="mt-1 w-full bg-gray-200 rounded-full h-2">
                            <div
                              className={`h-2 rounded-full ${
                                isFull ? 'bg-red-600' : 
                                event.booked_seats / event.capacity > 0.8 ? 'bg-yellow-500' : 
                                'bg-green-500'
                              }`}
                              style={{ width: `${Math.min((event.booked_seats / event.capacity) * 100, 100)}%` }}
                            />
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <Link href={`/events/${event.id}`} className="text-blue-600 hover:text-blue-900">
                          View
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Past Events */}
      {pastEvents.length > 0 && (
        <details className="bg-white shadow overflow-hidden sm:rounded-lg">
          <summary className="px-4 py-5 sm:px-6 bg-gray-50 cursor-pointer hover:bg-gray-100">
            <h2 className="text-lg font-medium text-gray-900 inline">Past Events ({pastEvents.length})</h2>
          </summary>
          <div className="border-t border-gray-200">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Event
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Date
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Attendance
                  </th>
                  <th scope="col" className="relative px-6 py-3">
                    <span className="sr-only">View</span>
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {pastEvents.slice(-20).reverse().map((event) => (
                  <tr key={event.id} className="text-gray-500">
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      {event.name}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      {formatDate(new Date(event.date))}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      {event.booked_seats}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <Link href={`/events/${event.id}`} className="text-blue-600 hover:text-blue-900">
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  )
}