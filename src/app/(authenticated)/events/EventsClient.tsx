'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { CalendarIcon, ClipboardDocumentCheckIcon, PencilSquareIcon } from '@heroicons/react/24/outline'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { Card } from '@/components/ui-v2/layout/Card'
import { LinkButton } from '@/components/ui-v2/navigation/LinkButton'
import { DataTable } from '@/components/ui-v2/display/DataTable'
import { Badge } from '@/components/ui-v2/display/Badge'
import { EmptyState } from '@/components/ui-v2/display/EmptyState'
import { ProgressBar } from '@/components/ui-v2/feedback/ProgressBar'
import { Accordion } from '@/components/ui-v2/display/Accordion'
import { Checkbox } from '@/components/ui-v2/forms/Checkbox'
import { toast } from '@/components/ui-v2/feedback/Toast'
import { Alert } from '@/components/ui-v2/feedback/Alert'
import { formatDate, getTodayIsoDate } from '@/lib/dateUtils'
import type { ChecklistTodoItem, EventChecklistItem } from '@/lib/event-checklist'
import { usePermissions } from '@/contexts/PermissionContext'
import { toggleEventChecklistTask } from '@/app/actions/event-checklist'
import type { HeaderNavItem } from '@/components/ui-v2/navigation/HeaderNav'

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
  checklist?: {
    completed: number
    total: number
    overdueCount: number
    dueTodayCount: number
    nextTask: EventChecklistItem | null
    outstanding: EventChecklistItem[]
  }
}

interface EventsClientProps {
  events: Event[]
  todos: ChecklistTodoItem[]
  initialError?: string | null
}

export default function EventsClient({ events, todos, initialError }: EventsClientProps) {
  const { hasPermission } = usePermissions()
  const canManageEvents = hasPermission('events', 'manage')
  const today = getTodayIsoDate()

  const [todoItems, setTodoItems] = useState<ChecklistTodoItem[]>(() =>
    todos.filter((item) => item.dueDate <= today)
  )
  const [pendingKeys, setPendingKeys] = useState<Set<string>>(new Set())
  const pageError = initialError ?? null

  useEffect(() => {
    setTodoItems(todos.filter((item) => item.dueDate <= today))
  }, [todos, today])

  const handleCompleteTodo = async (todo: ChecklistTodoItem) => {
    const key = `${todo.eventId}-${todo.key}`
    setPendingKeys(previous => {
      const next = new Set(previous)
      next.add(key)
      return next
    })

    const result = await toggleEventChecklistTask(todo.eventId, todo.key, true)

    if (!result.success) {
      toast.error(result.error || 'Failed to mark task complete')
    } else {
      toast.success('Task marked complete')
      setTodoItems(previous => previous.filter(item => !(item.eventId === todo.eventId && item.key === todo.key)))
    }

    setPendingKeys(previous => {
      const next = new Set(previous)
      next.delete(key)
      return next
    })
  }
  
  const pastEvents = events.filter(e => e.date < today)
  const futureEvents = events.filter(e => e.date >= today)

  const navItems = ([
    { label: 'Overview', href: '/events' },
    { label: 'Checklist Todo', href: '/events/todo' },
    canManageEvents ? { label: 'Manage Categories', href: '/settings/event-categories' } : null,
    canManageEvents ? { label: 'Create Event', href: '/events/new' } : null,
  ] as Array<HeaderNavItem | null>).filter((item): item is HeaderNavItem => Boolean(item))
  
  return (
    <PageLayout
      title="Events"
      subtitle="Manage your events and track bookings"
      backButton={{
        label: 'Back to Dashboard',
        href: '/',
      }}
      navItems={navItems}
    >
      <div className="space-y-6">
        {pageError && (
          <Alert
            variant="error"
            title="We couldn't load everything"
            description={pageError}
          />
        )}

        <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-6">
          <Card
            variant="bordered"
            header={
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-gray-900">Upcoming Events</h2>
                <Badge variant="secondary" size="sm">{futureEvents.length}</Badge>
              </div>
            }
          >
              {futureEvents.length === 0 ? (
                <EmptyState
                  icon={<CalendarIcon />}
                  title="No upcoming events"
                  description="Get started by creating a new event."
                  action={canManageEvents ? (
                    <LinkButton href="/events/new" variant="primary" size="sm">
                      New Event
                    </LinkButton>
                  ) : undefined}
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
                      key: 'checklist',
                      header: 'Checklist',
                      cell: (event) => {
                        const summary = event.checklist
                        if (!summary) {
                          return <span className="text-sm text-gray-500">No data</span>
                        }

                        const percent = summary.total > 0 ? Math.round((summary.completed / summary.total) * 100) : 0
                        const hasAllComplete = summary.completed === summary.total
                        const statusBadgeVariant = summary.overdueCount > 0
                          ? 'error'
                          : summary.dueTodayCount > 0
                            ? 'warning'
                            : hasAllComplete
                              ? 'success'
                              : 'info'
                        const statusBadgeLabel = summary.overdueCount > 0
                          ? `${summary.overdueCount} overdue`
                          : summary.dueTodayCount > 0
                            ? `${summary.dueTodayCount} due today`
                            : hasAllComplete
                              ? 'Complete'
                              : 'On track'

                        return (
                          <div className="space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-sm font-medium text-gray-900">{summary.completed}/{summary.total}</span>
                              <Badge variant={statusBadgeVariant} size="sm">
                                {statusBadgeLabel}
                              </Badge>
                            </div>
                            <ProgressBar value={percent} size="sm" />
                            {summary.nextTask && !hasAllComplete && (
                              <div className="text-xs text-gray-500">
                                Next: <span className="font-medium text-gray-700">{summary.nextTask.label}</span>
                                <span className="ml-1">
                                  • due {
                                    summary.nextTask.status === 'overdue'
                                      ? `since ${summary.nextTask.dueDateFormatted}`
                                      : summary.nextTask.status === 'due_today'
                                        ? 'today'
                                        : `on ${summary.nextTask.dueDateFormatted}`
                                  }
                                </span>
                              </div>
                            )}
                          </div>
                        )
                      }
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
                          {canManageEvents && (
                            <LinkButton href={`/events/${event.id}/edit`} variant="secondary" size="sm">
                              <PencilSquareIcon className="h-4 w-4 mr-1" />
                              Edit
                            </LinkButton>
                          )}
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
                                {canManageEvents && (
                                  <LinkButton href={`/events/${event.id}/edit`} variant="secondary" size="sm">
                                    <PencilSquareIcon className="h-4 w-4 mr-1" />
                                    Edit
                                  </LinkButton>
                                )}
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
          </div>

          <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
            <Card
              variant="bordered"
              header={
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-semibold text-gray-900">Checklist Todos</h2>
                  <Badge variant="secondary" size="sm">{todoItems.length}</Badge>
                </div>
              }
              className="lg:max-h-[calc(100vh-200px)]"
            >
              {todoItems.length === 0 ? (
                <EmptyState
                  icon={<ClipboardDocumentCheckIcon />}
                  title="All caught up"
                  description="No outstanding checklist items."
                />
              ) : (
                <div className="flex flex-col gap-3 lg:overflow-y-auto lg:pr-1 lg:max-h-[calc(100vh-260px)]">
                  {todoItems.map((todo) => {
                    const statusMeta = (() => {
                      if (todo.status === 'overdue') {
                        return { variant: 'error' as const, label: 'Overdue' }
                      }
                      if (todo.status === 'due_today') {
                        return { variant: 'warning' as const, label: 'Due today' }
                      }
                      return { variant: 'info' as const, label: 'Upcoming' }
                    })()

                    const dueDescription = (() => {
                      if (todo.status === 'overdue') {
                        return `Due since ${todo.dueDateFormatted}`
                      }
                      if (todo.status === 'due_today') {
                        return 'Due today'
                      }
                      return `Due ${todo.dueDateFormatted}`
                    })()

                    const eventDateText = todo.eventDate
                      ? `Event ${formatDate(new Date(todo.eventDate))}`
                      : null
                    const pending = pendingKeys.has(`${todo.eventId}-${todo.key}`)

                    return (
                      <div
                        key={`${todo.eventId}-${todo.key}`}
                        className={`rounded-lg border border-gray-200 p-3 transition-colors hover:border-blue-300 ${pending ? 'opacity-70' : ''}`}
                      >
                        <div className="flex items-start gap-3">
                          <Checkbox
                            checked={pending}
                            onChange={() => {
                              if (!canManageEvents || pending) return
                              handleCompleteTodo(todo)
                            }}
                            disabled={pending || !canManageEvents}
                            size="sm"
                            aria-label={`Mark ${todo.label} for ${todo.eventName} as complete`}
                          />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-gray-900">{todo.label}</p>
                            <div className="mt-1 text-xs text-gray-500">
                              <Link href={`/events/${todo.eventId}`} className="font-medium text-gray-700 hover:text-blue-600">
                                {todo.eventName}
                              </Link>
                              {eventDateText && <span className="ml-1">• {eventDateText}</span>}
                            </div>
                            <div className="mt-1 text-xs text-gray-500">
                              {dueDescription}
                              <span className="ml-1 text-gray-400">• {todo.channel}</span>
                            </div>
                          </div>
                          <Badge variant={statusMeta.variant} size="sm" className="flex-shrink-0">
                            {statusMeta.label}
                          </Badge>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </Card>
          </aside>
        </div>
      </div>
    </PageLayout>
  )
}
