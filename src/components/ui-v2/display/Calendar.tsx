'use client'

/**
 * Calendar Component
 * 
 * Used on 12/107 pages (11%)
 * 
 * Full-featured calendar for date selection, event display, and scheduling.
 * Supports month/week/day views, event rendering, and date range selection.
 */

import { useState, useMemo, ReactNode } from 'react'
import { 
  format, 
  startOfMonth, 
  endOfMonth, 
  startOfWeek, 
  endOfWeek,
  addDays, 
  addMonths, 
  subMonths,
  isSameMonth,
  isSameDay,
  isToday,
  isBefore,
  isAfter,
  startOfDay,
  addWeeks,
  subWeeks,
  getDay,
  setHours,
  setMinutes
} from 'date-fns'
import { cn } from '@/lib/utils'
import { 
  ChevronLeftIcon, 
  ChevronRightIcon,
  CalendarIcon,
  ClockIcon,
  UserGroupIcon,
  MapPinIcon
} from '@heroicons/react/20/solid'
import { Button } from '../forms/Button'
import { Select } from '../forms/Select'
import { Badge } from './Badge'
import { Tooltip } from '../overlay/Tooltip'

export interface CalendarEvent {
  id: string
  title: string
  start: Date
  end: Date
  allDay?: boolean
  color?: string
  textColor?: string
  description?: string
  location?: string
  attendees?: number
  recurring?: boolean
  editable?: boolean
  deletable?: boolean
}

export interface CalendarProps {
  /**
   * Current date
   */
  value?: Date
  
  /**
   * Callback when date changes
   */
  onChange?: (date: Date) => void
  
  /**
   * Events to display
   */
  events?: CalendarEvent[]
  
  /**
   * Calendar view mode
   * @default 'month'
   */
  view?: 'month' | 'week' | 'day'
  
  /**
   * Callback when view changes
   */
  onViewChange?: (view: 'month' | 'week' | 'day') => void
  
  /**
   * Whether to show week numbers
   * @default false
   */
  showWeekNumbers?: boolean
  
  /**
   * First day of week (0 = Sunday, 1 = Monday)
   * @default 0
   */
  firstDayOfWeek?: 0 | 1 | 2 | 3 | 4 | 5 | 6
  
  /**
   * Minimum selectable date
   */
  minDate?: Date
  
  /**
   * Maximum selectable date
   */
  maxDate?: Date
  
  /**
   * Disabled dates
   */
  disabledDates?: Date[]
  
  /**
   * Function to determine if a date is disabled
   */
  isDateDisabled?: (date: Date) => boolean
  
  /**
   * Whether to allow selecting dates
   * @default true
   */
  selectable?: boolean
  
  /**
   * Whether to show event time
   * @default true
   */
  showEventTime?: boolean
  
  /**
   * Callback when an event is clicked
   */
  onEventClick?: (event: CalendarEvent) => void
  
  /**
   * Callback when empty space is clicked
   */
  onDateClick?: (date: Date) => void
  
  /**
   * Custom event renderer
   */
  renderEvent?: (event: CalendarEvent) => ReactNode
  
  /**
   * Whether to show navigation
   * @default true
   */
  showNavigation?: boolean
  
  /**
   * Whether to show today button
   * @default true
   */
  showTodayButton?: boolean
  
  /**
   * Whether to show view selector
   * @default true
   */
  showViewSelector?: boolean
  
  /**
   * Height of the calendar
   * @default 'auto'
   */
  height?: string | number
  
  /**
   * Additional classes
   */
  className?: string
  
  /**
   * Locale for date formatting
   * @default 'en-US'
   */
  locale?: string
}

export function Calendar({
  value,
  onChange,
  events = [],
  view = 'month',
  onViewChange,
  showWeekNumbers = false,
  firstDayOfWeek = 0,
  minDate,
  maxDate,
  disabledDates = [],
  isDateDisabled,
  selectable = true,
  showEventTime = true,
  onEventClick,
  onDateClick,
  renderEvent,
  showNavigation = true,
  showTodayButton = true,
  showViewSelector = true,
  height = 'auto',
  className,
  locale = 'en-US',
}: CalendarProps) {
  const [currentDate, setCurrentDate] = useState(value || new Date())
  const [hoveredDate, setHoveredDate] = useState<Date | null>(null)
  
  // Navigation handlers
  const goToPrevious = () => {
    if (view === 'month') {
      setCurrentDate(subMonths(currentDate, 1))
    } else if (view === 'week') {
      setCurrentDate(subWeeks(currentDate, 1))
    } else {
      setCurrentDate(addDays(currentDate, -1))
    }
  }
  
  const goToNext = () => {
    if (view === 'month') {
      setCurrentDate(addMonths(currentDate, 1))
    } else if (view === 'week') {
      setCurrentDate(addWeeks(currentDate, 1))
    } else {
      setCurrentDate(addDays(currentDate, 1))
    }
  }
  
  const goToToday = () => {
    setCurrentDate(new Date())
  }
  
  // Check if date is disabled
  const isDisabled = (date: Date) => {
    if (minDate && isBefore(date, startOfDay(minDate))) return true
    if (maxDate && isAfter(date, startOfDay(maxDate))) return true
    if (disabledDates.some(d => isSameDay(d, date))) return true
    if (isDateDisabled?.(date)) return true
    return false
  }
  
  // Get events for a specific date
  const getEventsForDate = (date: Date) => {
    return events.filter(event => {
      const eventStart = startOfDay(event.start)
      const eventEnd = startOfDay(event.end)
      const currentDay = startOfDay(date)
      
      if (event.allDay) {
        return currentDay >= eventStart && currentDay <= eventEnd
      }
      
      return isSameDay(event.start, date) || 
             (currentDay >= eventStart && currentDay <= eventEnd)
    })
  }
  
  // Generate calendar days for month view
  const generateMonthDays = () => {
    const monthStart = startOfMonth(currentDate)
    const monthEnd = endOfMonth(monthStart)
    const startDate = startOfWeek(monthStart, { weekStartsOn: firstDayOfWeek })
    const endDate = endOfWeek(monthEnd, { weekStartsOn: firstDayOfWeek })
    
    const days: Date[] = []
    let day = startDate
    
    while (day <= endDate) {
      days.push(day)
      day = addDays(day, 1)
    }
    
    return days
  }
  
  // Generate week days
  const generateWeekDays = () => {
    const weekStart = startOfWeek(currentDate, { weekStartsOn: firstDayOfWeek })
    const days: Date[] = []
    
    for (let i = 0; i < 7; i++) {
      days.push(addDays(weekStart, i))
    }
    
    return days
  }
  
  // Generate day hours
  const generateDayHours = () => {
    const hours: Date[] = []
    const dayStart = startOfDay(currentDate)
    
    for (let i = 0; i < 24; i++) {
      hours.push(setHours(dayStart, i))
    }
    
    return hours
  }
  
  // Get week day names
  const weekDayNames = useMemo(() => {
    const days: string[] = []
    const weekStart = startOfWeek(new Date(), { weekStartsOn: firstDayOfWeek })
    
    for (let i = 0; i < 7; i++) {
      days.push(format(addDays(weekStart, i), 'EEE'))
    }
    
    return days
  }, [firstDayOfWeek])
  
  // Handle date selection
  const handleDateClick = (date: Date) => {
    if (!isDisabled(date) && selectable) {
      onChange?.(date)
      onDateClick?.(date)
    }
  }
  
  // Render month view
  const renderMonthView = () => {
    const days = generateMonthDays()
    const weeks: Date[][] = []
    
    for (let i = 0; i < days.length; i += 7) {
      weeks.push(days.slice(i, i + 7))
    }
    
    return (
      <div className="flex-1">
        {/* Week day headers */}
        <div className="grid grid-cols-7 gap-px bg-gray-200 rounded-t-lg overflow-hidden">
          {weekDayNames.map((day, index) => (
            <div
              key={index}
              className="bg-gray-50 py-2 text-center text-xs font-medium text-gray-900"
            >
              {day}
            </div>
          ))}
        </div>
        
        {/* Calendar grid */}
        <div className="grid grid-cols-7 gap-px bg-gray-200 rounded-b-lg overflow-hidden">
          {days.map((day, index) => {
            const dayEvents = getEventsForDate(day)
            const isCurrentMonth = isSameMonth(day, currentDate)
            const isSelected = value && isSameDay(day, value)
            const isHovered = hoveredDate && isSameDay(day, hoveredDate)
            const disabled = isDisabled(day)
            
            return (
              <div
                key={index}
                className={cn(
                  'min-h-[100px] bg-white p-2 relative',
                  'hover:bg-gray-50 cursor-pointer transition-colors',
                  !isCurrentMonth && 'bg-gray-50 text-gray-400',
                  isSelected && 'bg-green-50 hover:bg-green-100',
                  isToday(day) && 'font-semibold',
                  disabled && 'cursor-not-allowed opacity-50 hover:bg-white',
                  isHovered && !disabled && 'bg-gray-100'
                )}
                onClick={() => handleDateClick(day)}
                onMouseEnter={() => setHoveredDate(day)}
                onMouseLeave={() => setHoveredDate(null)}
              >
                <div className="flex items-start justify-between mb-1">
                  <span className={cn(
                    'text-sm',
                    isToday(day) && 'bg-green-600 text-white px-2 py-0.5 rounded-full'
                  )}>
                    {format(day, 'd')}
                  </span>
                  {dayEvents.length > 0 && (
                    <Badge size="sm" variant="secondary">
                      {dayEvents.length}
                    </Badge>
                  )}
                </div>
                
                {/* Events */}
                <div className="space-y-1">
                  {dayEvents.slice(0, 3).map((event) => (
                    <div
                      key={event.id}
                      onClick={(e) => {
                        e.stopPropagation()
                        onEventClick?.(event)
                      }}
                      className={cn(
                        'text-xs p-1 rounded truncate cursor-pointer',
                        'hover:opacity-80 transition-opacity'
                      )}
                      style={{
                        backgroundColor: event.color || '#10b981',
                        color: event.textColor || 'white'
                      }}
                    >
                      {showEventTime && !event.allDay && (
                        <span className="font-medium">
                          {format(event.start, 'HH:mm')}
                        </span>
                      )}
                      {' '}
                      {event.title}
                    </div>
                  ))}
                  {dayEvents.length > 3 && (
                    <div className="text-xs text-gray-500 text-center">
                      +{dayEvents.length - 3} more
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }
  
  // Render week view
  const renderWeekView = () => {
    const days = generateWeekDays()
    const hours = Array.from({ length: 24 }, (_, i) => i)
    
    return (
      <div className="flex-1 overflow-auto">
        <div className="min-w-[700px]">
          {/* Time column and day headers */}
          <div className="grid grid-cols-8 gap-px bg-gray-200">
            <div className="bg-gray-50 p-2">{/* Empty corner */}</div>
            {days.map((day, index) => (
              <div
                key={index}
                className={cn(
                  'bg-gray-50 p-2 text-center',
                  isToday(day) && 'bg-green-50'
                )}
              >
                <div className="text-xs font-medium text-gray-900">
                  {format(day, 'EEE')}
                </div>
                <div className={cn(
                  'text-lg',
                  isToday(day) && 'font-bold text-green-600'
                )}>
                  {format(day, 'd')}
                </div>
              </div>
            ))}
          </div>
          
          {/* Hour rows */}
          <div className="grid grid-cols-8 gap-px bg-gray-200">
            {hours.map((hour) => (
              <>
                <div key={`time-${hour}`} className="bg-gray-50 p-2 text-xs text-gray-500">
                  {format(setHours(new Date(), hour), 'HH:mm')}
                </div>
                {days.map((day, dayIndex) => {
                  const hourDate = setHours(setMinutes(day, 0), hour)
                  const hourEvents = events.filter(event => {
                    const eventHour = event.start.getHours()
                    return isSameDay(event.start, day) && eventHour === hour
                  })
                  
                  return (
                    <div
                      key={`${dayIndex}-${hour}`}
                      className="bg-white p-1 min-h-[60px] relative hover:bg-gray-50 cursor-pointer"
                      onClick={() => onDateClick?.(hourDate)}
                    >
                      {hourEvents.map((event) => (
                        <div
                          key={event.id}
                          onClick={(e) => {
                            e.stopPropagation()
                            onEventClick?.(event)
                          }}
                          className="absolute inset-x-1 p-1 rounded text-xs cursor-pointer hover:opacity-80"
                          style={{
                            backgroundColor: event.color || '#10b981',
                            color: event.textColor || 'white',
                            top: `${(event.start.getMinutes() / 60) * 100}%`,
                            height: `${((event.end.getTime() - event.start.getTime()) / (1000 * 60 * 60)) * 60}px`
                          }}
                        >
                          {event.title}
                        </div>
                      ))}
                    </div>
                  )
                })}
              </>
            ))}
          </div>
        </div>
      </div>
    )
  }
  
  // Render day view
  const renderDayView = () => {
    const hours = generateDayHours()
    
    return (
      <div className="flex-1 overflow-auto">
        <div className="min-w-[400px]">
          {/* Day header */}
          <div className={cn(
            'bg-gray-50 p-4 text-center border-b',
            isToday(currentDate) && 'bg-green-50'
          )}>
            <div className="text-sm font-medium text-gray-900">
              {format(currentDate, 'EEEE')}
            </div>
            <div className={cn(
              'text-2xl',
              isToday(currentDate) && 'font-bold text-green-600'
            )}>
              {format(currentDate, 'MMMM d, yyyy')}
            </div>
          </div>
          
          {/* Hours */}
          <div className="divide-y">
            {hours.map((hour) => {
              const hourEvents = events.filter(event => {
                return isSameDay(event.start, currentDate) && 
                       event.start.getHours() === hour.getHours()
              })
              
              return (
                <div
                  key={hour.getTime()}
                  className="flex gap-4 p-2 hover:bg-gray-50 cursor-pointer"
                  onClick={() => onDateClick?.(hour)}
                >
                  <div className="w-16 text-xs text-gray-500 text-right">
                    {format(hour, 'HH:mm')}
                  </div>
                  <div className="flex-1 min-h-[60px] space-y-1">
                    {hourEvents.map((event) => (
                      <div
                        key={event.id}
                        onClick={(e) => {
                          e.stopPropagation()
                          onEventClick?.(event)
                        }}
                        className="p-2 rounded cursor-pointer hover:opacity-80"
                        style={{
                          backgroundColor: event.color || '#10b981',
                          color: event.textColor || 'white'
                        }}
                      >
                        <div className="font-medium text-sm">{event.title}</div>
                        {event.location && (
                          <div className="flex items-center gap-1 text-xs mt-1">
                            <MapPinIcon className="h-3 w-3" />
                            {event.location}
                          </div>
                        )}
                        {event.attendees && (
                          <div className="flex items-center gap-1 text-xs mt-1">
                            <UserGroupIcon className="h-3 w-3" />
                            {event.attendees} attendees
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    )
  }
  
  return (
    <div className={cn('flex flex-col bg-white rounded-lg border', className)} style={{ height }}>
      {/* Navigation */}
      {showNavigation && (
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-2">
            <Button variant="secondary"
              size="sm"
              onClick={goToPrevious}
              iconOnly
              leftIcon={<ChevronLeftIcon />}
            />
            <Button variant="secondary"
              size="sm"
              onClick={goToNext}
              iconOnly
              leftIcon={<ChevronRightIcon />}
            />
            {showTodayButton && (
              <Button
                variant="secondary"
                size="sm"
                onClick={goToToday}
              >
                Today
              </Button>
            )}
          </div>
          
          <h2 className="text-lg font-semibold">
            {view === 'month' && format(currentDate, 'MMMM yyyy')}
            {view === 'week' && `Week of ${format(startOfWeek(currentDate, { weekStartsOn: firstDayOfWeek }), 'MMM d, yyyy')}`}
            {view === 'day' && format(currentDate, 'MMMM d, yyyy')}
          </h2>
          
          {showViewSelector && (
            <Select
              value={view}
              onChange={(e) => onViewChange?.(e.target.value as any)}
              selectSize="sm"
              className="w-24"
            >
              <option value="month">Month</option>
              <option value="week">Week</option>
              <option value="day">Day</option>
            </Select>
          )}
        </div>
      )}
      
      {/* Calendar content */}
      {view === 'month' && renderMonthView()}
      {view === 'week' && renderWeekView()}
      {view === 'day' && renderDayView()}
    </div>
  )
}

/**
 * MiniCalendar - Compact calendar for date picking
 */
export function MiniCalendar({
  value,
  onChange,
  minDate,
  maxDate,
  className,
}: Pick<CalendarProps, 'value' | 'onChange' | 'minDate' | 'maxDate' | 'className'>) {
  return (
    <Calendar
      value={value}
      onChange={onChange}
      minDate={minDate}
      maxDate={maxDate}
      view="month"
      showNavigation={true}
      showTodayButton={false}
      showViewSelector={false}
      className={cn('max-w-sm', className)}
    />
  )
}

/**
 * EventCalendar - Calendar optimized for event display
 */
export function EventCalendar(props: CalendarProps) {
  return (
    <Calendar
      {...props}
      selectable={false}
      showEventTime={true}
    />
  )
}