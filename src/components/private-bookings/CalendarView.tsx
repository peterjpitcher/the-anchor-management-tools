'use client'

import { useState } from 'react'
import Link from 'next/link'
import { 
  ChevronLeftIcon, 
  ChevronRightIcon,
  ClockIcon
} from '@heroicons/react/24/outline'
import type { BookingStatus } from '@/types/private-bookings'
import { formatTime12Hour } from '@/lib/dateUtils'

interface CalendarBooking {
  id: string
  customer_name: string
  event_date: string
  start_time: string
  end_time: string | null
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
  const bookingsByDate = bookings.reduce((acc, booking) => {
    const date = booking.event_date
    if (!acc[date]) {
      acc[date] = []
    }
    acc[date].push(booking)
    return acc
  }, {} as Record<string, CalendarBooking[]>)
  
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

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      {/* Calendar Header */}
      <div className="px-6 py-4 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold text-gray-900">
            {currentDate.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
          </h2>
          <div className="flex gap-2">
            <button
              onClick={() => setCurrentDate(new Date())}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Today
            </button>
            <button
              onClick={() => navigateMonth('prev')}
              className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <ChevronLeftIcon className="h-5 w-5" />
            </button>
            <button
              onClick={() => navigateMonth('next')}
              className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <ChevronRightIcon className="h-5 w-5" />
            </button>
          </div>
        </div>
      </div>
      
      {/* Days of Week Header */}
      <div className="grid grid-cols-7 bg-gray-50 border-b border-gray-200">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
          <div key={day} className="px-2 py-3 text-center text-sm font-medium text-gray-700">
            {day}
          </div>
        ))}
      </div>
      
      {/* Calendar Grid */}
      <div className="grid grid-cols-7 divide-x divide-y divide-gray-200">
        {calendarDays.map((day, index) => (
          <div
            key={index}
            className={`min-h-[120px] p-2 ${
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
                  {bookingsByDate[getDateString(day)]?.slice(0, 3).map((booking) => (
                    <Link
                      key={booking.id}
                      href={`/private-bookings/${booking.id}`}
                      className={`block px-2 py-1 text-xs rounded border ${
                        statusColors[booking.status]
                      } hover:opacity-80 transition-opacity`}
                    >
                      <div className="font-medium truncate">{booking.customer_name}</div>
                      <div className="flex items-center gap-1 mt-0.5">
                        <ClockIcon className="h-3 w-3" />
                        {formatTime12Hour(booking.start_time)}
                      </div>
                    </Link>
                  ))}
                  {bookingsByDate[getDateString(day)]?.length > 3 && (
                    <div className="text-xs text-gray-500 px-2">
                      +{bookingsByDate[getDateString(day)].length - 3} more
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        ))}
      </div>
      
      {/* Legend */}
      <div className="px-6 py-4 bg-gray-50 border-t border-gray-200">
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
    </div>
  )
}