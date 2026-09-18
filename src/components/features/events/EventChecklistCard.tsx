'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Card } from '@/ds'
import { Badge } from '@/ds'
import { ProgressBar } from '@/ds'
import { Checkbox } from '@/ds'
import { Button } from '@/ds'
import { EmptyState } from '@/ds'
import { toast } from '@/ds'
import { getTodayIsoDate, formatDate } from '@/lib/dateUtils'
import type { EventChecklistItem } from '@/lib/event-checklist'
import { getEventChecklist, toggleEventChecklistTask } from '@/app/actions/event-checklist'

interface EventChecklistCardProps {
  eventId: string
  eventName: string
  className?: string
}

export function EventChecklistCard({ eventId, eventName, className }: EventChecklistCardProps) {
  const [items, setItems] = useState<EventChecklistItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const pendingTasks = useRef(new Set<string>())
  const [pendingTaskKeys, setPendingTaskKeys] = useState<Set<string>>(new Set())
  const todayIso = getTodayIsoDate()

  const loadChecklist = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await getEventChecklist(eventId)
      if (!result.success || !result.items) {
        setError(result.error || 'Unable to load checklist')
        setItems([])
      } else {
        setItems(result.items)
      }
    } catch (err) {
      console.error('Failed to load event checklist', err)
      setError('Unable to load checklist')
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [eventId])

  useEffect(() => {
    loadChecklist()
  }, [loadChecklist])

  const handleToggle = useCallback(async (item: EventChecklistItem) => {
    const pendingKey = `${eventId}:${item.key}`
    if (pendingTasks.current.has(pendingKey)) return
    pendingTasks.current.add(pendingKey)
    setPendingTaskKeys(new Set(pendingTasks.current))

    const nextState = !item.completed
    const today = getTodayIsoDate()
    const updated: EventChecklistItem = {
      ...item,
      completed: nextState,
      completedAt: nextState ? new Date().toISOString() : null,
      status: nextState ? 'completed' : item.dueDate < today ? 'overdue' : item.dueDate === today ? 'due_today' : 'upcoming',
    }
    const replaceItem = (replacement: EventChecklistItem) => {
      setItems(current => current.map(existing =>
        existing.eventId === eventId && existing.key === item.key ? replacement : existing
      ))
    }
    replaceItem(updated)

    try {
      const result = await toggleEventChecklistTask(eventId, item.key, nextState)
      if (!result.success) {
        // Restore only this task so other saves in progress keep their state.
        replaceItem(item)
        toast.error(result.error || 'Failed to update task')
      } else {
        toast.success(nextState ? 'Task marked complete' : 'Task reopened')
      }
    } catch {
      replaceItem(item)
      toast.error('Failed to update task')
    } finally {
      pendingTasks.current.delete(pendingKey)
      setPendingTaskKeys(new Set(pendingTasks.current))
    }
  }, [eventId])

  const { completedCount, overdueCount, dueTodayCount, nextTask } = useMemo(() => {
    if (!items || items.length === 0) {
      return { completedCount: 0, overdueCount: 0, dueTodayCount: 0, nextTask: null as EventChecklistItem | null }
    }

    const outstanding = items
      .filter(item => !item.completed)
      .sort((a, b) => {
        if (a.dueDate === b.dueDate) {
          return a.order - b.order
        }
        return a.dueDate.localeCompare(b.dueDate)
      })

    return {
      completedCount: items.filter(item => item.completed).length,
      overdueCount: outstanding.filter(item => item.status === 'overdue').length,
      dueTodayCount: outstanding.filter(item => item.status === 'due_today').length,
      nextTask: outstanding[0] || null
    }
  }, [items])

  const outstandingItems = useMemo(() => {
    return items
      .filter(item => !item.completed)
      .sort((a, b) => {
        if (a.status !== b.status) {
          if (a.status === 'overdue') return -1
          if (b.status === 'overdue') return 1
          if (a.status === 'due_today') return -1
          if (b.status === 'due_today') return 1
        }
        if (a.dueDate === b.dueDate) {
          return a.order - b.order
        }
        return a.dueDate.localeCompare(b.dueDate)
      })
  }, [items])

  const completedItems = useMemo(() => {
    return items
      .filter(item => item.completed)
      .sort((a, b) => {
        const aDate = a.completedAt ? new Date(a.completedAt).getTime() : 0
        const bDate = b.completedAt ? new Date(b.completedAt).getTime() : 0
        return bDate - aDate
      })
  }, [items])

  const totalTasks = items.length
  const percentComplete = totalTasks > 0 ? Math.round((completedCount / totalTasks) * 100) : 0

  const getDueDescription = (item: EventChecklistItem) => {
    const dueDate = new Date(`${item.dueDate}T00:00:00`)
    const todayDate = new Date(`${todayIso}T00:00:00`)
    const diffMs = dueDate.getTime() - todayDate.getTime()
    const diffDays = Math.round(diffMs / 86400000)

    if (item.status === 'overdue') {
      const rawDays = Math.abs(diffDays)
      const daysOverdue = rawDays === 0 ? 1 : rawDays
      return `${daysOverdue} day${daysOverdue === 1 ? '' : 's'} overdue (${item.dueDateFormatted})`
    }

    if (item.status === 'due_today') {
      return 'Due today'
    }

    if (diffDays === 0) {
      return 'Due today'
    }

    return `Due in ${diffDays} day${diffDays === 1 ? '' : 's'} (${item.dueDateFormatted})`
  }

  return (
    <Card padding="lg" className={className}>
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-text">Event Checklist</h2>
        <p className="mt-1 text-sm text-text-muted">Track prep tasks for {eventName}</p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-text-subtle" />
        </div>
      ) : error ? (
        <div className="rounded-md border border-danger-border bg-danger-soft p-4 text-sm text-danger-fg">
          {error}
        </div>
      ) : (
        <div className="space-y-6">
          <div>
            <h3 className="text-sm font-semibold text-text uppercase tracking-wide">Outstanding Tasks</h3>
            <div className="mt-3 space-y-3">
              {outstandingItems.length === 0 ? (
                <EmptyState
                  size="sm"
                  variant="minimal"
                  centered={false}
                  title="All caught up"
                  description="Every checklist item is complete for this event."
                />
              ) : (
                outstandingItems.map((item) => {
                  const isPending = pendingTaskKeys.has(`${eventId}:${item.key}`)
                  // Small text, so the dark -fg shades: base warning amber is too pale to read.
                  const dueColor = item.status === 'overdue'
                    ? 'text-danger-fg'
                    : item.status === 'due_today'
                      ? 'text-warning-fg'
                      : 'text-text-muted'
                  return (
                    <div
                      key={item.key}
                      className="flex items-start justify-between rounded-lg border border-border px-4 py-3"
                    >
                      <div className="flex flex-1 gap-3">
                        <Checkbox
                          checked={item.completed}
                          onChange={() => handleToggle(item)}
                          disabled={isPending}
                          aria-label={`Mark ${item.label} as ${item.completed ? 'incomplete' : 'complete'}`}
                          className="mt-1"
                        />
                        <div className="flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-text">{item.label}</span>
                            {!item.required && <Badge tone="neutral" size="sm">Optional</Badge>}
                            <Badge tone="neutral" size="sm">{item.channel}</Badge>
                          </div>
                          <p className={`mt-1 text-xs ${dueColor}`}>
                            {getDueDescription(item)}
                          </p>
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-text uppercase tracking-wide">Completed Tasks</h3>
            <div className="mt-3 space-y-2">
              {completedItems.length === 0 ? (
                <p className="text-sm text-text-muted">No tasks completed yet.</p>
              ) : (
                completedItems.map((item) => (
                  <div
                    key={item.key}
                    className="flex items-center justify-between rounded-lg bg-surface-2 px-4 py-2 text-sm"
                  >
                    <div className="flex flex-wrap items-center gap-2 text-text-muted">
                      <span>{item.label}</span>
                      {!item.required && <Badge tone="neutral" size="sm">Optional</Badge>}
                      <Badge tone="neutral" size="sm">{item.channel}</Badge>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-xs text-text-muted">
                        {item.completedAt ? `Completed ${formatDate(item.completedAt)}` : 'Completed'}
                      </div>
                      <Button
                        size="xs"
                        variant="secondary"
                        onClick={() => handleToggle(item)}
                        disabled={pendingTaskKeys.has(`${eventId}:${item.key}`)}
                      >
                        Reopen
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </Card>
  )
}
