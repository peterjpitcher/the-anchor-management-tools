'use client'

import { useEffect, useMemo, useState } from 'react'
import { getCustomerCategoryPreferences, getCustomerEventActivity } from '@/app/actions/event-categories'
import { TagIcon } from '@heroicons/react/24/outline'
import { formatDate, formatTime12Hour, formatDateTime12Hour } from '@/lib/dateUtils'
import { Badge } from '@/components/ui-v2/display/Badge'

interface CategoryPreference {
  customer_id: string
  category_id: string
  times_attended: number
  last_attended: string | null
  created_at: string
  updated_at: string
  event_categories: {
    id: string
    name: string
    color: string
    icon: string
  }
}

interface CustomerCategoryPreferencesProps {
  customerId: string
}

interface EventActivityBooking {
  id: string
  event_id: string
  seats: number | null
  created_at: string
  notes: string | null
  event: {
    id: string
    name: string
    date: string
    time: string
    slug: string
    category?: {
      id: string
      name: string
      color: string
    } | null
  } | null
}

interface EventActivityCheckIn {
  id: string
  event_id: string
  booking_id: string | null
  check_in_time: string | null
  check_in_method: string | null
  event: {
    id: string
    name: string
    date: string
    time: string
    slug: string
  } | null
}

interface EventSummary {
  eventId: string
  name: string
  date: string | null
  time: string | null
  slug: string | null
  categoryName?: string
  categoryColor?: string
  bookedAt: string | null
  checkInTime: string | null
  status: 'booked' | 'checked_in'
  seats: number | null
  activityTimestamp: string | null
}

export function CustomerCategoryPreferences({ customerId }: CustomerCategoryPreferencesProps) {
  const [preferences, setPreferences] = useState<CategoryPreference[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [eventActivity, setEventActivity] = useState<{
    bookings: EventActivityBooking[]
    checkIns: EventActivityCheckIn[]
  }>({ bookings: [], checkIns: [] })

  useEffect(() => {
    async function loadPreferences() {
      setIsLoading(true)
      try {
        const [preferencesResult, activityResult] = await Promise.all([
          getCustomerCategoryPreferences(customerId),
          getCustomerEventActivity(customerId)
        ])

        if ('error' in preferencesResult) {
          console.error('Error loading category preferences:', preferencesResult.error)
          setPreferences([])
        } else if (preferencesResult.data) {
          setPreferences(preferencesResult.data)
        } else {
          setPreferences([])
        }

        if ('error' in activityResult) {
          console.error('Error loading customer event activity:', activityResult.error)
          setEventActivity({ bookings: [], checkIns: [] })
        } else {
          setEventActivity({
            bookings: activityResult.bookings,
            checkIns: activityResult.checkIns,
          })
        }
      } catch (error) {
        console.error('Error loading category preferences:', error)
        setPreferences([])
        setEventActivity({ bookings: [], checkIns: [] })
      } finally {
        setIsLoading(false)
      }
    }

    loadPreferences()
  }, [customerId])

  const totalEvents = preferences.reduce((sum, pref) => sum + pref.times_attended, 0)
  const favoriteCategory = preferences[0] ?? null
  const showCategoryInsights = preferences.length > 0

  const eventSummaries = useMemo<EventSummary[]>(() => {
    const map = new Map<string, EventSummary>()

    const applyEventDetails = (summary: EventSummary, event: EventActivityBooking['event'] | EventActivityCheckIn['event']) => {
      if (!event) return summary
      return {
        ...summary,
        name: event.name || summary.name,
        date: event.date || summary.date,
        time: event.time || summary.time,
        slug: event.slug || summary.slug,
      }
    }

    eventActivity.bookings.forEach((booking) => {
      if (!booking.event_id) return

      const existing = map.get(booking.event_id)
      const base: EventSummary = existing || {
        eventId: booking.event_id,
        name: booking.event?.name || 'Unknown event',
        date: booking.event?.date || null,
        time: booking.event?.time || null,
        slug: booking.event?.slug || null,
        categoryName: booking.event?.category?.name || undefined,
        categoryColor: booking.event?.category?.color || undefined,
        bookedAt: booking.created_at,
        checkInTime: null,
        status: 'booked',
        seats: booking.seats ?? null,
        activityTimestamp: booking.created_at,
      }

      const updated: EventSummary = {
        ...base,
        bookedAt: base.bookedAt && base.bookedAt > booking.created_at ? base.bookedAt : booking.created_at,
        seats: booking.seats ?? base.seats ?? null,
        categoryName: booking.event?.category?.name || base.categoryName,
        categoryColor: booking.event?.category?.color || base.categoryColor,
      }

      map.set(booking.event_id, applyEventDetails(updated, booking.event))
    })

    eventActivity.checkIns.forEach((checkIn) => {
      if (!checkIn.event_id) return

      const existing = map.get(checkIn.event_id)

      if (existing) {
        const updated: EventSummary = {
          ...existing,
          status: 'checked_in',
          checkInTime: checkIn.check_in_time || existing.checkInTime,
          activityTimestamp: checkIn.check_in_time || existing.activityTimestamp,
        }

        map.set(checkIn.event_id, applyEventDetails(updated, checkIn.event))
        return
      }

      map.set(checkIn.event_id, applyEventDetails({
        eventId: checkIn.event_id,
        name: checkIn.event?.name || 'Unknown event',
        date: checkIn.event?.date || null,
        time: checkIn.event?.time || null,
        slug: checkIn.event?.slug || null,
        categoryName: undefined,
        categoryColor: undefined,
        bookedAt: null,
        checkInTime: checkIn.check_in_time || null,
        status: 'checked_in',
        seats: null,
        activityTimestamp: checkIn.check_in_time || null,
      }, checkIn.event))
    })

    return Array.from(map.values()).sort((a, b) => {
      const aTime = a.activityTimestamp ? new Date(a.activityTimestamp).getTime() : 0
      const bTime = b.activityTimestamp ? new Date(b.activityTimestamp).getTime() : 0
      return bTime - aTime
    })
  }, [eventActivity])

  const attendedCount = eventSummaries.filter(summary => summary.status === 'checked_in').length
  const bookedCount = eventSummaries.filter(summary => summary.bookedAt !== null).length

  const summaryLabel = (() => {
    if (eventSummaries.length > 0) {
      return `${attendedCount} attended • ${bookedCount} booked`
    }
    if (totalEvents > 0) {
      return `${totalEvents} total events attended`
    }
    return null
  })()

  const renderEventDate = (summary: EventSummary) => {
    if (!summary.date) {
      return 'Date TBC'
    }

    const dateText = formatDate(summary.date)
    if (!summary.time) {
      return dateText
    }

    return `${dateText} • ${formatTime12Hour(summary.time)}`
  }

  if (isLoading) {
    return (
      <div className="bg-white shadow overflow-hidden sm:rounded-lg">
        <div className="px-4 py-5 sm:p-6">
          <div className="animate-pulse">
            <div className="h-6 bg-gray-200 rounded w-1/4 mb-4"></div>
            <div className="space-y-3">
              <div className="h-12 bg-gray-100 rounded"></div>
              <div className="h-12 bg-gray-100 rounded"></div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white shadow overflow-hidden sm:rounded-lg">
      <div className="px-4 py-5 sm:p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-medium leading-6 text-gray-900 flex items-center">
            <TagIcon className="h-5 w-5 mr-2 text-gray-400" />
            Event Preferences
          </h3>
          {summaryLabel && (
            <span className="text-sm text-gray-500">
              {summaryLabel}
            </span>
          )}
        </div>

        {showCategoryInsights && (
          <div className="space-y-3">
            {preferences.map((pref) => {
              const percentage = totalEvents > 0 ? Math.round((pref.times_attended / totalEvents) * 100) : 0
              const isFavorite = favoriteCategory?.category_id === pref.category_id

              return (
                <div key={pref.category_id} className="relative">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center">
                      <span
                        className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium"
                        style={{
                          backgroundColor: pref.event_categories.color + '20',
                          color: pref.event_categories.color
                        }}
                      >
                        {pref.event_categories.name}
                      </span>
                      {isFavorite && (
                        <span className="ml-2 text-xs text-amber-600 font-medium">
                          ⭐ Favorite
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-gray-600">
                      {pref.times_attended} events ({percentage}%)
                    </div>
                  </div>
                  
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className="h-2 rounded-full transition-all duration-300"
                      style={{
                        width: `${percentage}%`,
                        backgroundColor: pref.event_categories.color
                      }}
                    />
                  </div>

                  {pref.last_attended && (
                    <p className="mt-1 text-xs text-gray-500">
                      Last attended: {new Date(pref.last_attended).toLocaleDateString()}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {showCategoryInsights && preferences.length > 1 && favoriteCategory && (
          <div className="mt-4 pt-4 border-t border-gray-200">
            <p className="text-sm text-gray-600">
              <span className="font-medium">Tip:</span> This customer prefers{' '}
              <span 
                className="font-medium"
                style={{ color: favoriteCategory.event_categories.color }}
              >
                {favoriteCategory.event_categories.name}
              </span>
              {' '}events. Consider sending them targeted invitations for similar events.
            </p>
          </div>
        )}

        {eventSummaries.length > 0 ? (
          <div className={`${showCategoryInsights ? 'mt-6 pt-6 border-t border-gray-200' : ''}`}>
            <h4 className="text-sm font-medium text-gray-900 mb-3">
              Event Activity
            </h4>
            <div className="space-y-3">
              {eventSummaries.map((summary) => (
                <div key={summary.eventId} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {summary.name}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      {renderEventDate(summary)}
                    </p>
                    {summary.checkInTime ? (
                      <p className="text-xs text-gray-400 mt-1">
                        Checked in {formatDateTime12Hour(summary.checkInTime)}
                      </p>
                    ) : summary.bookedAt ? (
                      <p className="text-xs text-gray-400 mt-1">
                        Booked on {formatDateTime12Hour(summary.bookedAt)}
                      </p>
                    ) : null}
                    {typeof summary.seats === 'number' && summary.seats > 0 && (
                      <p className="text-xs text-gray-400 mt-1">
                        Seats: {summary.seats}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 sm:flex-col sm:items-end sm:gap-1">
                    {summary.categoryName && summary.categoryColor && (
                      <span
                        className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
                        style={{
                          backgroundColor: summary.categoryColor + '20',
                          color: summary.categoryColor
                        }}
                      >
                        {summary.categoryName}
                      </span>
                    )}
                    <Badge
                      variant={summary.status === 'checked_in' ? 'success' : 'info'}
                      size="sm"
                    >
                      {summary.status === 'checked_in' ? 'Attended' : 'Booked'}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className={`${showCategoryInsights ? 'mt-4 pt-4 border-t border-gray-200' : ''} text-sm text-gray-500`}>
            No event activity recorded yet.
          </p>
        )}
      </div>
    </div>
  )
}
