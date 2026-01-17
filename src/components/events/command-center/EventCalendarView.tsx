'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { addHours } from 'date-fns'
import { EventOverview } from '@/app/(authenticated)/events/get-events-command-center'
import { EventCalendar, type CalendarEvent } from '@/components/ui-v2/display/Calendar'

type CalendarViewMode = 'month' | 'week' | 'day'

function normalizeHexColor(color: string): string | null {
  const trimmed = color.trim()
  if (!trimmed.startsWith('#')) return null

  const hex = trimmed.slice(1)
  if (hex.length === 3) {
    const [r, g, b] = hex.split('')
    if (!r || !g || !b) return null
    return `#${r}${r}${g}${g}${b}${b}`
  }

  if (hex.length === 6) return `#${hex}`
  if (hex.length === 8) return `#${hex.slice(0, 6)}`

  return null
}

function getReadableTextColor(backgroundColor: string): string | undefined {
  const normalized = normalizeHexColor(backgroundColor)
  if (!normalized) return undefined

  const r = parseInt(normalized.slice(1, 3), 16)
  const g = parseInt(normalized.slice(3, 5), 16)
  const b = parseInt(normalized.slice(5, 7), 16)
  if ([r, g, b].some(Number.isNaN)) return undefined

  const brightness = (r * 299 + g * 587 + b * 114) / 1000
  return brightness >= 160 ? '#111827' : 'white'
}

function getEventColor(event: EventOverview): string {
  if (event.eventStatus === 'cancelled') return '#ef4444'
  if (event.eventStatus === 'postponed') return '#f59e0b'
  if (event.eventStatus === 'draft') return '#6b7280'

  if (event.category?.color) return event.category.color

  switch (event.statusBadge.tone) {
    case 'success':
      return '#22c55e'
    case 'warning':
      return '#f59e0b'
    case 'error':
      return '#ef4444'
    case 'info':
      return '#3b82f6'
    case 'neutral':
    default:
      return '#6b7280'
  }
}

function getEventStartDate(event: EventOverview): Date {
  const [yearStr, monthStr, dayStr] = event.date.split('-')
  const year = Number(yearStr)
  const monthIndex = Number(monthStr) - 1
  const day = Number(dayStr)

  const [hourStr, minuteStr] = (event.time || '00:00').split(':').slice(0, 2)
  const hours = Number(hourStr)
  const minutes = Number(minuteStr)

  return new Date(
    Number.isFinite(year) ? year : new Date().getFullYear(),
    Number.isFinite(monthIndex) ? monthIndex : new Date().getMonth(),
    Number.isFinite(day) ? day : new Date().getDate(),
    Number.isFinite(hours) ? hours : 0,
    Number.isFinite(minutes) ? minutes : 0
  )
}

export default function EventCalendarView({ events }: { events: EventOverview[] }) {
  const router = useRouter()
  const [calendarView, setCalendarView] = useState<CalendarViewMode>('month')

  const calendarEvents = useMemo<CalendarEvent[]>(() => {
    return events
      .map((event) => {
        const start = getEventStartDate(event)
        const end = addHours(start, 2)
        const color = getEventColor(event)

        return {
          id: event.id,
          title: event.name,
          start,
          end,
          color,
          textColor: getReadableTextColor(color),
        }
      })
      .sort((a, b) => a.start.getTime() - b.start.getTime())
  }, [events])

  return (
    <div className="space-y-4">
      {events.length === 0 && (
        <div className="text-center py-6 bg-gray-50 rounded-lg border border-dashed border-gray-300">
          <p className="text-sm text-gray-500">No events found matching your criteria.</p>
        </div>
      )}

      <EventCalendar
        events={calendarEvents}
        view={calendarView}
        onViewChange={setCalendarView}
        firstDayOfWeek={1}
        onEventClick={(event) => router.push(`/events/${event.id}`)}
      />
    </div>
  )
}

