'use client'

import { useEffect, useMemo, useState } from 'react'
import { getSpecialHours, getServiceStatusOverrides } from '@/app/actions/business-hours'
import type { SpecialHours, ServiceStatusOverride } from '@/types/business-hours'
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
import { SpecialHoursModal } from './SpecialHoursModal'
import toast from 'react-hot-toast'

interface SpecialHoursCalendarProps {
  canManage: boolean
  initialSpecialHours: SpecialHours[]
  initialOverrides?: ServiceStatusOverride[]
}

type CalendarDay = {
  date: Date
  iso: string
  inCurrentMonth: boolean
  isToday: boolean
  special?: SpecialHours
  overrides: ServiceStatusOverride[]
}

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const normalizeSpecialHours = (items: SpecialHours[]) =>
  items.map((item) => ({
    ...item,
    is_kitchen_closed: Boolean(item.is_kitchen_closed),
  }))

const normalizeOverrides = (items: ServiceStatusOverride[]) =>
  items.map((item) => ({
    ...item,
  }))

export function SpecialHoursCalendar({ canManage, initialSpecialHours, initialOverrides = [] }: SpecialHoursCalendarProps) {
  const [currentMonth, setCurrentMonth] = useState(() => startOfMonth(new Date()))
  const [specialHours, setSpecialHours] = useState<SpecialHours[]>(() => normalizeSpecialHours(initialSpecialHours))
  const [overrides, setOverrides] = useState<ServiceStatusOverride[]>(() => normalizeOverrides(initialOverrides))
  const [loading, setLoading] = useState(false)
  const [hasHydrated, setHasHydrated] = useState(false)

  // Modal State
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const [modalData, setModalData] = useState<SpecialHours | null>(null)

  useEffect(() => {
    setSpecialHours(normalizeSpecialHours(initialSpecialHours))
  }, [initialSpecialHours])

  useEffect(() => {
    setOverrides(normalizeOverrides(initialOverrides))
  }, [initialOverrides])

  const loadMonthData = async (anchorMonth: Date) => {
    setLoading(true)
    const startDate = format(startOfMonth(anchorMonth), 'yyyy-MM-dd')
    const endDate = format(endOfMonth(anchorMonth), 'yyyy-MM-dd')

    const [specialResult, overridesResult] = await Promise.all([
      getSpecialHours(startDate, endDate),
      getServiceStatusOverrides('sunday_lunch', startDate, endDate),
    ])

    if (specialResult.data) {
      setSpecialHours(normalizeSpecialHours(specialResult.data))
    } else if (specialResult.error) {
      toast.error(specialResult.error)
      setSpecialHours([])
    }

    if (overridesResult.data) {
      setOverrides(normalizeOverrides(overridesResult.data))
    } else if (overridesResult.error) {
      toast.error(overridesResult.error)
      setOverrides([])
    }
    setLoading(false)
  }

  useEffect(() => {
    if (!hasHydrated) {
      setHasHydrated(true)
      return
    }
    void loadMonthData(currentMonth)
  }, [currentMonth, hasHydrated])

  useEffect(() => {
    const handler = () => loadMonthData(currentMonth)
    if (typeof window !== 'undefined') {
      window.addEventListener('special-hours-updated', handler)
      window.addEventListener('service-status-overrides-updated', handler)
      return () => {
        window.removeEventListener('special-hours-updated', handler)
        window.removeEventListener('service-status-overrides-updated', handler)
      }
    }
    return () => {}
  }, [currentMonth])

  const handleDateClick = (day: CalendarDay) => {
    if (!canManage) return
    setSelectedDate(day.date)
    setModalData(day.special || null)
  }

  const handleModalSave = () => {
    loadMonthData(currentMonth)
  }

  const calendarDays: CalendarDay[] = useMemo(() => {
    const start = startOfWeek(startOfMonth(currentMonth), { weekStartsOn: 1 })
    const end = endOfWeek(endOfMonth(currentMonth), { weekStartsOn: 1 })

    const days = eachDayOfInterval({ start, end })
    return days.map((day) => {
      const iso = format(day, 'yyyy-MM-dd')
      const special = specialHours.find((entry) => entry.date === iso)
      const overridesForDay = overrides.filter(
        (override) => override.start_date <= iso && override.end_date >= iso
      )
      return {
        date: day,
        iso,
        inCurrentMonth: isSameMonth(day, currentMonth),
        isToday: isToday(day),
        special,
        overrides: overridesForDay,
      }
    })
  }, [currentMonth, specialHours, overrides])

  return (
    <Section
      title="Exceptions & Holidays Calendar"
      description="Click any date to close the venue, change hours, or adjust service slots."
    >
      <Card padding="lg" className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">
              {format(currentMonth, 'MMMM yyyy')}
            </h3>
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
              const closingOverride = day.overrides.find((override) => override.is_enabled === false)
              const enablingOverride = day.overrides.find((override) => override.is_enabled === true)
              const classNames = [
                'min-h-[88px] rounded-lg border px-2 py-2 text-left transition relative',
                day.inCurrentMonth ? 'border-gray-200' : 'border-gray-100 bg-gray-50 text-gray-400',
                day.isToday ? 'ring-2 ring-primary-500 ring-offset-2' : '',
                canManage ? 'hover:border-primary-400 hover:shadow-md cursor-pointer' : 'cursor-default',
              ]

              if (hasSpecial) {
                if (isClosed) {
                  classNames.push('bg-red-50 border-red-200')
                } else if (kitchenClosed) {
                  classNames.push('bg-amber-50 border-amber-200')
                } else {
                  classNames.push('bg-blue-50 border-blue-200')
                }
              }

              // Maintain visualization for old override system but deemphasize
              if (closingOverride) {
                classNames.push('bg-rose-50 border-rose-200 text-rose-900')
              } else if (enablingOverride) {
                classNames.push('bg-emerald-50 border-emerald-200 text-emerald-900')
              }

              return (
                <button
                  key={day.iso}
                  type="button"
                  className={classNames.join(' ')}
                  onClick={() => handleDateClick(day)}
                  disabled={!canManage}
                >
                  <span className="text-sm font-semibold block mb-1">{format(day.date, 'd')}</span>
                  
                  {/* Status Badges */}
                  <div className="space-y-1 text-xs">
                     {isClosed && <span className="inline-block px-1.5 py-0.5 rounded bg-red-100 text-red-800 font-medium">Closed</span>}
                     {!isClosed && kitchenClosed && <span className="inline-block px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-medium">Kitchen Closed</span>}
                     {!isClosed && hasSpecial && !kitchenClosed && <span className="inline-block px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 font-medium">Modified</span>}
                  </div>

                  {hasSpecial && (
                    <div className="mt-2 space-y-1 text-xs leading-snug">
                      {!isClosed && day.special?.opens && (
                        <p className="text-gray-700">
                          {day.special.opens?.slice(0, 5)} – {day.special.closes?.slice(0, 5) || 'Closed'}
                        </p>
                      )}
                      {day.special?.note && (
                        <p className="text-gray-500 line-clamp-2 italic">{day.special.note}</p>
                      )}
                    </div>
                  )}
                  {day.overrides.length > 0 && (
                    <div className="mt-2 space-y-1 text-xs leading-snug opacity-75">
                       {/* Legacy override display */}
                       <p className="text-xs text-gray-500 font-medium">Legacy Override Active</p>
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </Card>

      {selectedDate && (
        <SpecialHoursModal
          isOpen={!!selectedDate}
          onClose={() => setSelectedDate(null)}
          date={selectedDate}
          initialData={modalData}
          canManage={canManage}
          onSave={handleModalSave}
        />
      )}
    </Section>
  )
}
