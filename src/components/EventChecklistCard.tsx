'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Card } from '@/components/ui-v2/layout/Card'
import { Badge } from '@/components/ui-v2/display/Badge'
import { ProgressBar } from '@/components/ui-v2/feedback/ProgressBar'
import { Checkbox } from '@/components/ui-v2/forms/Checkbox'
import { Button } from '@/components/ui-v2/forms/Button'
import { EmptyState } from '@/components/ui-v2/display/EmptyState'
import { toast } from '@/components/ui-v2/feedback/Toast'
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
  const [pendingTaskKey, setPendingTaskKey] = useState<string | null>(null)
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
    const nextState = !item.completed
    setPendingTaskKey(item.key)

    let previousItems: EventChecklistItem[] | null = null
    if (nextState) {
      previousItems = items
      const optimisticItems = items.map((existing) => {
        if (existing.key !== item.key) return existing
        const updated: EventChecklistItem = {
          ...existing,
          completed: true,
          completedAt: new Date().toISOString(),
          status: 'completed',
        }
        return updated
      })
      setItems(optimisticItems)
    }

    const result = await toggleEventChecklistTask(eventId, item.key, nextState)
    if (!result.success) {
      toast.error(result.error || 'Failed to update task')
      if (previousItems) {
        setItems(previousItems)
      }
    } else {
      toast.success(nextState ? 'Task marked complete' : 'Task reopened')
      await loadChecklist()
    }

    setPendingTaskKey(null)
  }, [eventId, items, loadChecklist])

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
        <h2 className="text-lg font-semibold text-gray-900">Event Checklist</h2>
        <p className="mt-1 text-sm text-gray-500">Track prep tasks for {eventName}</p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      ) : error ? (
        <div className="rounded-md bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-lg border border-gray-200 p-4">
              <p className="text-sm text-gray-500">Progress</p>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-lg font-semibold text-gray-900">{completedCount}/{totalTasks}</span>
                <Badge variant={completedCount === totalTasks ? 'success' : 'info'} size="sm">
                  {percentComplete}%
                </Badge>
              </div>
              <ProgressBar value={percentComplete} size="sm" className="mt-3" />
            </div>
            <div className="rounded-lg border border-gray-200 p-4">
              <p className="text-sm text-gray-500">Overdue</p>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-lg font-semibold text-gray-900">{overdueCount}</span>
                <Badge variant={overdueCount > 0 ? 'error' : 'success'} size="sm">
                  {overdueCount > 0 ? 'Action needed' : 'Clear'}
                </Badge>
              </div>
              <p className="mt-3 text-xs text-gray-500">Tasks past due date</p>
            </div>
            <div className="rounded-lg border border-gray-200 p-4">
              <p className="text-sm text-gray-500">Next task</p>
              <div className="mt-2 text-sm text-gray-900">
                {nextTask ? (
                  <div>
                    <p className="font-medium text-gray-900">{nextTask.label}</p>
                    <p className="text-xs text-gray-500 mt-1">
                      {nextTask.status === 'overdue'
                        ? `Overdue since ${nextTask.dueDateFormatted}`
                        : nextTask.status === 'due_today'
                          ? 'Due today'
                          : `Due on ${nextTask.dueDateFormatted}`
                      }
                    </p>
                  </div>
                ) : (
                  <span className="text-sm text-gray-500">All tasks complete</span>
                )}
              </div>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">Outstanding Tasks</h3>
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
                  const isPending = pendingTaskKey === item.key
                  const dueColor = item.status === 'overdue'
                    ? 'text-red-600'
                    : item.status === 'due_today'
                      ? 'text-yellow-600'
                      : 'text-gray-500'
                  return (
                    <div
                      key={item.key}
                      className="flex items-start justify-between rounded-lg border border-gray-200 px-4 py-3"
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
                            <span className="font-medium text-gray-900">{item.label}</span>
                            {!item.required && <Badge variant="secondary" size="sm">Optional</Badge>}
                            <Badge variant="secondary" size="sm">{item.channel}</Badge>
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
            <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">Completed Tasks</h3>
            <div className="mt-3 space-y-2">
              {completedItems.length === 0 ? (
                <p className="text-sm text-gray-500">No tasks completed yet.</p>
              ) : (
                completedItems.map((item) => (
                  <div
                    key={item.key}
                    className="flex items-center justify-between rounded-lg bg-gray-50 px-4 py-2 text-sm"
                  >
                    <div className="flex flex-wrap items-center gap-2 text-gray-600">
                      <span>{item.label}</span>
                      {!item.required && <Badge variant="secondary" size="sm">Optional</Badge>}
                      <Badge variant="secondary" size="sm">{item.channel}</Badge>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-xs text-gray-500">
                        {item.completedAt ? `Completed ${formatDate(item.completedAt)}` : 'Completed'}
                      </div>
                      <Button
                        size="xs"
                        variant="secondary"
                        onClick={() => handleToggle(item)}
                        disabled={pendingTaskKey === item.key}
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
