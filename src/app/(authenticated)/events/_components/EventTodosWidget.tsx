'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Alert, Card, CardHeader, CardBody, Checkbox, Badge, Empty, LinkButton, toast } from '@/ds'
import { cn } from '@/lib/utils'
import { toggleEventChecklistTask } from '@/app/actions/event-checklist'
import type { ChecklistTodoItem } from '@/lib/event-checklist'
import { formatRelativeDue, summariseTodos, formatSummaryLine } from './eventTodosWidget.helpers'
import { eventTodoUrgencyBorderClass, eventTodoUrgencyTone } from '../_shared/status-ui'

interface EventTodosWidgetProps {
  initialTodos: ChecklistTodoItem[]
  canManage: boolean
  todayIso: string
  loadError?: string | null
}

export default function EventTodosWidget({
  initialTodos,
  canManage,
  todayIso,
  loadError = null,
}: EventTodosWidgetProps) {
  const [todos, setTodos] = useState<ChecklistTodoItem[]>(initialTodos)
  const [isPending, startTransition] = useTransition()

  function handleComplete(item: ChecklistTodoItem) {
    setTodos((prev) => prev.filter((t) => !(t.eventId === item.eventId && t.key === item.key)))
    // Restore only this item (functional + re-sorted) so an overlapping completion isn't resurrected.
    const restore = () =>
      setTodos((prev) =>
        prev.some((t) => t.eventId === item.eventId && t.key === item.key)
          ? prev
          : [...prev, item].sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.order - b.order),
      )
    startTransition(async () => {
      try {
        const result = await toggleEventChecklistTask(item.eventId, item.key, true)
        if (!result.success) {
          restore()
          toast.error(result.error ?? 'Could not update todo')
        }
      } catch {
        restore()
        toast.error('Could not update todo')
      }
    })
  }

  const summary = formatSummaryLine(summariseTodos(todos))

  return (
    <div className="xl:sticky xl:top-6">
      <Card>
        <CardHeader
          title="Outstanding Todos"
          subtitle={!loadError && todos.length > 0 ? summary : undefined}
          action={
            <LinkButton href="/events/todo" variant="ghost" size="sm">
              View All
            </LinkButton>
          }
        />
        <CardBody className="max-h-96 xl:max-h-[calc(100vh-7rem)] overflow-y-auto">
          {loadError ? (
            <Alert tone="danger" size="sm">
              Outstanding todos could not be loaded.
            </Alert>
          ) : todos.length === 0 ? (
            <Empty size="sm" title="All Caught Up" description="No outstanding todos." />
          ) : (
            <ul className={cn('flex flex-col gap-1', isPending && 'opacity-50')}>
              {todos.map((item) => (
                <li
                  key={`${item.eventId}:${item.key}`}
                  className={cn(
                    'flex items-start gap-2 border-l-4 pl-3 py-2',
                    eventTodoUrgencyBorderClass(item.status),
                  )}
                >
                  {canManage && (
                    // Not a field label: the DS Checkbox box is 16px, and this wrapper widens the
                    // area that ticks it to the 44px touch target without adding visible text. The
                    // DS Checkbox grows its own touch row only when it has a visible label, and the
                    // todo's name beside it is a link to the event, not the checkbox's label.
                    <label className="-m-3.5 inline-flex shrink-0 cursor-pointer p-3.5">
                      <Checkbox
                        aria-label={`Mark "${item.label}" complete`}
                        checked={false}
                        onChange={() => handleComplete(item)}
                      />
                    </label>
                  )}
                  <Link href={`/events/${item.eventId}`} className="group block min-w-0 flex-1 rounded-sm focus-visible:outline-hidden focus-visible:shadow-ring-inset">
                    <span className="block truncate text-sm text-text group-hover:underline">
                      {item.label}
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-2">
                      <span className="max-w-[10rem] truncate text-xs text-text-muted">
                        {item.eventName}
                      </span>
                      <Badge tone={eventTodoUrgencyTone(item.status)}>
                        {formatRelativeDue(item.dueDate, todayIso)}
                      </Badge>
                      <span className="text-xs text-text-soft">{item.channel}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
