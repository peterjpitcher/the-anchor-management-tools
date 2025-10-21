'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { 
  ChevronLeftIcon, 
  ChevronRightIcon,
  ClockIcon
} from '@heroicons/react/24/outline'
import type { BookingStatus } from '@/types/private-bookings'
import { formatTime12Hour } from '@/lib/dateUtils'
import { Select } from '@/components/ui-v2/forms/Select'
import { Button } from '@/components/ui-v2/forms/Button'

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

const statusColors: Record<BookingStatus, string> = {
  draft: 'bg-gray-100 text-gray-800 border-gray-300',
  confirmed: 'bg-green-100 text-green-800 border-green-300',
  completed: 'bg-blue-100 text-blue-800 border-blue-300',
  cancelled: 'bg-red-100 text-red-800 border-red-300'
}

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
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    return bookings.filter((booking) => {
      if (statusFilter !== 'all' && booking.status !== statusFilter) {
        return false
      }

      if (timeFilter === 'all') {
        return true
      }

      const bookingDate = new Date(booking.event_date)
      bookingDate.setHours(0, 0, 0, 0)

      if (timeFilter === 'upcoming') {
        return bookingDate >= today
      }

      return bookingDate < today
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
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      {/* Calendar Header */}
      <div className="px-4 sm:px-6 py-4 border-b border-gray-200">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <h2 className="text-xl font-semibold text-gray-900">
            {currentDate.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
          </h2>
          <div className="flex flex-wrap gap-2 w-full sm:w-auto">
            {/* View Mode Toggle - Mobile Only */}
            <div className="flex bg-gray-100 rounded-lg p-1 sm:hidden">
              <button
                onClick={() => setViewMode('calendar')}
                className={`px-3 py-1 text-sm font-medium rounded ${
                  viewMode === 'calendar' ? 'bg-white text-gray-900 shadow' : 'text-gray-600'
                }`}
              >
                Calendar
              </button>
              <button
                onClick={() => setViewMode('agenda')}
                className={`px-3 py-1 text-sm font-medium rounded ${
                  viewMode === 'agenda' ? 'bg-white text-gray-900 shadow' : 'text-gray-600'
                }`}
              >
                Agenda
              </button>
            </div>
            <button
              onClick={() => setCurrentDate(new Date())}
              className="px-3 sm:px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Today
            </button>
            <div className="flex">
              <button
                onClick={() => navigateMonth('prev')}
                className="p-2 text-gray-600 hover:bg-gray-100 rounded-l-lg border border-r-0 border-gray-300 transition-colors"
              >
                <ChevronLeftIcon className="h-5 w-5" />
              </button>
              <button
                onClick={() => navigateMonth('next')}
                className="p-2 text-gray-600 hover:bg-gray-100 rounded-r-lg border border-gray-300 transition-colors"
              >
                <ChevronRightIcon className="h-5 w-5" />
              </button>
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Status</label>
            <Select
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
            <label className="mb-1 block text-sm font-medium text-gray-700">Date range</label>
            <Select
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
          <div className="hidden sm:grid grid-cols-7 bg-gray-50 border-b border-gray-200">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
              <div key={day} className="px-2 py-3 text-center text-sm font-medium text-gray-700">
                {day}
              </div>
            ))}
          </div>
          <div className="grid sm:hidden grid-cols-7 bg-gray-50 border-b border-gray-200">
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => (
              <div key={index} className="py-2 text-center text-xs font-medium text-gray-700">
                {day}
              </div>
            ))}
          </div>
          
          {/* Calendar Grid */}
          <div className="grid grid-cols-7 divide-x divide-y divide-gray-200">
        {calendarDays.map((day, index) => (
          <div
            key={index}
            className={`min-h-[80px] sm:min-h-[120px] p-1 sm:p-2 ${
              day === null ? 'bg-gray-50' : 'bg-white hover:bg-gray-50'
            } ${isToday(day || 0) ? 'bg-blue-50' : ''}`}
          >
            {day && (
              <>
                <div className={`text-sm font-medium mb-1 ${
                  isToday(day) ? 'text-blue-600' : 'text-gray-900'
                }`}>
                  {day}
                </div>
                <div className="space-y-1">
                  {/* Show fewer bookings on mobile */}
                  {bookingsByDate[getDateString(day)]?.slice(0, isMobile ? 1 : 3).map((booking) => (
                    <Link
                      key={booking.id}
                      href={`/private-bookings/${booking.id}`}
                      className={`block px-1 sm:px-2 py-0.5 sm:py-1 text-xs rounded border ${
                        statusColors[booking.status]
                      } hover:opacity-80 transition-opacity`}
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
                    <div className="text-xs text-gray-500 px-1 sm:px-2">
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
        <div className="divide-y divide-gray-200">
          {monthBookings.length === 0 ? (
            <div className="px-4 py-8 text-center text-gray-500">
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
                  className={`block px-4 py-4 hover:bg-gray-50 ${isToday ? 'bg-blue-50' : ''}`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${statusColors[booking.status]}`}>
                          {booking.status}
                        </span>
                        {isToday && (
                          <span className="text-xs font-medium text-blue-600">Today</span>
                        )}
                      </div>
                      <h3 className="font-medium text-gray-900">{booking.customer_name}</h3>
                      {booking.event_type && (
                        <p className="text-sm text-gray-600 mt-0.5">{booking.event_type}</p>
                      )}
                      <div className="flex items-center gap-4 mt-2 text-sm text-gray-500">
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
                    <ChevronRightIcon className="h-5 w-5 text-gray-400 flex-shrink-0 ml-2" />
                  </div>
                </Link>
              )
            })
          )}
        </div>
      )}
      
      {/* Legend - Show only in calendar view */}
      {(viewMode === 'calendar' || !isMobile) && (
        <div className="px-4 sm:px-6 py-4 bg-gray-50 border-t border-gray-200">
        <div className="flex flex-wrap gap-4 text-sm">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-gray-200 border border-gray-300"></div>
            <span className="text-gray-600">Draft</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-amber-200 border border-amber-300"></div>
            <span className="text-gray-600">Tentative</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-green-200 border border-green-300"></div>
            <span className="text-gray-600">Confirmed</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-blue-200 border border-blue-300"></div>
            <span className="text-gray-600">Completed</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-red-200 border border-red-300"></div>
            <span className="text-gray-600">Cancelled</span>
          </div>
        </div>
        </div>
      )}
    </div>
  )
}
