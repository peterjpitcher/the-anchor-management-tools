'use client'

import { Badge, Card } from '@/ds'
import { cn } from '@/lib/utils'
import type { Event } from '@/types/database'
import { formatDateInLondon } from '@/lib/dateUtils'
import { eventStatusLabel, eventStatusTone } from '../_shared/status-ui'

interface EventCardProps {
  event: Event
  onClick?: () => void
}

/** The board query embeds the event's category, which the Event row type does not carry. */
type BoardEvent = Event & { category?: { name?: string | null } | null }

/**
 * One event on the board view: a DS Card tile in a stage column. With onClick the whole tile
 * is the control (click, Enter or Space), and its focus ring sits inside the card, which clips.
 */
export function EventCard({ event, onClick }: EventCardProps) {
  const categoryName = (event as BoardEvent).category?.name
  const body = (
    <>
      <div className="font-medium text-sm text-text-strong mb-1 line-clamp-2">
        {event.name}
      </div>
      <div className="text-xs text-text-muted mb-2">
        {formatDateInLondon(event.date)} {event.time ? `at ${event.time}` : ''}
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        {categoryName && <Badge tone="info">{categoryName}</Badge>}
        <Badge tone={eventStatusTone(event.event_status)} dot>
          {eventStatusLabel(event.event_status)}
        </Badge>
      </div>
    </>
  )

  if (!onClick) {
    return <Card padding="sm">{body}</Card>
  }

  return (
    <Card
      padding="none"
      className="transition-all hover:border-border-strong hover:shadow-default"
    >
      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onClick()
          }
        }}
        className={cn(
          'block cursor-pointer p-3 rounded-lg',
          'focus-visible:outline-hidden focus-visible:shadow-ring-inset'
        )}
      >
        {body}
      </div>
    </Card>
  )
}
