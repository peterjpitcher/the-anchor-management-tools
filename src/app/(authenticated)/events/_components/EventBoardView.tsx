'use client'

import { Badge, Empty } from '@/ds'
import { EventCard } from './EventCard'
import type { Event } from '@/types/database'

const LIFECYCLE_STAGES = ['Idea', 'Planned', 'Confirmed', 'Promoted', 'Completed', 'Cancelled'] as const
type LifecycleStage = typeof LIFECYCLE_STAGES[number]

interface EventBoardViewProps {
  events: Event[]
  onEventClick: (event: Event) => void
}

function mapStatusToStage(status: string | null | undefined): LifecycleStage {
  switch (status) {
    case 'scheduled': return 'Planned'
    case 'cancelled': return 'Cancelled'
    case 'postponed': return 'Idea'
    case 'rescheduled': return 'Planned'
    case 'sold_out': return 'Confirmed'
    default: return 'Idea'
  }
}

export function EventBoardView({ events, onEventClick }: EventBoardViewProps) {
  const columns = LIFECYCLE_STAGES.map((stage) => ({
    stage,
    events: events.filter((e) => mapStatusToStage(e.event_status) === stage),
  }))

  return (
    <div className="flex gap-4 overflow-x-auto pb-4 min-h-[400px]">
      {columns.map(({ stage, events: columnEvents }) => (
        <div
          key={stage}
          className="flex-shrink-0 w-64 flex flex-col bg-surface-2/50 rounded-default border border-border"
        >
          {/* Column header */}
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
            <span className="text-sm font-semibold text-text-strong">{stage}</span>
            <Badge tone="neutral">{columnEvents.length}</Badge>
          </div>

          {/* Column body */}
          <div className="flex-1 p-2 flex flex-col gap-2 overflow-y-auto max-h-[600px]">
            {columnEvents.length === 0 ? (
              <Empty title="Empty" description="No events in this stage" />
            ) : (
              columnEvents.map((event) => (
                <EventCard
                  key={event.id}
                  event={event}
                  onClick={() => onEventClick(event)}
                />
              ))
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
