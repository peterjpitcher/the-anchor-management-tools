'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { 
  ChevronLeftIcon, 
  ChevronRightIcon,
  ClockIcon
} from '@heroicons/react/24/outline'
import type { BookingStatus } from '@/types/private-bookings'
import { formatTime12Hour, getTodayIsoDate } from '@/lib/dateUtils'
import { Badge, Button, Card, IconButton, Segmented, Select } from '@/ds'
import {
  privateBookingStatusBlockClasses,
  privateBookingStatusLabel,
  privateBookingStatusTone,
} from '@/app/(authenticated)/private-bookings/_shared/status-ui'

interface CalendarBooking {
  id: string
  customer_name: string
  event_date: string
  start_time: string
  end_time: string | null
  end_time_next_day: boolean | null
  status: BookingStatus
  event_type: string | null
  guest_count: number | null
}

interface CalendarViewProps {
  bookings: CalendarBooking[]
}

// Tentative is left out: no live booking has it (checked 18 Sep 2026).
const LEGEND_STATUSES = ['draft', 'confirmed', 'completed', 'cancelled'] as const

export default function CalendarView({ bookings }: CalendarViewProps) {
  const [currentDate, setCurrentDate] = useState(new Date())
  const [viewMode, setViewMode] = useState<'calendar' | 'agenda'>('calendar')
  const [isMobile, setIsMobile] = useState(false)
  const [statusFilter, setStatusFilter] = useState<BookingStatus | 'all'>('all')
  const [timeFilter, setTimeFilter] = useState<'all' | 'upcoming' | 'past'>('all')
  
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 640)
    }
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  // On first mount, default mobile users to the agenda (list) view — the month
  // grid's day-cell booking pills are too small to tap reliably at phone widths.
  // Runs once; the user can still switch back to the calendar view.
  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 640) {
      setViewMode('agenda')
    }
  }, [])

  // Get the first day of the month
  const firstDayOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1)
  const lastDayOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0)
  
  // Get the starting day of the week (0 = Sunday, 6 = Saturday)
  const startingDayOfWeek = firstDayOfMonth.getDay()
  
  // Get total days in month
  const daysInMonth = lastDayOfMonth.getDate()
  
  // Create array of days for the calendar
  const calendarDays = []
  
  // Add empty cells for days before the first day of the month
  for (let i = 0; i < startingDayOfWeek; i++) {
    calendarDays.push(null)
  }
  
  // Add all days of the month
  for (let i = 1; i <= daysInMonth; i++) {
    calendarDays.push(i)
  }
  
  // Group bookings by date
  const filteredBookings = useMemo(() => {
    // Compare plain YYYY-MM-DD strings against today's London date so the
    // upcoming/past split never shifts with the viewer's machine timezone.
    const todayIso = getTodayIsoDate()

    return bookings.filter((booking) => {
      if (statusFilter !== 'all' && booking.status !== statusFilter) {
        return false
      }

      if (timeFilter === 'all') {
        return true
      }

      if (timeFilter === 'upcoming') {
        return booking.event_date >= todayIso
      }

      return booking.event_date < todayIso
    })
  }, [bookings, statusFilter, timeFilter])

  const bookingsByDate = useMemo(() => {
    return filteredBookings.reduce((acc, booking) => {
      const date = booking.event_date
      if (!acc[date]) {
        acc[date] = []
      }
      acc[date].push(booking)
      return acc
    }, {} as Record<string, CalendarBooking[]>)
  }, [filteredBookings])
  
  const navigateMonth = (direction: 'prev' | 'next') => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + (direction === 'next' ? 1 : -1), 1))
  }
  
  
  const isToday = (day: number) => {
    const today = new Date()
    return (
      day === today.getDate() &&
      currentDate.getMonth() === today.getMonth() &&
      currentDate.getFullYear() === today.getFullYear()
    )
  }
  
  const getDateString = (day: number) => {
    const year = currentDate.getFullYear()
    const month = String(currentDate.getMonth() + 1).padStart(2, '0')
    const dayStr = String(day).padStart(2, '0')
    return `${year}-${month}-${dayStr}`
  }

  // Get bookings for current month in agenda view
  const monthBookings = filteredBookings.filter(booking => {
    const bookingDate = new Date(booking.event_date)
    return bookingDate.getMonth() === currentDate.getMonth() && 
           bookingDate.getFullYear() === currentDate.getFullYear()
  }).sort((a, b) => new Date(a.event_date).getTime() - new Date(b.event_date).getTime())

  const handleResetFilters = () => {
    setStatusFilter('all')
    setTimeFilter('all')
  }

  return (
    <Card padding="none">
      {/* Calendar Header */}
      <div className="px-4 sm:px-6 py-4 border-b border-border">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <h2 className="text-xl font-semibold text-text-strong">
            {currentDate.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
          </h2>
          <div className="flex flex-wrap gap-2 w-full sm:w-auto">
            {/* View Mode Toggle - Mobile Only */}
            <Segmented
              className="sm:hidden"
              options={[
                { id: 'calendar', label: 'Calendar' },
                { id: 'agenda', label: 'Agenda' },
              ]}
              value={viewMode}
              onChange={(id) => setViewMode(id as 'calendar' | 'agenda')}
            />
            <Button type="button" variant="secondary" onClick={() => setCurrentDate(new Date())}>
              Today
            </Button>
            <div className="flex gap-1">
              <IconButton
                type="button"
                variant="secondary"
                label="Previous month"
                icon={<ChevronLeftIcon className="h-4 w-4" />}
                onClick={() => navigateMonth('prev')}
              />
              <IconButton
                type="button"
                variant="secondary"
                label="Next month"
                icon={<ChevronRightIcon className="h-4 w-4" />}
                onClick={() => navigateMonth('next')}
              />
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <Select
              label="Status"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as BookingStatus | 'all')}
            >
              <option value="all">All statuses</option>
              <option value="draft">Draft</option>
              <option value="confirmed">Confirmed</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </Select>
          </div>
          <div>
            <Select
              label="Date range"
              value={timeFilter}
              onChange={(event) => setTimeFilter(event.target.value as 'all' | 'upcoming' | 'past')}
            >
              <option value="all">All dates</option>
              <option value="upcoming">Upcoming</option>
              <option value="past">Past</option>
            </Select>
          </div>
          <div className="flex items-end">
            <Button onClick={handleResetFilters} variant="secondary" size="sm" className="w-full sm:w-auto">
              Reset filters
            </Button>
          </div>
        </div>
      </div>
      
      {/* Show Calendar View on Desktop, Selected View on Mobile */}
      {(viewMode === 'calendar' || !isMobile) ? (
        <>
          {/* Days of Week Header */}
          <div className="hidden sm:grid grid-cols-7 bg-surface-2 border-b border-border">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
              <div key={day} className="px-2 py-3 text-center text-sm font-medium text-text">
                {day}
              </div>
            ))}
          </div>
          <div className="grid sm:hidden grid-cols-7 bg-surface-2 border-b border-border">
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => (
              <div key={index} className="py-2 text-center text-xs font-medium text-text">
                {day}
              </div>
            ))}
          </div>
          
          {/* Calendar Grid */}
          <div className="grid grid-cols-7 divide-x divide-y divide-border">
        {calendarDays.map((day, index) => (
          <div
            key={index}
            className={`min-h-[80px] sm:min-h-[120px] p-1 sm:p-2 ${
              day === null
                ? 'bg-surface-2'
                : 'bg-surface hover:bg-surface-hover'
            }`}
          >
            {day && (
              <>
                {/* Today is a filled date, not a filled cell, so it never hides a confirmed block. */}
                <div className={`mb-1 text-sm font-medium ${
                  isToday(day)
                    ? 'inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-primary px-1 text-primary-fg'
                    : 'text-text'
                }`}>
                  {day}
                </div>
                <div className="space-y-1">
                  {/* Show fewer bookings on mobile */}
                  {bookingsByDate[getDateString(day)]?.slice(0, isMobile ? 1 : 3).map((booking) => (
                    <Link
                      key={booking.id}
                      href={`/private-bookings/${booking.id}`}
                      className={`block px-1 sm:px-2 py-0.5 sm:py-1 text-xs rounded-sm border ${
                        privateBookingStatusBlockClasses(booking.status)
                      } hover:opacity-80 transition-opacity focus-visible:outline-hidden focus-visible:shadow-ring`}
                    >
                      <div className="font-medium truncate hidden sm:block">{booking.customer_name}</div>
                      <div className="flex items-center gap-1 sm:mt-0.5">
                        <ClockIcon className="h-3 w-3 hidden sm:block" />
                        <span className="sm:hidden">{formatTime12Hour(booking.start_time).replace(':00', '')}</span>
                        <span className="hidden sm:inline">{formatTime12Hour(booking.start_time)}</span>
                      </div>
                    </Link>
                  ))}
                  {bookingsByDate[getDateString(day)]?.length > (isMobile ? 1 : 3) && (
                    <div className="text-xs text-text-muted px-1 sm:px-2">
                      +{bookingsByDate[getDateString(day)].length - (isMobile ? 1 : 3)} more
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        ))}
          </div>
        </>
      ) : (
        /* Agenda View - Mobile Only */
        <div className="divide-y divide-border">
          {monthBookings.length === 0 ? (
            <div className="px-4 py-8 text-center text-text-muted">
              No bookings for this month
            </div>
          ) : (
            monthBookings.map((booking) => {
              const bookingDate = new Date(booking.event_date)
              const isToday = bookingDate.toDateString() === new Date().toDateString()
              
              return (
                <Link
                  key={booking.id}
                  href={`/private-bookings/${booking.id}`}
                  className={`block px-4 py-4 hover:bg-surface-hover focus-visible:outline-hidden focus-visible:shadow-ring-inset ${isToday ? 'bg-primary-soft' : ''}`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge tone={privateBookingStatusTone(booking.status)} size="sm">
                          {privateBookingStatusLabel(booking.status)}
                        </Badge>
                        {isToday && (
                          <span className="text-xs font-medium text-primary">Today</span>
                        )}
                      </div>
                      <h3 className="font-medium text-text">{booking.customer_name}</h3>
                      {booking.event_type && (
                        <p className="text-sm text-text-muted mt-0.5">{booking.event_type}</p>
                      )}
                      <div className="flex items-center gap-4 mt-2 text-sm text-text-muted">
                        <span>
                          {bookingDate.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
                        </span>
                        <span className="flex items-center gap-1">
                          <ClockIcon className="h-4 w-4" />
                          {formatTime12Hour(booking.start_time)}
                          {booking.end_time && (
                            <>
                              {' - '}
                              {formatTime12Hour(booking.end_time)}
                              {booking.end_time_next_day ? ' (+1 day)' : ''}
                            </>
                          )}
                        </span>
                        {booking.guest_count && (
                          <span>{booking.guest_count} guests</span>
                        )}
                      </div>
                    </div>
                    <ChevronRightIcon className="h-5 w-5 text-text-subtle flex-shrink-0 ml-2" />
                  </div>
                </Link>
              )
            })
          )}
        </div>
      )}
      
      {/* Legend - Show only in calendar view */}
      {(viewMode === 'calendar' || !isMobile) && (
        <div className="px-4 sm:px-6 py-4 bg-surface-2 border-t border-border">
        <div className="flex flex-wrap gap-4 text-sm">
          {LEGEND_STATUSES.map((status) => (
            <div key={status} className="flex items-center gap-2">
              {/* Same classes as the day-cell blocks, so the key matches what it explains. */}
              <div className={`w-3 h-3 rounded-sm border ${privateBookingStatusBlockClasses(status)}`}></div>
              <span className={status === 'cancelled' ? 'text-text-muted line-through' : 'text-text-muted'}>
                {privateBookingStatusLabel(status)}
              </span>
            </div>
          ))}
        </div>
        </div>
      )}
    </Card>
  )
}
