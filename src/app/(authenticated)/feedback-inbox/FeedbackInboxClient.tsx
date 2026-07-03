'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  PageHeader,
  Card,
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/ds'
import { Badge, Select, Textarea, Button, Alert } from '@/ds'
import { Icon } from '@/ds/icons'
import toast from 'react-hot-toast'
import {
  updateReviewFeedbackStatus,
  type ReviewFeedbackItem,
} from '@/app/actions/feedback'
import { formatDateInLondon } from '@/lib/dateUtils'

interface Props {
  initialItems: ReviewFeedbackItem[]
  canManage: boolean
  loadError?: string | null
}

type FeedbackStatus = ReviewFeedbackItem['status']

const STATUS_OPTIONS: { value: FeedbackStatus; label: string }[] = [
  { value: 'new', label: 'New' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'dismissed', label: 'Dismissed' },
]

const STATUS_TONE: Record<FeedbackStatus, 'info' | 'warning' | 'success' | 'neutral'> = {
  new: 'info',
  in_progress: 'warning',
  resolved: 'success',
  dismissed: 'neutral',
}

const STATUS_LABEL: Record<FeedbackStatus, string> = {
  new: 'New',
  in_progress: 'In progress',
  resolved: 'Resolved',
  dismissed: 'Dismissed',
}

function StarRating({ rating }: { rating: number }) {
  const clamped = Math.max(0, Math.min(5, Math.round(rating)))
  return (
    <span
      className="inline-flex items-center gap-1"
      role="img"
      aria-label={`${clamped} out of 5 stars`}
      title={`${clamped}/5`}
    >
      <span aria-hidden="true" className="text-sm leading-none tracking-tight">
        {[1, 2, 3, 4, 5].map((position) => (
          <span
            key={position}
            className={position <= clamped ? 'text-warning' : 'text-border'}
          >
            {position <= clamped ? '★' : '☆'}
          </span>
        ))}
      </span>
      <span className="font-mono text-xs text-text-muted">{clamped}/5</span>
    </span>
  )
}

function ContactCell({ item }: { item: ReviewFeedbackItem }) {
  if (!item.contactConsent) {
    return <span className="text-xs text-text-subtle">No contact details</span>
  }

  const hasAny = item.customerName || item.customerEmail || item.customerPhone
  if (!hasAny) {
    return <span className="text-xs text-text-subtle">No contact details</span>
  }

  return (
    <div className="flex flex-col gap-0.5 text-xs">
      {item.customerName && <span className="font-medium text-text">{item.customerName}</span>}
      {item.customerEmail && (
        <a href={`mailto:${item.customerEmail}`} className="text-primary hover:underline">
          {item.customerEmail}
        </a>
      )}
      {item.customerPhone && (
        <a href={`tel:${item.customerPhone}`} className="text-text-muted hover:text-text">
          {item.customerPhone}
        </a>
      )}
    </div>
  )
}

interface RowProps {
  item: ReviewFeedbackItem
  canManage: boolean
  onUpdated: (id: string, status: FeedbackStatus, staffNotes: string) => void
}

function FeedbackRow({ item, canManage, onUpdated }: RowProps) {
  const [status, setStatus] = useState<FeedbackStatus>(item.status)
  const [notes, setNotes] = useState<string>(item.staffNotes ?? '')
  const [savingStatus, setSavingStatus] = useState(false)
  const [savingNotes, setSavingNotes] = useState(false)

  const notesDirty = notes !== (item.staffNotes ?? '')

  async function persist(nextStatus: FeedbackStatus, nextNotes: string, kind: 'status' | 'notes') {
    if (kind === 'status') setSavingStatus(true)
    else setSavingNotes(true)
    try {
      const result = await updateReviewFeedbackStatus({
        id: item.id,
        status: nextStatus,
        staffNotes: nextNotes,
      })
      if (result && 'error' in result) {
        toast.error(result.error || 'Failed to update feedback')
        return false
      }
      toast.success(kind === 'status' ? 'Status updated' : 'Notes saved')
      onUpdated(item.id, nextStatus, nextNotes)
      return true
    } catch {
      toast.error('Failed to update feedback')
      return false
    } finally {
      if (kind === 'status') setSavingStatus(false)
      else setSavingNotes(false)
    }
  }

  async function handleStatusChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const nextStatus = event.target.value as FeedbackStatus
    const previous = status
    setStatus(nextStatus)
    const ok = await persist(nextStatus, notes, 'status')
    if (!ok) setStatus(previous)
  }

  return (
    <TableRow>
      <TableCell className="py-2 align-top text-xs text-text-muted whitespace-nowrap">
        {formatDateInLondon(item.createdAt, { day: '2-digit', month: 'short', year: 'numeric' })}
      </TableCell>
      <TableCell className="py-2 align-top whitespace-nowrap">
        <StarRating rating={item.rating} />
      </TableCell>
      <TableCell className="max-w-xs py-2 align-top whitespace-normal break-words text-text">
        {item.comments ? (
          <span className="text-[13px] [overflow-wrap:anywhere]">{item.comments}</span>
        ) : (
          <span className="text-xs text-text-subtle">No comment</span>
        )}
      </TableCell>
      <TableCell className="py-2 align-top whitespace-normal">
        <ContactCell item={item} />
      </TableCell>
      <TableCell className="py-2 align-top">
        {canManage ? (
          <div className="flex flex-col gap-2">
            <Select
              label="Status"
              value={status}
              onChange={handleStatusChange}
              disabled={savingStatus}
              options={STATUS_OPTIONS}
              aria-label={`Status for feedback from ${formatDateInLondon(item.createdAt, { day: '2-digit', month: 'short', year: 'numeric' })}`}
            />
            <div className="flex flex-col gap-1">
              <Textarea
                label="Staff notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                rows={2}
                placeholder="Add a note..."
                disabled={savingNotes}
                aria-label="Staff notes"
              />
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  loading={savingNotes}
                  disabled={savingNotes || !notesDirty}
                  onClick={() => persist(status, notes, 'notes')}
                >
                  Save notes
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>
            {notes && (
              <p className="whitespace-normal break-words text-xs text-text-muted [overflow-wrap:anywhere]">
                {notes}
              </p>
            )}
          </div>
        )}
      </TableCell>
    </TableRow>
  )
}

export function FeedbackInboxClient({ initialItems, canManage, loadError }: Props) {
  const router = useRouter()
  const [items, setItems] = useState<ReviewFeedbackItem[]>(initialItems)

  function handleUpdated(id: string, status: FeedbackStatus, staffNotes: string) {
    setItems((current) =>
      current.map((item) =>
        item.id === id ? { ...item, status, staffNotes: staffNotes || null } : item,
      ),
    )
    // Keep server-rendered data in sync for a future full refresh.
    router.refresh()
  }

  return (
    <div>
      <PageHeader
        title="Feedback"
        subtitle="Guest review feedback that needs following up"
        className="mb-3 pb-3"
      />

      {loadError && (
        <Alert tone="danger" className="mb-3">
          {loadError}
        </Alert>
      )}

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[10%]">Date</TableHead>
              <TableHead className="w-[14%]">Rating</TableHead>
              <TableHead className="w-[30%]">Comments</TableHead>
              <TableHead className="w-[18%]">Contact</TableHead>
              <TableHead className="w-[28%]">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} align="center" className="py-10 text-center">
                  <div className="flex flex-col items-center gap-1 text-text-muted">
                    <Icon name="message" size={24} className="text-text-subtle" />
                    <span className="text-sm font-medium">No feedback yet</span>
                    <span className="text-xs text-text-subtle">
                      Guest feedback submitted through the review funnel will appear here.
                    </span>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              items.map((item) => (
                <FeedbackRow
                  key={item.id}
                  item={item}
                  canManage={canManage}
                  onUpdated={handleUpdated}
                />
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  )
}
