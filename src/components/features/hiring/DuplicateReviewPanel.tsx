'use client'

import { useState } from 'react'
import toast from 'react-hot-toast'
import { Button } from '@/components/ui-v2/forms/Button'
import { Badge } from '@/components/ui-v2/display/Badge'
import { EmptyState } from '@/components/ui-v2/display/EmptyState'
import { fetchDuplicateReviewQueueAction, resolveDuplicateReviewAction } from '@/actions/hiring-duplicates'
import type { DuplicateReviewItem } from '@/lib/hiring/duplicates'
import { formatDate } from '@/lib/utils'

interface DuplicateReviewPanelProps {
  initialItems: DuplicateReviewItem[]
  canEdit: boolean
}

export function DuplicateReviewPanel({ initialItems, canEdit }: DuplicateReviewPanelProps) {
  const [items, setItems] = useState<DuplicateReviewItem[]>(initialItems)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const refresh = async () => {
    setIsRefreshing(true)
    try {
      const result = await fetchDuplicateReviewQueueAction()
      if (!result.success) {
        toast.error(result.error || 'Failed to refresh duplicate queue')
        return
      }
      setItems(result.data || [])
    } finally {
      setIsRefreshing(false)
    }
  }

  const resolve = async (eventId: string, status: 'resolved' | 'ignored') => {
    setBusyId(eventId)
    try {
      const result = await resolveDuplicateReviewAction({ eventId, status })
      if (!result.success) {
        toast.error(result.error || 'Failed to update review')
        return
      }
      toast.success(status === 'resolved' ? 'Marked resolved' : 'Ignored duplicate')
      setItems((prev) => prev.filter((item) => item.id !== eventId))
    } finally {
      setBusyId(null)
    }
  }

  if (items.length === 0) {
    return (
      <EmptyState
        title="No duplicates waiting"
        description="Potential duplicates will appear here for review."
        icon="inbox"
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button variant="secondary" size="sm" onClick={refresh} loading={isRefreshing}>
          Refresh
        </Button>
      </div>

      {items.map((item) => {
        const matches = Array.isArray(item.metadata?.matches) ? item.metadata.matches : []
        const incomingEmail = item.metadata?.incoming_email
        const incomingPhone = item.metadata?.incoming_phone
        const isBusy = busyId === item.id

        return (
          <div key={item.id} className="border border-gray-200 rounded-lg p-4 space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="font-medium text-gray-900">
                  {item.candidate?.first_name} {item.candidate?.last_name}
                </div>
                <div className="text-xs text-gray-500">{item.candidate?.email}</div>
                <div className="text-xs text-gray-400">Reported {formatDate(item.created_at)}</div>
              </div>
              <Badge variant="warning" size="sm">Possible duplicate</Badge>
            </div>

            <div className="text-xs text-gray-600">
              Incoming: {incomingEmail || 'n/a'}{incomingPhone ? ` · ${incomingPhone}` : ''}
            </div>

            {matches.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs font-semibold text-gray-600">Potential matches</div>
                <div className="space-y-2">
                  {matches.map((match: any) => (
                    <div key={match.id} className="rounded-md bg-gray-50 p-2 text-xs text-gray-700">
                      <div className="font-medium text-gray-800">
                        {match.first_name} {match.last_name}
                      </div>
                      <div>{match.email || 'No email'}{match.phone ? ` · ${match.phone}` : ''}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {canEdit && (
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="secondary" size="sm" loading={isBusy} onClick={() => resolve(item.id, 'resolved')}>
                  Mark resolved
                </Button>
                <Button variant="ghost" size="sm" loading={isBusy} onClick={() => resolve(item.id, 'ignored')}>
                  Ignore
                </Button>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
