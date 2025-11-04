'use client'

import { useEffect, useMemo, useState } from 'react'
import { getSpecialHours } from '@/app/actions/business-hours'
import type { SpecialHours } from '@/types/business-hours'
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
} from 'date-fns'
import { Button } from '@/components/ui-v2/forms/Button'
import { Card } from '@/components/ui-v2/layout/Card'
import { Section } from '@/components/ui-v2/layout/Section'
import { ArrowLeftIcon, ArrowRightIcon } from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'

interface SpecialHoursCalendarProps {
  canManage: boolean
}

type CalendarDay = {
  date: Date
  iso: string
  inCurrentMonth: boolean
  isToday: boolean
  special?: SpecialHours
}

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export function SpecialHoursCalendar({ canManage }: SpecialHoursCalendarProps) {
  const [currentMonth, setCurrentMonth] = useState(() => startOfMonth(new Date()))
  const [specialHours, setSpecialHours] = useState<SpecialHours[]>([])
  const [loading, setLoading] = useState(true)

  const loadMonthData = async (anchorMonth: Date) => {
    setLoading(true)
    const startDate = format(startOfMonth(anchorMonth), 'yyyy-MM-dd')
    const endDate = format(endOfMonth(anchorMonth), 'yyyy-MM-dd')

    const result = await getSpecialHours(startDate, endDate)
    if (result.data) {
      setSpecialHours(result.data)
    } else if (result.error) {
      toast.error(result.error)
      setSpecialHours([])
    }
    setLoading(false)
  }

  useEffect(() => {
    void loadMonthData(currentMonth)
  }, [currentMonth])

  useEffect(() => {
    const handler = () => loadMonthData(currentMonth)
    if (typeof window !== 'undefined') {
      window.addEventListener('special-hours-updated', handler)
      return () => window.removeEventListener('special-hours-updated', handler)
    }
    return () => {}
  }, [currentMonth])

  const calendarDays: CalendarDay[] = useMemo(() => {
    const start = startOfWeek(startOfMonth(currentMonth), { weekStartsOn: 1 })
    const end = endOfWeek(endOfMonth(currentMonth), { weekStartsOn: 1 })

    const days = eachDayOfInterval({ start, end })
    return days.map((day) => {
      const iso = format(day, 'yyyy-MM-dd')
      const special = specialHours.find((entry) => entry.date === iso)
      return {
        date: day,
        iso,
        inCurrentMonth: isSameMonth(day, currentMonth),
        isToday: isToday(day),
        special,
      }
    })
  }, [currentMonth, specialHours])

  return (
    <Section
      title="Special Hours & Holidays Calendar"
      description="See closures and modified service days at a glance."
    >
      <Card padding="lg" className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">
              {format(currentMonth, 'MMMM yyyy')}
            </h3>
            <p className="text-sm text-gray-600">
              Click entries to review notes, closures, and kitchen availability.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setCurrentMonth((prev) => addMonths(prev, -1))}
            >
              <ArrowLeftIcon className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setCurrentMonth(startOfMonth(new Date()))}
            >
              Today
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setCurrentMonth((prev) => addMonths(prev, 1))}
            >
              <ArrowRightIcon className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-2 text-sm font-medium text-gray-600">
          {WEEKDAY_LABELS.map((label) => (
            <div key={label} className="text-center uppercase tracking-wide">
              {label}
            </div>
          ))}
        </div>

        {loading ? (
          <div className="py-10 text-center text-sm text-gray-600">
            Loading calendar…
          </div>
        ) : (
          <div className="grid grid-cols-7 gap-2 text-sm">
            {calendarDays.map((day) => {
              const hasSpecial = Boolean(day.special)
              const isClosed = hasSpecial && day.special?.is_closed
              const kitchenClosed =
                hasSpecial && !isClosed && day.special?.is_kitchen_closed

              return (
                <button
                  key={day.iso}
                  type="button"
                  className={[
                    'min-h-[88px] rounded-lg border px-2 py-2 text-left transition',
                    day.inCurrentMonth ? 'border-gray-200' : 'border-gray-100 bg-gray-50 text-gray-400',
                    day.isToday ? 'ring-2 ring-primary-500 ring-offset-2' : '',
                    hasSpecial ? (isClosed ? 'bg-red-50 border-red-200' : kitchenClosed ? 'bg-amber-50 border-amber-200' : 'bg-blue-50 border-blue-200') : '',
                    canManage ? 'hover:border-primary-400 hover:shadow-sm' : '',
                  ].join(' ')}
                  disabled
                >
                  <span className="text-sm font-semibold">{format(day.date, 'd')}</span>
                  {hasSpecial && (
                    <div className="mt-2 space-y-1 text-xs leading-snug">
                      {isClosed && <p className="font-medium text-red-600">Closed</p>}
                      {kitchenClosed && !isClosed && (
                        <p className="font-medium text-amber-600">Kitchen closed</p>
                      )}
                      {!isClosed && day.special?.opens && (
                        <p className="text-gray-700">
                          {day.special.opens?.slice(0, 5)} – {day.special.closes?.slice(0, 5) || 'Closed'}
                        </p>
                      )}
                      {day.special?.note && (
                        <p className="text-gray-500 line-clamp-2">{day.special.note}</p>
                      )}
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </Card>
    </Section>
  )
}
