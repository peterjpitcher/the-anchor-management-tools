'use client'

import { Badge } from '@/ds'
import { cn } from '@/lib/utils'
import type { Event } from '@/types/database'
import { formatDateInLondon } from '@/lib/dateUtils'

type BadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info'

interface EventCardProps {
  event: Event
  onClick?: () => void
  compact?: boolean
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

export function EventCard({ event, onClick, compact = false }: EventCardProps) {
  if (compact) {
    // Compact mode for calendar cells: single line
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onClick?.()
        }}
        className="w-full text-left px-1.5 py-0.5 rounded text-[11px] bg-primary-soft text-primary-soft-fg truncate hover:opacity-80 transition-opacity"
      >
        <span className="font-medium">{event.time || ''}</span>
        {event.time && ' '}
        <span>{event.name}</span>
      </button>
    )
  }

  // Normal mode for board columns
  return (
    <div
      className={cn(
        'rounded-default border border-border bg-surface p-3 shadow-sm',
        onClick && 'cursor-pointer hover:shadow-md hover:border-border-strong transition-all'
      )}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={(e) => {
        if (onClick && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          onClick()
        }
      }}
    >
      <div className="font-medium text-sm text-text-strong mb-1 line-clamp-2">
        {event.name}
      </div>
      <div className="text-xs text-text-muted mb-2">
        {formatDateInLondon(event.date)} {event.time ? `at ${event.time}` : ''}
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        {event.event_type && (
          <Badge tone="info">{event.event_type}</Badge>
        )}
        <Badge tone={getStatusTone(event.event_status)} dot>
          {formatStatusLabel(event.event_status)}
        </Badge>
      </div>
    </div>
  )
}
