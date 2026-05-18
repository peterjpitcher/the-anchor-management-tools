'use client'

import { useState } from 'react'
import { addMonths, subMonths, format } from 'date-fns'
import { Button } from '@/ds'
import { Icon } from '@/ds/icons'
import { CalendarGrid } from './CalendarGrid'
import type { Event } from '@/types/database'

interface EventCalendarViewProps {
  events: Event[]
  onEventClick: (event: Event) => void
}

export function EventCalendarView({ events, onEventClick }: EventCalendarViewProps) {
  const [currentMonth, setCurrentMonth] = useState<Date>(new Date())

  return (
    <div>
      {/* Month navigation */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            icon={<Icon name="chevronLeft" size={16} />}
            onClick={() => setCurrentMonth((m) => subMonths(m, 1))}
            aria-label="Previous month"
          />
          <h2 className="text-lg font-semibold text-text-strong min-w-[160px] text-center">
            {format(currentMonth, 'MMMM yyyy')}
          </h2>
          <Button
            variant="ghost"
            size="sm"
            icon={<Icon name="chevronRight" size={16} />}
            onClick={() => setCurrentMonth((m) => addMonths(m, 1))}
            aria-label="Next month"
          />
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setCurrentMonth(new Date())}
        >
          Today
        </Button>
      </div>

      {/* Calendar */}
      <div className="border border-border rounded-default overflow-hidden">
        <CalendarGrid
          month={currentMonth}
          events={events}
          onEventClick={onEventClick}
        />
      </div>
    </div>
  )
}
