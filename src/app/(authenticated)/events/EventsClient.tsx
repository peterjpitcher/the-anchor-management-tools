'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { PlusIcon, CalendarIcon, Cog6ToothIcon, PencilSquareIcon } from '@heroicons/react/24/outline'
import { Page } from '@/components/ui-v2/layout/Page'
import { Card } from '@/components/ui-v2/layout/Card'
import { Button } from '@/components/ui-v2/forms/Button'
import { LinkButton } from '@/components/ui-v2/navigation/LinkButton'
import { DataTable } from '@/components/ui-v2/display/DataTable'
import { Badge } from '@/components/ui-v2/display/Badge'
import { EmptyState } from '@/components/ui-v2/display/EmptyState'
import { ProgressBar } from '@/components/ui-v2/feedback/ProgressBar'
import { Accordion } from '@/components/ui-v2/display/Accordion'
import { formatDate } from '@/lib/dateUtils'

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
  const today = new Date().toISOString().split('T')[0]
  
  const pastEvents = events.filter(e => e.date < today)
  const futureEvents = events.filter(e => e.date >= today)
  
  return (
    <Page
      title="Events"
      description="Manage your events and track bookings"
      actions={
        <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
          <LinkButton
            href="/settings/event-categories"
            variant="secondary"
          >
            <Cog6ToothIcon className="-ml-1 mr-2 h-5 w-5" />
            Manage Categories
          </LinkButton>
          <LinkButton
            href="/events/new"
            variant="primary"
          >
            <PlusIcon className="-ml-1 mr-2 h-5 w-5" />
            Create Event
          </LinkButton>
        </div>
      }
    >

      {/* Upcoming Events */}
      <Card title="Upcoming Events">
        {futureEvents.length === 0 ? (
          <EmptyState icon={<CalendarIcon />}
            title="No upcoming events"
            description="Get started by creating a new event."
            action={
              <LinkButton href="/events/new" variant="primary" size="sm">
                <PlusIcon className="-ml-1 mr-2 h-5 w-5" />
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
    </Page>
  )
}