'use client'

import { useCallback, useMemo, useState } from 'react'
import Link from 'next/link'
import { CheckCircleIcon } from '@heroicons/react/24/outline'
import { PageWrapper, PageContent } from '@/components/ui-v2/layout/PageWrapper'
import { PageHeader } from '@/components/ui-v2/layout/PageHeader'
import { Card } from '@/components/ui-v2/layout/Card'
import { Badge } from '@/components/ui-v2/display/Badge'
import { DataTable, type Column } from '@/components/ui-v2/display/DataTable'
import { Button } from '@/components/ui-v2/forms/Button'
import { toast } from '@/components/ui-v2/feedback/Toast'
import { EmptyState } from '@/components/ui-v2/display/EmptyState'
import { formatDate } from '@/lib/dateUtils'
import type { ChecklistTodoItem } from '@/lib/event-checklist'
import { getChecklistTodos, toggleEventChecklistTask } from '@/app/actions/event-checklist'

interface TodoClientProps {
  initialItems: ChecklistTodoItem[]
  initialError?: string
}

export default function TodoClient({ initialItems, initialError }: TodoClientProps) {
  const [items, setItems] = useState<ChecklistTodoItem[]>(initialItems)
  const [error, setError] = useState<string | undefined>(initialError)
  const [updatingKey, setUpdatingKey] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const stats = useMemo(() => {
    const overdue = items.filter(item => item.status === 'overdue').length
    const dueToday = items.filter(item => item.status === 'due_today').length
    return { overdue, dueToday }
  }, [items])

  const sortedItems = useMemo(() => {
    return [...items].sort((a, b) => {
      if (a.dueDate === b.dueDate) {
        return a.order - b.order
      }
      return a.dueDate.localeCompare(b.dueDate)
    })
  }, [items])

  const handleRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      const result = await getChecklistTodos()
      if (!result.success || !result.items) {
        setError(result.error || 'Unable to refresh tasks')
        setItems([])
      } else {
        setError(undefined)
        setItems(result.items)
        toast.success('Checklist updated')
      }
    } catch (err) {
      console.error('Failed to refresh checklist todos', err)
      setError('Unable to refresh tasks')
    } finally {
      setRefreshing(false)
    }
  }, [])

  const handleComplete = useCallback(async (item: ChecklistTodoItem) => {
    const key = `${item.eventId}:${item.key}`
    setUpdatingKey(key)
    setItems(prev => prev.filter(existing => !(existing.eventId === item.eventId && existing.key === item.key)))

    const result = await toggleEventChecklistTask(item.eventId, item.key, true)
    if (!result.success) {
      toast.error(result.error || 'Failed to complete task')
      setItems(prev => [...prev, item])
    } else {
      toast.success('Task marked complete')
    }

    setUpdatingKey(null)
  }, [])

  const columns: Column<ChecklistTodoItem>[] = [
    {
      key: 'task',
      header: 'Task',
      cell: (item: ChecklistTodoItem) => (
        <div>
          <div className="font-medium text-gray-900 flex items-center gap-2">
            {item.label}
            {!item.required && <Badge variant="secondary" size="sm">Optional</Badge>}
          </div>
          <div className="mt-1 text-sm text-gray-500 flex flex-wrap items-center gap-2">
            <Link href={`/events/${item.eventId}`} className="text-blue-600 hover:text-blue-800">
              {item.eventName}
            </Link>
            <span>• Event {formatDate(item.eventDate)}</span>
            <Badge variant="secondary" size="sm">{item.channel}</Badge>
          </div>
        </div>
      )
    },
    {
      key: 'due_date',
      header: 'Due',
      cell: (item: ChecklistTodoItem) => {
        const statusBadge = item.status === 'overdue'
          ? { variant: 'error' as const, label: 'Overdue' }
          : item.status === 'due_today'
            ? { variant: 'warning' as const, label: 'Due today' }
            : { variant: 'info' as const, label: 'Upcoming' }

        return (
          <div>
            <Badge variant={statusBadge.variant} size="sm">{statusBadge.label}</Badge>
            <div className="mt-1 text-sm text-gray-600">{item.dueDateFormatted}</div>
          </div>
        )
      }
    },
    {
      key: 'actions',
      header: '',
      width: '120px',
      cell: (item: ChecklistTodoItem) => (
        <Button
          size="sm"
          variant="success"
          loading={updatingKey === `${item.eventId}:${item.key}`}
          onClick={() => handleComplete(item)}
        >
          Mark done
        </Button>
      ),
      align: 'right' as const,
    }
  ]

  return (
    <PageWrapper>
      <PageHeader
        title="Event Checklist Todo"
        subtitle="Tasks due across upcoming events"
        backButton={{
          label: 'Back to Events',
          href: '/events'
        }}
        actions={
          <Button
            size="sm"
            variant="secondary"
            onClick={handleRefresh}
            loading={refreshing}
          >
            Refresh
          </Button>
        }
      />
      <PageContent>
        <Card>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-gray-200 p-4">
              <p className="text-sm text-gray-500">Overdue</p>
              <p className="mt-2 text-2xl font-semibold text-gray-900">{stats.overdue}</p>
              <p className="text-xs text-gray-500 mt-2">Past due checklist items</p>
            </div>
            <div className="rounded-lg border border-gray-200 p-4">
              <p className="text-sm text-gray-500">Due today</p>
              <p className="mt-2 text-2xl font-semibold text-gray-900">{stats.dueToday}</p>
              <p className="text-xs text-gray-500 mt-2">Tasks that need attention today</p>
            </div>
          </div>
        </Card>

        <Card className="mt-6">
          {error ? (
            <div className="rounded-md bg-red-50 p-4 text-sm text-red-700">
              {error}
            </div>
          ) : sortedItems.length === 0 ? (
            <EmptyState
              icon={<CheckCircleIcon className="h-12 w-12 text-green-500" />}
              title="Nothing on your list"
              description="You're all caught up on event prep tasks."
              variant="minimal"
            />
          ) : (
            <DataTable
              data={sortedItems}
              getRowKey={(item) => `${item.eventId}:${item.key}`}
              columns={columns}
            />
          )}
        </Card>
      </PageContent>
    </PageWrapper>
  )
}
