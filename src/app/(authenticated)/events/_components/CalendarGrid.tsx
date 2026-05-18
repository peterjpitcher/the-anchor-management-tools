'use client'

import {
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  startOfWeek,
  endOfWeek,
  format,
  isSameMonth,
  isSameDay,
  isToday,
} from 'date-fns'
import { cn } from '@/lib/utils'
import { EventCard } from './EventCard'
import type { Event } from '@/types/database'

interface CalendarGridProps {
  month: Date
  events: Event[]
  onDayClick?: (date: Date) => void
  onEventClick?: (event: Event) => void
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export function CalendarGrid({ month, events, onDayClick, onEventClick }: CalendarGridProps) {
  const monthStart = startOfMonth(month)
  const monthEnd = endOfMonth(month)
  const calendarStart = startOfWeek(monthStart, { weekStartsOn: 1 })
  const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 1 })

  const days = eachDayOfInterval({ start: calendarStart, end: calendarEnd })

  function getEventsForDay(day: Date): Event[] {
    const dayStr = format(day, 'yyyy-MM-dd')
    return events.filter((e) => e.date === dayStr)
  }

  return (
    <div>
      {/* Weekday header */}
      <div className="grid grid-cols-7 border-b border-border">
        {WEEKDAYS.map((day) => (
          <div
            key={day}
            className="px-2 py-2 text-xs font-medium text-text-muted text-center uppercase tracking-wider"
          >
            {day}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 border-l border-border">
        {days.map((day) => {
          const dayEvents = getEventsForDay(day)
          const inCurrentMonth = isSameMonth(day, month)
          const today = isToday(day)

          return (
            <div
              key={day.toISOString()}
              className={cn(
                'min-h-[120px] border-r border-b border-border p-1.5 transition-colors',
                !inCurrentMonth && 'bg-surface-2/50',
                onDayClick && 'cursor-pointer hover:bg-surface-hover'
              )}
              onClick={() => onDayClick?.(day)}
            >
              {/* Date number */}
              <div className="flex items-center justify-between mb-1">
                <span
                  className={cn(
                    'inline-flex items-center justify-center w-6 h-6 text-xs rounded-full',
                    today && 'bg-primary text-primary-fg font-bold',
                    !today && inCurrentMonth && 'text-text font-medium',
                    !today && !inCurrentMonth && 'text-text-subtle'
                  )}
                >
                  {format(day, 'd')}
                </span>
              </div>

              {/* Events */}
              <div className="flex flex-col gap-0.5 overflow-y-auto max-h-[80px]">
                {dayEvents.map((event) => (
                  <EventCard
                    key={event.id}
                    event={event}
                    compact
                    onClick={() => onEventClick?.(event)}
                  />
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
