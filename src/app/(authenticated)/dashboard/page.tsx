import { getSupabaseAdminClient } from '@/lib/supabase-singleton'
import { formatDate } from '@/lib/dateUtils'
import Link from 'next/link'
import { CalendarIcon, UsersIcon, PlusIcon, ChatBubbleLeftIcon } from '@heroicons/react/24/outline'
import { Page } from '@/components/ui-v2/layout/Page'
import { Card, CardTitle } from '@/components/ui-v2/layout/Card'
import { Section } from '@/components/ui-v2/layout/Section'
import { Stat, StatGroup } from '@/components/ui-v2/display/Stat'
import { Badge } from '@/components/ui-v2/display/Badge'
import { EmptyState } from '@/components/ui-v2/display/EmptyState'
import { List, SimpleList } from '@/components/ui-v2/display/List'
import { LinkButton } from '@/components/ui-v2/navigation/LinkButton'

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
    <Page
      title="Dashboard"
      description="Welcome back! Here's what's happening today."
    >

      {/* Quick Stats */}
      <StatGroup>
        <Stat
          label="Today's Events"
          value={todayEvents.length}
        />
        <Stat
          label="Total Customers"
          value={stats.totalCustomers.toLocaleString()}
        />
        <Stat
          label="Unread Messages"
          value={stats.unreadMessages}
          href="/messages"
          change={stats.unreadMessages > 0 ? `${stats.unreadMessages} new` : undefined}
          changeType={stats.unreadMessages > 0 ? 'increase' : undefined}
        />
      </StatGroup>

      {/* Today's Events */}
      {todayEvents.length > 0 && (
        <Card 
          header={<CardTitle>Today&apos;s Events</CardTitle>}
        >
          <SimpleList
            items={todayEvents.map(event => ({
              id: event.id,
              title: event.name,
              subtitle: event.time,
              href: `/events/${event.id}`,
              meta: (
                <div className="flex items-center text-sm text-gray-500">
                  <UsersIcon className="h-5 w-5 mr-1 flex-shrink-0" />
                  <span className="whitespace-nowrap">{event.bookingCount}/{event.capacity || '∞'}</span>
                </div>
              )
            }))}
          />
        </Card>
      )}

      {/* Upcoming Events */}
      <Card 
        header={
          <div className="flex items-center justify-between">
            <CardTitle>Upcoming Events</CardTitle>
            <LinkButton href="/events" variant="secondary" size="sm">
              View all
            </LinkButton>
          </div>
        }
      >
        {upcomingEvents.length === 0 ? (
          <EmptyState
            title="No upcoming events"
            description="No events are scheduled yet."
            action={
              <LinkButton href="/events/new" variant="primary">
                Create Event
              </LinkButton>
            }
          />
        ) : (
          <>
            <SimpleList
              items={upcomingEvents.slice(0, 10).map((event) => {
                const eventDate = new Date(event.date)
                const isThisWeek = eventDate.getTime() - Date.now() < 7 * 24 * 60 * 60 * 1000
                
                return {
                  id: event.id,
                  title: event.name,
                  subtitle: `${formatDate(eventDate)} at ${event.time}`,
                  href: `/events/${event.id}`,
                  meta: (
                    <div className="flex items-center gap-2">
                      <div className="flex items-center text-sm text-gray-500">
                        <UsersIcon className="h-5 w-5 mr-1 flex-shrink-0" />
                        <span className="whitespace-nowrap">{event.bookingCount}/{event.capacity || '∞'}</span>
                      </div>
                      {isThisWeek && <Badge variant="warning" size="sm">This week</Badge>}
                    </div>
                  )
                }
              })}
            />
            {upcomingEvents.length > 10 && (
              <div className="text-center pt-4">
                <Badge variant="secondary" size="sm">
                  +{upcomingEvents.length - 10} more events
                </Badge>
              </div>
            )}
          </>
        )}
      </Card>

      {/* Quick Actions */}
      <Section title="Quick Actions">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Link href="/events/new">
            <Card interactive className="text-center">
              <CalendarIcon className="h-10 w-10 sm:h-8 sm:w-8 mx-auto text-gray-400 mb-2" />
              <p className="text-sm font-medium text-gray-900">New Event</p>
            </Card>
          </Link>
          <Link href="/customers">
            <Card interactive className="text-center">
              <UsersIcon className="h-10 w-10 sm:h-8 sm:w-8 mx-auto text-gray-400 mb-2" />
              <p className="text-sm font-medium text-gray-900">Customers</p>
            </Card>
          </Link>
          <Link href="/messages">
            <Card interactive className="text-center relative">
              <div className="relative inline-block">
                <ChatBubbleLeftIcon className="h-10 w-10 sm:h-8 sm:w-8 mx-auto text-gray-400 mb-2" />
                {stats.unreadMessages > 0 && (
                  <Badge 
                    variant="error" 
                    size="sm" 
                    dot 
                    className="absolute -top-1 -right-1"
                  />
                )}
              </div>
              <p className="text-sm font-medium text-gray-900">Messages</p>
            </Card>
          </Link>
          <Link href="/private-bookings/new">
            <Card interactive className="text-center">
              <PlusIcon className="h-10 w-10 sm:h-8 sm:w-8 mx-auto text-gray-400 mb-2" />
              <p className="text-sm font-medium text-gray-900">Private Booking</p>
            </Card>
          </Link>
        </div>
      </Section>
    </Page>
  )
}