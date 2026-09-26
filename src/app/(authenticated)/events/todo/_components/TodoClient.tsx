'use client'

import { useState, useTransition } from 'react'
import { Card, CardHeader, CardBody, Checkbox, ProgressBar, Badge, Empty, toast } from '@/ds'
import { toggleEventChecklistTask } from '@/app/actions/event-checklist'
import type { ChecklistTodoItem } from '@/lib/event-checklist'
import { formatDateInLondon } from '@/lib/dateUtils'

interface TodoClientProps {
  initialTodos: ChecklistTodoItem[]
}

interface EventGroup {
  eventId: string
  eventName: string
  eventDate: string
  items: ChecklistTodoItem[]
}

function groupByEvent(todos: ChecklistTodoItem[]): EventGroup[] {
  const map = new Map<string, EventGroup>()

  for (const todo of todos) {
    const existing = map.get(todo.eventId)
    if (existing) {
      existing.items.push(todo)
    } else {
      map.set(todo.eventId, {
        eventId: todo.eventId,
        eventName: todo.eventName,
        eventDate: todo.eventDate,
        items: [todo],
      })
    }
  }

  return Array.from(map.values())
}

export default function TodoClient({ initialTodos }: TodoClientProps) {
  const [todos, setTodos] = useState<ChecklistTodoItem[]>(initialTodos)
  const [isPending, startTransition] = useTransition()

  const groups = groupByEvent(todos)

  function setCompleted(eventId: string, taskKey: string, completed: boolean) {
    setTodos((prev) =>
      prev.map((t) => (t.eventId === eventId && t.key === taskKey ? { ...t, completed } : t))
    )
  }

  // The box ticks straight away. A refusal or a network failure puts it back and says so,
  // rather than leaving a tick that was never saved.
  function handleToggle(eventId: string, taskKey: string, currentCompleted: boolean) {
    const nextCompleted = !currentCompleted
    setCompleted(eventId, taskKey, nextCompleted)
    startTransition(async () => {
      try {
        const result = await toggleEventChecklistTask(eventId, taskKey, nextCompleted)
        if (!result.success) {
          setCompleted(eventId, taskKey, currentCompleted)
          toast.error(result.error ?? 'Could not update todo')
        }
      } catch {
        setCompleted(eventId, taskKey, currentCompleted)
        toast.error('Could not update todo')
      }
    })
  }

  if (groups.length === 0) {
    return (
      <Card>
        <Empty
          size="sm"
          title="No outstanding todos"
          description="Every event checklist is up to date."
        />
      </Card>
    )
  }

  // Each event is its own card, passed straight to PageLayout, which spaces them.
  return (
    <>
      {groups.map((group) => {
        const completed = group.items.filter((i) => i.completed).length
        const total = group.items.length
        const pct = total > 0 ? Math.round((completed / total) * 100) : 0

        return (
          <Card key={group.eventId} className={isPending ? 'opacity-50' : undefined}>
            <CardHeader
              title={group.eventName}
              action={
                <div className="flex items-center gap-2">
                  <Badge tone="neutral">
                    {formatDateInLondon(group.eventDate, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
                  </Badge>
                  <span className="text-xs text-text-muted">
                    {completed}/{total} complete
                  </span>
                </div>
              }
            />
            <CardBody className="space-y-4">
              <ProgressBar value={pct} label={`${group.eventName} todos complete`} />
              <div className="flex flex-col gap-2">
                {group.items.map((item) => (
                  <Checkbox
                    key={item.key}
                    label={item.label}
                    description={item.status === 'overdue' ? 'Overdue' : undefined}
                    checked={item.completed}
                    onChange={() => handleToggle(group.eventId, item.key, item.completed)}
                  />
                ))}
              </div>
            </CardBody>
          </Card>
        )
      })}
    </>
  )
}
