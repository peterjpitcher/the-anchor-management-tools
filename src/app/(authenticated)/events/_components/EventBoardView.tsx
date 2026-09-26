'use client'

import { Badge, Card, CardBody, CardHeader, Empty } from '@/ds'
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
        // One stage column: a sunk DS Card holding the stage's event tiles.
        <Card key={stage} variant="secondary" className="flex w-64 shrink-0 flex-col">
          <CardHeader title={stage} action={<Badge tone="neutral">{columnEvents.length}</Badge>} />
          <CardBody className="flex max-h-[600px] flex-1 flex-col gap-2 overflow-y-auto p-2">
            {columnEvents.length === 0 ? (
              <Empty size="sm" title="No events" description="No events are at this stage." />
            ) : (
              columnEvents.map((event) => (
                <EventCard
                  key={event.id}
                  event={event}
                  onClick={() => onEventClick(event)}
                />
              ))
            )}
          </CardBody>
        </Card>
      ))}
    </div>
  )
}
