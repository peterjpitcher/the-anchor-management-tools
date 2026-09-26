'use client'

import { Badge } from '@/ds'
import { cn } from '@/lib/utils'
import type { Event } from '@/types/database'
import { formatDateInLondon } from '@/lib/dateUtils'
import { eventStatusLabel, eventStatusTone } from '../_shared/status-ui'

interface EventCardProps {
  event: Event
  onClick?: () => void
}

/** One event on the board view: a clickable tile in a stage column. */
export function EventCard({ event, onClick }: EventCardProps) {
  return (
    <div
      className={cn(
        'rounded-default border border-border bg-surface p-3 shadow-sm',
        onClick && 'cursor-pointer hover:shadow-default hover:border-border-strong transition-all focus-visible:outline-hidden focus-visible:shadow-ring'
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
        {(event as any).category?.name && (
          <Badge tone="info">{(event as any).category.name}</Badge>
        )}
        <Badge tone={eventStatusTone(event.event_status)} dot>
          {eventStatusLabel(event.event_status)}
        </Badge>
      </div>
    </div>
  )
}
