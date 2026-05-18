'use client'

import { useState, useTransition } from 'react'
import { Card, CardHeader, CardBody, Checkbox, ProgressBar, Badge } from '@/ds'
import { toggleEventChecklistTask } from '@/app/actions/event-checklist'
import type { ChecklistTodoItem } from '@/lib/event-checklist'

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

  function handleToggle(eventId: string, taskKey: string, currentCompleted: boolean) {
    startTransition(async () => {
      const result = await toggleEventChecklistTask(eventId, taskKey, !currentCompleted)
      if (result.success) {
        setTodos((prev) =>
          prev.map((t) =>
            t.eventId === eventId && t.key === taskKey
              ? { ...t, completed: !currentCompleted }
              : t
          )
        )
      }
    })
  }

  if (groups.length === 0) {
    return (
      <div className="text-center py-12 text-text-muted">
        No outstanding todos across events
      </div>
    )
  }

  return (
    <div className={`flex flex-col gap-4 ${isPending ? 'opacity-60' : ''}`}>
      {groups.map((group) => {
        const completed = group.items.filter((i) => i.completed).length
        const total = group.items.length
        const pct = total > 0 ? Math.round((completed / total) * 100) : 0

        return (
          <Card key={group.eventId}>
            <CardHeader
              title={group.eventName}
              action={
                <div className="flex items-center gap-2">
                  <Badge tone="neutral">{group.eventDate}</Badge>
                  <span className="text-xs text-text-muted">
                    {completed}/{total} complete
                  </span>
                </div>
              }
            />
            <CardBody>
              <ProgressBar value={pct} className="mb-3" />
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
    </div>
  )
}
