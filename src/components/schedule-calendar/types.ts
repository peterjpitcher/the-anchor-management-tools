// src/components/schedule-calendar/types.ts
import type { ReactNode } from 'react'

export type CalendarEntryKind =
    | 'event'
    | 'private_booking'
    | 'calendar_note'
    | 'parking'

export type CalendarEntryStatus =
    | 'scheduled'
    | 'draft'
    | 'confirmed'
    | 'sold_out'
    | 'postponed'
    | 'rescheduled'
    | 'cancelled'
    | null

export interface CalendarEntry {
    id: string
    kind: CalendarEntryKind
    title: string
    start: Date
    end: Date
    allDay: boolean
    spansMultipleDays: boolean
    endsNextDay: boolean
    color: string
    subtitle: string | null
    status: CalendarEntryStatus
    statusLabel: string | null
    tooltipData: TooltipData
    onClickHref: string | null
}

export type TooltipData =
    | {
          kind: 'event'
          name: string
          time: string
          bookedSeats: number
          category: string | null
          status: CalendarEntryStatus
      }
    | {
          kind: 'private_booking'
          customerName: string
          eventType: string | null
          guestCount: number | null
          timeRange: string
          endsNextDay: boolean
      }
    | {
          kind: 'calendar_note'
          title: string
          dateRange: string
          notes: string | null
          source: 'ai' | 'manual'
      }
    | {
          kind: 'parking'
          reference: string | null
          customerName: string
          vehicleReg: string | null
          timeRange: string
          status: string | null
      }

export type ScheduleCalendarView = 'month' | 'week' | 'list'

export interface ScheduleCalendarProps {
    entries: CalendarEntry[]
    view: ScheduleCalendarView
    onViewChange: (view: ScheduleCalendarView) => void
    canCreateCalendarNote?: boolean
    onEmptyDayClick?: (date: Date) => void
    renderTooltip?: (entry: CalendarEntry) => ReactNode
    firstDayOfWeek?: 0 | 1 | 2 | 3 | 4 | 5 | 6
    legendKinds?: CalendarEntryKind[] // kinds actually present & permitted
    className?: string
}
