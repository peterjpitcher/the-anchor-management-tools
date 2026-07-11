'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Card, CardHeader, CardBody, Checkbox, Badge, toast } from '@/ds'
import { cn } from '@/lib/utils'
import { toggleEventChecklistTask } from '@/app/actions/event-checklist'
import type { ChecklistTodoItem } from '@/lib/event-checklist'
import { formatRelativeDue, summariseTodos, formatSummaryLine } from './eventTodosWidget.helpers'

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
        />
        <CardBody className="max-h-96 xl:max-h-[calc(100vh-7rem)] overflow-y-auto">
          {loadError ? (
            <p className="py-6 text-center text-sm text-text-muted">
              Outstanding todos could not be loaded.
            </p>
          ) : todos.length === 0 ? (
            <p className="py-6 text-center text-sm text-text-muted">
              You&apos;re all caught up — no outstanding todos.
            </p>
          ) : (
            <ul className={cn('flex flex-col gap-1', isPending && 'opacity-60')}>
              {todos.map((item) => (
                <li
                  key={`${item.eventId}:${item.key}`}
                  className={cn(
                    'flex items-start gap-2 border-l-4 pl-3 py-2',
                    item.status === 'overdue' ? 'border-danger' : 'border-warning',
                  )}
                >
                  {canManage && (
                    <label className="-m-3.5 inline-flex shrink-0 cursor-pointer p-3.5">
                      <Checkbox
                        aria-label={`Mark "${item.label}" complete`}
                        checked={false}
                        onChange={() => handleComplete(item)}
                      />
                    </label>
                  )}
                  <Link href={`/events/${item.eventId}`} className="group block min-w-0 flex-1">
                    <span className="block truncate text-sm text-text group-hover:underline">
                      {item.label}
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-2">
                      <span className="max-w-[10rem] truncate text-xs text-text-muted">
                        {item.eventName}
                      </span>
                      <Badge tone={item.status === 'overdue' ? 'danger' : 'warning'}>
                        {formatRelativeDue(item.dueDate, todayIso)}
                      </Badge>
                      <span className="text-xs text-text-subtle">{item.channel}</span>
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
