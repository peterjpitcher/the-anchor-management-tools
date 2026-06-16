'use client'

import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TablePagination,
  Badge, Checkbox, IconButton, ConfirmDialog,
} from '@/ds'
import { Icon } from '@/ds/icons'
import { BarMini } from './BarMini'
import type { Event } from '@/types/database'
import { formatDateInLondon } from '@/lib/dateUtils'
import { useState, useCallback } from 'react'
import { resolveEventPaymentMode, resolveEventPriceAmount, resolveEventTicketPriceAmount } from '@/lib/events/pricing'

type BadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info'

interface EventListViewProps {
  events: Event[]
  pagination: { totalCount: number; currentPage: number; pageSize: number; totalPages: number }
  selectedIds: Set<string>
  onSelectionChange: (ids: Set<string>) => void
  onEventClick: (event: Event) => void
  onPageChange: (page: number) => void
  onDeleteSelected: () => void
}

function getStatusTone(status: string | null | undefined): BadgeTone {
  switch (status) {
    case 'scheduled': return 'success'
    case 'cancelled': return 'danger'
    case 'postponed': return 'warning'
    case 'rescheduled': return 'info'
    case 'sold_out': return 'primary'
    default: return 'neutral'
  }
}

function formatStatusLabel(status: string | null | undefined): string {
  if (!status) return 'Unknown'
  return status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function formatEventPriceSummary(event: Event): string {
  const ticketPrice = resolveEventTicketPriceAmount(event)
  const onlinePrice = resolveEventPriceAmount(event)
  const paymentMode = resolveEventPaymentMode(event)

  if (ticketPrice === 0 && paymentMode === 'free') return 'Free'
  if (onlinePrice !== ticketPrice) return `Ticket ${formatCurrency(ticketPrice)} / Online ${formatCurrency(onlinePrice)}`
  return formatCurrency(ticketPrice)
}

function formatCurrency(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return '-'
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(amount)
}

export function EventListView({
  events,
  pagination,
  selectedIds,
  onSelectionChange,
  onEventClick,
  onPageChange,
  onDeleteSelected,
}: EventListViewProps) {
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)

  const allSelected = events.length > 0 && events.every((e) => selectedIds.has(e.id))

  const toggleAll = useCallback(() => {
    if (allSelected) {
      onSelectionChange(new Set())
    } else {
      onSelectionChange(new Set(events.map((e) => e.id)))
    }
  }, [allSelected, events, onSelectionChange])

  const toggleOne = useCallback(
    (id: string) => {
      const next = new Set(selectedIds)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      onSelectionChange(next)
    },
    [selectedIds, onSelectionChange]
  )

  return (
    <div>
      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2 bg-primary-soft border-b border-border">
          <span className="text-sm font-medium text-text">
            {selectedIds.size} selected
          </span>
          <button
            type="button"
            onClick={() => setConfirmDeleteOpen(true)}
            className="text-sm font-medium text-danger hover:underline"
          >
            Delete Selected
          </button>
        </div>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <Checkbox
                label=""
                checked={allSelected}
                onChange={toggleAll}
              />
            </TableHead>
            <TableHead>Event</TableHead>
            <TableHead>Date</TableHead>
            <TableHead>Category</TableHead>
            <TableHead>Booked</TableHead>
            <TableHead align="right">Clicks</TableHead>
            <TableHead align="right">Price</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {events.length === 0 ? (
            <tr>
              <td colSpan={9} className="px-4 py-12 text-center text-sm text-text-muted">
                No events found
              </td>
            </tr>
          ) : (
            events.map((event) => {
              const capacity = event.capacity ?? 0
              const booked = (event as Event & { booked_count?: number }).booked_count ?? 0
              const bookedRatio = capacity > 0 ? Math.round((booked / capacity) * 100) : 0
              const linkClicks = (event as Event & { link_clicks?: number }).link_clicks ?? 0
              return (
                <TableRow key={event.id} onClick={() => onEventClick(event)}>
                  <TableCell>
                    <Checkbox
                      label=""
                      checked={selectedIds.has(event.id)}
                      onChange={() => toggleOne(event.id)}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="font-medium text-text-strong">{event.name}</div>
                    <div className="text-xs text-text-muted">{event.id.slice(0, 8)}</div>
                  </TableCell>
                  <TableCell>
                    <div>{formatDateInLondon(event.date)}</div>
                    <div className="text-xs text-text-muted">{event.time || '-'}</div>
                  </TableCell>
                  <TableCell>
                    {event.event_type ? (
                      <Badge tone="info">{event.event_type}</Badge>
                    ) : (
                      <span className="text-text-muted">-</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-text-muted">
                        {capacity > 0 ? `${booked}/${capacity}` : '-'}
                      </span>
                      {capacity > 0 && <BarMini value={bookedRatio} />}
                    </div>
                  </TableCell>
                  <TableCell align="right">
                    <span className="text-xs text-text-muted">{linkClicks > 0 ? linkClicks.toLocaleString() : '-'}</span>
                  </TableCell>
                  <TableCell align="right">{formatEventPriceSummary(event)}</TableCell>
                  <TableCell>
                    <Badge tone={getStatusTone(event.event_status)} dot>
                      {formatStatusLabel(event.event_status)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <IconButton
                      icon={<Icon name="moreHorizontal" size={16} />}
                      label="Event actions"
                      onClick={(e) => {
                        e.stopPropagation()
                      }}
                    />
                  </TableCell>
                </TableRow>
              )
            })
          )}
        </TableBody>
      </Table>

      <TablePagination
        page={pagination.currentPage}
        totalPages={pagination.totalPages}
        onPageChange={onPageChange}
        pageSize={pagination.pageSize}
        totalItems={pagination.totalCount}
      />

      <ConfirmDialog
        open={confirmDeleteOpen}
        onClose={() => setConfirmDeleteOpen(false)}
        onConfirm={() => {
          setConfirmDeleteOpen(false)
          onDeleteSelected()
        }}
        title="Delete Events"
        message={`Are you sure you want to delete ${selectedIds.size} event(s)? This action cannot be undone.`}
        confirmLabel="Delete"
        tone="danger"
      />
    </div>
  )
}
