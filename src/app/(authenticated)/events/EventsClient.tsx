'use client'

import Link from 'next/link'
import { CalendarIcon, PencilSquareIcon } from '@heroicons/react/24/outline'
import { PageHeader } from '@/components/ui-v2/layout/PageHeader'
import { PageWrapper, PageContent } from '@/components/ui-v2/layout/PageWrapper'
import { Card } from '@/components/ui-v2/layout/Card'
import { LinkButton } from '@/components/ui-v2/navigation/LinkButton'
import { NavLink } from '@/components/ui-v2/navigation/NavLink'
import { NavGroup } from '@/components/ui-v2/navigation/NavGroup'
import { DataTable } from '@/components/ui-v2/display/DataTable'
import { Badge } from '@/components/ui-v2/display/Badge'
import { EmptyState } from '@/components/ui-v2/display/EmptyState'
import { ProgressBar } from '@/components/ui-v2/feedback/ProgressBar'
import { Accordion } from '@/components/ui-v2/display/Accordion'
import { formatDate, getTodayIsoDate } from '@/lib/dateUtils'

interface EventCategory {
  id: string
  name: string
  color: string
}

interface Event {
  id: string
  name: string
  date: string
  time: string
  capacity: number | null
  booked_seats: number
  category: EventCategory | null
}

interface EventsClientProps {
  events: Event[]
}

export default function EventsClient({ events }: EventsClientProps) {
  const today = getTodayIsoDate()
  
  const pastEvents = events.filter(e => e.date < today)
  const futureEvents = events.filter(e => e.date >= today)
  
  return (
    <PageWrapper>
      <PageHeader
        title="Events"
        subtitle="Manage your events and track bookings"
        backButton={{
          label: "Back to Dashboard",
          href: "/"
        }}
        actions={
          <NavGroup>
            <NavLink href="/settings/event-categories">
              Manage Categories
            </NavLink>
            <NavLink href="/events/new">
              Create Event
            </NavLink>
          </NavGroup>
        }
      />
      
      <PageContent>
        {/* Upcoming Events */}
        <Card title="Upcoming Events">
        {futureEvents.length === 0 ? (
          <EmptyState icon={<CalendarIcon />}
            title="No upcoming events"
            description="Get started by creating a new event."
            action={
              <LinkButton href="/events/new" variant="primary" size="sm">
                New Event
              </LinkButton>
            }
          />
        ) : (
          <DataTable
            data={futureEvents}
            getRowKey={(event) => event.id}
            columns={[
              {
                key: 'name',
                header: 'Event',
                cell: (event) => (
                  <div>
                    <Link href={`/events/${event.id}`} className="text-sm font-medium text-gray-900 hover:text-blue-600">
                      {event.name}
                    </Link>
                    {event.category && (
                      <div className="mt-1">
                        <Badge
                          size="sm"
                          style={{ 
                            backgroundColor: `${event.category.color}20`,
                            color: event.category.color 
                          }}
                        >
                          {event.category.name}
                        </Badge>
                      </div>
                    )}
                  </div>
                ),
              },
              {
                key: 'date',
                header: 'Date & Time',
                cell: (event) => {
                  const eventDate = new Date(event.date)
                  const isToday = event.date === today
                  return (
                    <div>
                      <div className="flex items-center gap-2">
                        {formatDate(eventDate)}
                        {isToday && <Badge variant="warning" size="sm">Today</Badge>}
                      </div>
                      <div className="text-sm text-gray-500">{event.time}</div>
                    </div>
                  )
                },
              },
              {
                key: 'bookings',
                header: 'Bookings',
                cell: (event) => {
                  const isFull = event.capacity && event.booked_seats >= event.capacity
                  const percentage = event.capacity ? (event.booked_seats / event.capacity) * 100 : 0
                  return (
                    <div>
                      <div className="text-sm text-gray-900">
                        {event.booked_seats} / {event.capacity || '∞'}
                      </div>
                      {event.capacity && (
                        <ProgressBar
                          value={percentage}
                          variant={
                            isFull ? 'error' : 
                            percentage > 80 ? 'warning' : 
                            'success'
                          }
                          size="sm"
                          className="mt-1"
                        />
                      )}
                    </div>
                  )
                },
              },
              {
                key: 'actions',
                header: '',
                cell: (event) => (
                  <div className="flex items-center gap-2">
                    <LinkButton href={`/events/${event.id}`} variant="secondary" size="sm">
                      View
                    </LinkButton>
                    <LinkButton href={`/events/${event.id}/edit`} variant="secondary" size="sm">
                      <PencilSquareIcon className="h-4 w-4 mr-1" />
                      Edit
                    </LinkButton>
                  </div>
                ),
              },
            ]}
            clickableRows
            onRowClick={(event) => window.location.href = `/events/${event.id}`}
          />
        )}
      </Card>

      {/* Past Events */}
      {pastEvents.length > 0 && (
        <Accordion
          items={[
            {
              key: 'past-events',
              title: `Past Events (${pastEvents.length})`,
              content: (
                <DataTable
                  data={pastEvents.slice(-20).reverse()}
                  getRowKey={(event) => event.id}
                  columns={[
                    {
                      key: 'name',
                      header: 'Event',
                      cell: (event) => (
                        <Link href={`/events/${event.id}`} className="text-gray-600 hover:text-gray-900">
                          {event.name}
                        </Link>
                      ),
                    },
                    {
                      key: 'date',
                      header: 'Date',
                      cell: (event) => formatDate(new Date(event.date)),
                    },
                    {
                      key: 'attendance',
                      header: 'Attendance',
                      cell: (event) => event.booked_seats,
                    },
                    {
                      key: 'actions',
                      header: '',
                      cell: (event) => (
                        <div className="flex items-center gap-2">
                          <LinkButton href={`/events/${event.id}`} variant="secondary" size="sm">
                            View
                          </LinkButton>
                          <LinkButton href={`/events/${event.id}/edit`} variant="secondary" size="sm">
                            <PencilSquareIcon className="h-4 w-4 mr-1" />
                            Edit
                          </LinkButton>
                        </div>
                      ),
                    },
                  ]}
                />
              ),
            },
          ]}
          defaultActiveKeys={[]}
        />
      )}
      </PageContent>
    </PageWrapper>
  )
}
