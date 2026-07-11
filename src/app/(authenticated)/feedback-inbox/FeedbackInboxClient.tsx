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
  getReviewFeedbackList,
  updateReviewFeedbackStatus,
  type ReviewFeedbackItem,
} from '@/app/actions/feedback'
import { formatDateInLondon } from '@/lib/dateUtils'

interface Props {
  initialItems: ReviewFeedbackItem[]
  initialHasMore: boolean
  initialNewCount: number
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
  onUpdated: (id: string, status: FeedbackStatus, staffNotes: string | null) => void
}

/**
 * Shared status/notes controls, used by both the desktop table row and the
 * mobile card so the interactive behaviour stays identical across layouts.
 */
function FeedbackControls({ item, canManage, onUpdated }: RowProps) {
  const [status, setStatus] = useState<FeedbackStatus>(item.status)
  const [noteDraft, setNoteDraft] = useState('')
  const [savingStatus, setSavingStatus] = useState(false)
  const [savingNotes, setSavingNotes] = useState(false)

  async function persist(nextStatus: FeedbackStatus, note: string | undefined, kind: 'status' | 'notes') {
    if (kind === 'status') setSavingStatus(true)
    else setSavingNotes(true)
    try {
      const result = await updateReviewFeedbackStatus({
        id: item.id,
        status: nextStatus,
        ...(note ? { staffNotes: note } : {}),
      })
      if ('error' in result) {
        toast.error(result.error || 'Failed to update feedback')
        return false
      }
      toast.success(kind === 'status' ? 'Status updated' : 'Note added')
      onUpdated(item.id, result.data.status, result.data.staffNotes)
      if (kind === 'notes') setNoteDraft('')
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
    const ok = await persist(nextStatus, undefined, 'status')
    if (!ok) setStatus(previous)
  }

  if (!canManage) {
    return (
      <div className="flex flex-col gap-1">
        <Badge tone={STATUS_TONE[item.status]}>{STATUS_LABEL[item.status]}</Badge>
        {item.staffNotes && (
          <p className="whitespace-pre-line break-words text-xs text-text-muted [overflow-wrap:anywhere]">
            {item.staffNotes}
          </p>
        )}
      </div>
    )
  }

  return (
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
        {item.staffNotes && (
          <p className="whitespace-pre-line break-words text-xs text-text-muted [overflow-wrap:anywhere]">
            {item.staffNotes}
          </p>
        )}
        <Textarea
          label="Add a note"
          value={noteDraft}
          onChange={(event) => setNoteDraft(event.target.value)}
          rows={2}
          placeholder="Add a note..."
          disabled={savingNotes}
          aria-label="Add a note"
        />
        <div className="flex justify-end">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            loading={savingNotes}
            disabled={savingNotes || !noteDraft.trim()}
            onClick={() => persist(status, noteDraft.trim(), 'notes')}
          >
            Add note
          </Button>
        </div>
      </div>
    </div>
  )
}

function FeedbackRow({ item, canManage, onUpdated }: RowProps) {
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
        <FeedbackControls item={item} canManage={canManage} onUpdated={onUpdated} />
      </TableCell>
    </TableRow>
  )
}

/** Mobile layout: one stacked card per feedback item. */
function FeedbackCard({ item, canManage, onUpdated }: RowProps) {
  return (
    <div className="space-y-3 py-4 first:pt-0 last:pb-0">
      <div className="flex items-start justify-between gap-2">
        <StarRating rating={item.rating} />
        <span className="whitespace-nowrap text-xs text-text-muted">
          {formatDateInLondon(item.createdAt, { day: '2-digit', month: 'short', year: 'numeric' })}
        </span>
      </div>
      {item.comments ? (
        <p className="break-words text-[13px] text-text [overflow-wrap:anywhere]">{item.comments}</p>
      ) : (
        <p className="text-xs text-text-subtle">No comment</p>
      )}
      <div>
        <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-text-muted">Contact</p>
        <ContactCell item={item} />
      </div>
      <div className="border-t border-border pt-3">
        <FeedbackControls item={item} canManage={canManage} onUpdated={onUpdated} />
      </div>
    </div>
  )
}

export function FeedbackInboxClient({
  initialItems,
  initialHasMore,
  initialNewCount,
  canManage,
  loadError,
}: Props) {
  const router = useRouter()
  const [items, setItems] = useState<ReviewFeedbackItem[]>(initialItems)
  const [hasMore, setHasMore] = useState(initialHasMore)
  const [newCount, setNewCount] = useState(initialNewCount)
  const [showResolved, setShowResolved] = useState(false)
  const [loadingList, setLoadingList] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)

  function handleUpdated(id: string, status: FeedbackStatus, staffNotes: string | null) {
    // Keep the local "new" count in step with status transitions.
    const previous = items.find((item) => item.id === id)
    if (previous) {
      if (previous.status === 'new' && status !== 'new') {
        setNewCount((count) => Math.max(0, count - 1))
      } else if (previous.status !== 'new' && status === 'new') {
        setNewCount((count) => count + 1)
      }
    }
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, status, staffNotes } : item)),
    )
    // Keep server-rendered data in sync for a future full refresh.
    router.refresh()
  }

  async function toggleResolved() {
    const next = !showResolved
    setLoadingList(true)
    try {
      const result = await getReviewFeedbackList({ includeResolved: next, offset: 0 })
      if ('error' in result) {
        toast.error(result.error || 'Failed to load feedback')
        return
      }
      setShowResolved(next)
      setItems(result.data.items)
      setHasMore(result.data.hasMore)
      setNewCount(result.data.newCount)
    } catch {
      toast.error('Failed to load feedback')
    } finally {
      setLoadingList(false)
    }
  }

  async function loadMore() {
    setLoadingMore(true)
    try {
      const result = await getReviewFeedbackList({
        includeResolved: showResolved,
        offset: items.length,
      })
      if ('error' in result) {
        toast.error(result.error || 'Failed to load more feedback')
        return
      }
      setItems((current) => {
        const seen = new Set(current.map((item) => item.id))
        return [...current, ...result.data.items.filter((item) => !seen.has(item.id))]
      })
      setHasMore(result.data.hasMore)
      setNewCount(result.data.newCount)
    } catch {
      toast.error('Failed to load more feedback')
    } finally {
      setLoadingMore(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="Feedback"
        subtitle="Guest review feedback that needs following up"
        className="mb-3 pb-3"
        actions={
          <div className="flex items-center gap-2">
            <Badge tone="info">{newCount} new</Badge>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={toggleResolved}
              loading={loadingList}
              disabled={loadingList}
              aria-pressed={showResolved}
            >
              {showResolved ? 'Hide resolved' : 'Show resolved'}
            </Button>
          </div>
        }
      />

      {loadError && (
        <Alert tone="danger" className="mb-3">
          {loadError}
        </Alert>
      )}

      {(() => {
        const emptyContent = (
          <div className="flex flex-col items-center gap-1 text-text-muted">
            <Icon name="message" size={24} className="text-text-subtle" />
            <span className="text-sm font-medium">
              {showResolved ? 'No feedback yet' : 'No open feedback'}
            </span>
            <span className="text-xs text-text-subtle">
              {showResolved
                ? 'Guest feedback submitted through the review funnel will appear here.'
                : 'Resolved and dismissed items are hidden — use "Show resolved" to see them.'}
            </span>
          </div>
        )
        return (
      <Card>
        {/* Desktop: full table */}
        <div className="hidden md:block">
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
                  {emptyContent}
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
        </div>

        {/* Mobile: stacked cards */}
        <div className="md:hidden">
          {items.length === 0 ? (
            <div className="py-6">{emptyContent}</div>
          ) : (
            <div className="divide-y divide-border">
              {items.map((item) => (
                <FeedbackCard
                  key={item.id}
                  item={item}
                  canManage={canManage}
                  onUpdated={handleUpdated}
                />
              ))}
            </div>
          )}
        </div>
        {hasMore && (
          <div className="flex justify-center border-t border-border py-3">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={loadMore}
              loading={loadingMore}
              disabled={loadingMore}
            >
              Load more
            </Button>
          </div>
        )}
      </Card>
        )
      })()}
    </div>
  )
}
