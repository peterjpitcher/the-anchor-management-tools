'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
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
  startOfMonth,
  startOfWeek,
} from 'date-fns'
import { Badge, Button, Card, CardBody, CardHeader, Icon, IconButton, PageLoading, SubHeading, toast } from '@/ds'
import { cn } from '@/lib/utils'
import { SpecialHoursModal } from './SpecialHoursModal'
import {
  SPECIAL_HOURS_BADGE,
  SPECIAL_HOURS_DAY_CLASSES,
  type SpecialHoursDayState,
} from '../_shared/status-ui'
import { getTodayIsoDate } from '@/lib/dateUtils'

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

// The default for an omitted initialOverrides must be one shared array. A `= []` default is a new
// array on every render, so the effect that syncs the prop into state re-ran each render, set a
// new array, and looped without end.
const NO_OVERRIDES: ServiceStatusOverride[] = []

const normalizeSpecialHours = (items: SpecialHours[]) =>
  items.map((item) => ({
    ...item,
    is_kitchen_closed: Boolean(item.is_kitchen_closed),
  }))

const normalizeOverrides = (items: ServiceStatusOverride[]) =>
  items.map((item) => ({
    ...item,
  }))

export function SpecialHoursCalendar({ canManage, initialSpecialHours, initialOverrides = NO_OVERRIDES }: SpecialHoursCalendarProps) {
  const router = useRouter()
  // London's month, not the host's: this renders on the UTC server first. Noon keeps the host-local
  // Date on the London calendar date whatever zone the host is in.
  const [currentMonth, setCurrentMonth] = useState(() => startOfMonth(new Date(`${getTodayIsoDate()}T12:00:00`)))
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
    router.refresh()
  }

  const calendarDays: CalendarDay[] = useMemo(() => {
    const start = startOfWeek(startOfMonth(currentMonth), { weekStartsOn: 1 })
    const end = endOfWeek(endOfMonth(currentMonth), { weekStartsOn: 1 })

    const days = eachDayOfInterval({ start, end })
    const todayIso = getTodayIsoDate()
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
        isToday: iso === todayIso,
        special,
        overrides: overridesForDay,
      }
    })
  }, [currentMonth, specialHours, overrides])

  return (
    <Card>
      <CardHeader
        title="Exceptions & Holidays Calendar"
        subtitle="Click any date to close the venue or change hours"
      />
      <CardBody className="space-y-4">
        <div className="flex items-center justify-between">
          <SubHeading>{format(currentMonth, 'MMMM yyyy')}</SubHeading>
          <div className="flex items-center gap-2">
            <IconButton
              type="button"
              variant="secondary"
              label="Previous month"
              onClick={() => setCurrentMonth((prev) => addMonths(prev, -1))}
              icon={<Icon name="arrowLeft" size={16} />}
            />
            <Button
              type="button"
              variant="secondary"
              onClick={() => setCurrentMonth(startOfMonth(new Date()))}
            >
              Today
            </Button>
            <IconButton
              type="button"
              variant="secondary"
              label="Next month"
              onClick={() => setCurrentMonth((prev) => addMonths(prev, 1))}
              icon={<Icon name="arrowRight" size={16} />}
            />
          </div>
        </div>

        {/* On mobile the 7-column month grid keeps every date tappable inside
            its own horizontal-scroll container so no cell/badge is clipped;
            at md+ it reverts to full-width with no scroll. */}
        <div className="overflow-x-auto">
          <div className="min-w-[640px] space-y-4 md:min-w-0">
            <div className="grid grid-cols-7 gap-2 text-sm font-medium text-text-muted">
              {WEEKDAY_LABELS.map((label) => (
                <div key={label} className="text-center uppercase tracking-wide">
                  {label}
                </div>
              ))}
            </div>

            {loading ? (
              <PageLoading inline label="Loading calendar" />
            ) : (
              <div className="grid grid-cols-7 gap-2 text-sm">
                {calendarDays.map((day) => {
                  const hasSpecial = Boolean(day.special)
                  const isClosed = hasSpecial && day.special?.is_closed
                  const kitchenClosed =
                    hasSpecial && !isClosed && day.special?.is_kitchen_closed
                  const closingOverride = day.overrides.find((override) => override.is_enabled === false)
                  const enablingOverride = day.overrides.find((override) => override.is_enabled === true)
                  // One state decides the tint and border. The old override system is still shown and
                  // wins over a special-hours entry, as it did when these classes were pushed in order.
                  // cn() puts the state last, so its border and tint beat the neutral ones: joining the
                  // classes as plain strings let Tailwind's emission order pick, and the grey border
                  // and the out-of-month grey hid the state colours.
                  const dayState: SpecialHoursDayState = closingOverride
                    ? 'overrideClosed'
                    : enablingOverride
                      ? 'overrideOpen'
                      : isClosed
                        ? 'closed'
                        : kitchenClosed
                          ? 'kitchenClosed'
                          : hasSpecial
                            ? 'modified'
                            : 'normal'
                  const badge = isClosed
                    ? SPECIAL_HOURS_BADGE.closed
                    : kitchenClosed
                      ? SPECIAL_HOURS_BADGE.kitchenClosed
                      : hasSpecial
                        ? SPECIAL_HOURS_BADGE.modified
                        : null

                  return (
                    // A raw button: this is a cell of the month grid, holding the date, a badge and
                    // the hours, which a DS Button cannot lay out.
                    <button
                      key={day.iso}
                      type="button"
                      className={cn(
                        'relative min-h-[88px] rounded-default border px-2 py-2 text-left transition',
                        'focus-visible:outline-hidden focus-visible:shadow-ring-inset',
                        !day.inCurrentMonth && 'bg-surface-2 text-text-soft',
                        // Today: an inset ring, so it never needs an offset against the page colour.
                        day.isToday && 'ring-2 ring-inset ring-primary',
                        canManage ? 'cursor-pointer hover:border-primary hover:shadow-default' : 'cursor-default',
                        SPECIAL_HOURS_DAY_CLASSES[dayState],
                      )}
                      onClick={() => handleDateClick(day)}
                      disabled={!canManage}
                    >
                      <span className="text-sm font-semibold block mb-1">{format(day.date, 'd')}</span>

                      {/* Status Badges */}
                      <div className="space-y-1 text-xs">
                        {badge && <Badge tone={badge.tone} size="sm">{badge.label}</Badge>}
                      </div>

                      {hasSpecial && (
                        <div className="mt-2 space-y-1 text-xs leading-snug">
                          {!isClosed && day.special?.opens && (
                            <p className="text-text">
                              {day.special.opens?.slice(0, 5)} – {day.special.closes?.slice(0, 5) || 'Closed'}
                            </p>
                          )}
                          {day.special?.note && (
                            <p className="text-text-muted line-clamp-2 italic">{day.special.note}</p>
                          )}
                        </div>
                      )}
                      {day.overrides.length > 0 && (
                        <div className="mt-2 space-y-1 text-xs leading-snug opacity-75">
                          {/* Legacy override display */}
                          <p className="text-xs text-text-muted font-medium">Legacy Override Active</p>
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </CardBody>

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
    </Card>
  )
}
