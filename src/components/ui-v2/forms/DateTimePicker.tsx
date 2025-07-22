'use client'

/**
 * DateTimePicker Component
 * 
 * Used on 45/107 pages (42%)
 * 
 * Comprehensive date and time selection with calendar UI, time slots, and timezone support.
 * Critical for booking, scheduling, and event management features.
 */

import { useState, useRef, useEffect, forwardRef } from 'react'
import { format, parse, isValid, startOfDay, addDays, isBefore, isAfter, isSameDay } from 'date-fns'
import { cn } from '@/lib/utils'
import { CalendarIcon, ClockIcon, ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/20/solid'
import { Input } from './Input'
import { Popover } from '../overlay/Popover'

export interface DateTimePickerProps {
  /**
   * Selected date/time value
   */
  value?: Date | null
  
  /**
   * Callback when date/time changes
   */
  onChange: (date: Date | null) => void
  
  /**
   * Mode of the picker
   * @default 'date'
   */
  mode?: 'date' | 'time' | 'datetime'
  
  /**
   * Date format string (using date-fns format)
   * @default 'MM/dd/yyyy'
   */
  dateFormat?: string
  
  /**
   * Time format string
   * @default 'HH:mm'
   */
  timeFormat?: string
  
  /**
   * Placeholder text
   */
  placeholder?: string
  
  /**
   * Minimum allowed date
   */
  minDate?: Date
  
  /**
   * Maximum allowed date
   */
  maxDate?: Date
  
  /**
   * Dates that should be disabled
   */
  disabledDates?: Date[]
  
  /**
   * Function to determine if a date should be disabled
   */
  isDateDisabled?: (date: Date) => boolean
  
  /**
   * Available time slots (for time/datetime modes)
   */
  timeSlots?: string[]
  
  /**
   * Time interval in minutes (generates slots)
   * @default 30
   */
  timeInterval?: number
  
  /**
   * Whether the picker is disabled
   * @default false
   */
  disabled?: boolean
  
  /**
   * Whether the picker has an error
   * @default false
   */
  error?: boolean
  
  /**
   * Size of the picker
   * @default 'md'
   */
  size?: 'sm' | 'md' | 'lg'
  
  /**
   * Whether to show clear button
   * @default true
   */
  clearable?: boolean
  
  /**
   * Custom class names
   */
  className?: string
  
  /**
   * Input props
   */
  inputProps?: Partial<React.ComponentProps<typeof Input>>
}

export const DateTimePicker = forwardRef<HTMLInputElement, DateTimePickerProps>(({
  value,
  onChange,
  mode = 'date',
  dateFormat = 'MM/dd/yyyy',
  timeFormat = 'HH:mm',
  placeholder,
  minDate,
  maxDate,
  disabledDates = [],
  isDateDisabled,
  timeSlots,
  timeInterval = 30,
  disabled = false,
  error = false,
  size = 'md',
  clearable = true,
  className,
  inputProps,
}, ref) => {
  const [isOpen, setIsOpen] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const [currentMonth, setCurrentMonth] = useState(value || new Date())
  const [selectedTime, setSelectedTime] = useState<string>('')
  
  // Format value for display
  useEffect(() => {
    if (value) {
      if (mode === 'date') {
        setInputValue(format(value, dateFormat))
      } else if (mode === 'time') {
        setInputValue(format(value, timeFormat))
        setSelectedTime(format(value, 'HH:mm'))
      } else {
        setInputValue(format(value, `${dateFormat} ${timeFormat}`))
        setSelectedTime(format(value, 'HH:mm'))
      }
    } else {
      setInputValue('')
      setSelectedTime('')
    }
  }, [value, mode, dateFormat, timeFormat])
  
  // Generate time slots
  const generateTimeSlots = () => {
    if (timeSlots) return timeSlots
    
    const slots = []
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    
    for (let i = 0; i < 24 * 60; i += timeInterval) {
      const time = new Date(start.getTime() + i * 60000)
      slots.push(format(time, 'HH:mm'))
    }
    
    return slots
  }
  
  // Handle date selection
  const handleDateSelect = (date: Date) => {
    if (mode === 'date') {
      onChange(date)
      setIsOpen(false)
    } else {
      // For datetime mode, combine with selected time
      if (selectedTime) {
        const [hours, minutes] = selectedTime.split(':').map(Number)
        const dateTime = new Date(date)
        dateTime.setHours(hours, minutes, 0, 0)
        onChange(dateTime)
        if (mode === 'datetime') {
          // Keep open for time selection
        }
      } else {
        // Set to start of day if no time selected
        onChange(startOfDay(date))
      }
    }
  }
  
  // Handle time selection
  const handleTimeSelect = (time: string) => {
    setSelectedTime(time)
    const [hours, minutes] = time.split(':').map(Number)
    
    if (mode === 'time') {
      const date = new Date()
      date.setHours(hours, minutes, 0, 0)
      onChange(date)
      setIsOpen(false)
    } else if (mode === 'datetime' && value) {
      const dateTime = new Date(value)
      dateTime.setHours(hours, minutes, 0, 0)
      onChange(dateTime)
      setIsOpen(false)
    }
  }
  
  // Handle input change
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value
    setInputValue(newValue)
    
    // Try to parse the input
    if (newValue) {
      let parsed: Date | null = null
      
      if (mode === 'date') {
        parsed = parse(newValue, dateFormat, new Date())
      } else if (mode === 'time') {
        parsed = parse(newValue, timeFormat, new Date())
      } else {
        parsed = parse(newValue, `${dateFormat} ${timeFormat}`, new Date())
      }
      
      if (isValid(parsed)) {
        onChange(parsed)
      }
    } else {
      onChange(null)
    }
  }
  
  // Check if date is disabled
  const isDisabled = (date: Date) => {
    if (minDate && isBefore(date, startOfDay(minDate))) return true
    if (maxDate && isAfter(date, startOfDay(maxDate))) return true
    if (disabledDates.some(d => isSameDay(d, date))) return true
    if (isDateDisabled?.(date)) return true
    return false
  }
  
  // Calendar navigation
  const goToPreviousMonth = () => {
    setCurrentMonth(prev => new Date(prev.getFullYear(), prev.getMonth() - 1))
  }
  
  const goToNextMonth = () => {
    setCurrentMonth(prev => new Date(prev.getFullYear(), prev.getMonth() + 1))
  }
  
  // Generate calendar days
  const generateCalendarDays = () => {
    const year = currentMonth.getFullYear()
    const month = currentMonth.getMonth()
    const firstDay = new Date(year, month, 1)
    const lastDay = new Date(year, month + 1, 0)
    const startDate = new Date(firstDay)
    startDate.setDate(startDate.getDate() - firstDay.getDay())
    
    const days = []
    const current = new Date(startDate)
    
    while (current <= lastDay || current.getDay() !== 0) {
      days.push(new Date(current))
      current.setDate(current.getDate() + 1)
    }
    
    return days
  }
  
  // Render calendar
  const renderCalendar = () => (
    <div className="p-3">
      {/* Month navigation */}
      <div className="flex items-center justify-between mb-2">
        <button
          type="button"
          onClick={goToPreviousMonth}
          className="p-1.5 hover:bg-gray-100 rounded-full"
        >
          <ChevronLeftIcon className="h-5 w-5" />
        </button>
        <h2 className="text-sm font-semibold">
          {format(currentMonth, 'MMMM yyyy')}
        </h2>
        <button
          type="button"
          onClick={goToNextMonth}
          className="p-1.5 hover:bg-gray-100 rounded-full"
        >
          <ChevronRightIcon className="h-5 w-5" />
        </button>
      </div>
      
      {/* Day headers */}
      <div className="grid grid-cols-7 text-center text-xs font-medium text-gray-500 mb-1">
        {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(day => (
          <div key={day} className="py-1">
            {day}
          </div>
        ))}
      </div>
      
      {/* Days grid */}
      <div className="grid grid-cols-7 gap-0.5">
        {generateCalendarDays().map((date, index) => {
          const isCurrentMonth = date.getMonth() === currentMonth.getMonth()
          const isSelected = value && isSameDay(date, value)
          const isToday = isSameDay(date, new Date())
          const disabled = isDisabled(date)
          
          return (
            <button
              key={index}
              type="button"
              onClick={() => !disabled && handleDateSelect(date)}
              disabled={disabled}
              className={cn(
                'p-2 text-sm rounded-md',
                'hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-green-500',
                isCurrentMonth ? 'text-gray-900' : 'text-gray-400',
                isSelected && 'bg-green-600 text-white hover:bg-green-700',
                isToday && !isSelected && 'font-semibold text-green-600',
                disabled && 'opacity-50 cursor-not-allowed hover:bg-transparent'
              )}
            >
              {date.getDate()}
            </button>
          )
        })}
      </div>
    </div>
  )
  
  // Render time picker
  const renderTimePicker = () => {
    const slots = generateTimeSlots()
    
    return (
      <div className="p-3 max-h-60 overflow-y-auto">
        <div className="grid grid-cols-2 gap-1">
          {slots.map(time => (
            <button
              key={time}
              type="button"
              onClick={() => handleTimeSelect(time)}
              className={cn(
                'px-3 py-2 text-sm rounded-md',
                'hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-green-500',
                selectedTime === time
                  ? 'bg-green-600 text-white hover:bg-green-700'
                  : 'text-gray-700'
              )}
            >
              {time}
            </button>
          ))}
        </div>
      </div>
    )
  }
  
  // Determine placeholder
  const getPlaceholder = () => {
    if (placeholder) return placeholder
    if (mode === 'date') return 'Select date'
    if (mode === 'time') return 'Select time'
    return 'Select date and time'
  }
  
  // Get icon based on mode
  const getIcon = () => {
    if (mode === 'time') return <ClockIcon />
    return <CalendarIcon />
  }
  
  return (
    <Popover
      open={isOpen}
      onOpenChange={setIsOpen}
      trigger={
        <Input
          ref={ref}
          value={inputValue}
          onChange={handleInputChange}
          placeholder={getPlaceholder()}
          leftIcon={getIcon()}
          disabled={disabled}
          error={error}
          inputSize={size}
          onFocus={() => setIsOpen(true)}
          className={className}
          {...inputProps}
        />
      }
    >
      <div className="bg-white rounded-lg shadow-lg border border-gray-200">
        {mode === 'date' && renderCalendar()}
        {mode === 'time' && renderTimePicker()}
        {mode === 'datetime' && (
          <div className="flex">
            <div className="border-r border-gray-200">
              {renderCalendar()}
            </div>
            <div>
              <div className="p-3 border-b border-gray-200">
                <h3 className="text-sm font-medium text-gray-900">Select Time</h3>
              </div>
              {renderTimePicker()}
            </div>
          </div>
        )}
        
        {/* Actions */}
        {clearable && value && (
          <div className="border-t border-gray-200 p-3">
            <button
              type="button"
              onClick={() => {
                onChange(null)
                setIsOpen(false)
              }}
              className="w-full text-sm text-gray-600 hover:text-gray-900"
            >
              Clear
            </button>
          </div>
        )}
      </div>
    </Popover>
  )
})

DateTimePicker.displayName = 'DateTimePicker'

/**
 * DatePicker - Convenience component for date-only selection
 */
export function DatePicker(props: Omit<DateTimePickerProps, 'mode'>) {
  return <DateTimePicker {...props} mode="date" />
}

/**
 * TimePicker - Convenience component for time-only selection
 */
export function TimePicker(props: Omit<DateTimePickerProps, 'mode'>) {
  return <DateTimePicker {...props} mode="time" />
}

/**
 * DateRangePicker - Select a date range
 */
export function DateRangePicker({
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange,
  minDate,
  maxDate,
  className,
  ...props
}: {
  startDate?: Date | null
  endDate?: Date | null
  onStartDateChange: (date: Date | null) => void
  onEndDateChange: (date: Date | null) => void
  minDate?: Date
  maxDate?: Date
  className?: string
} & Partial<DateTimePickerProps>) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <DatePicker
        value={startDate}
        onChange={onStartDateChange}
        minDate={minDate}
        maxDate={endDate || maxDate}
        placeholder="Start date"
        {...props}
      />
      <span className="text-gray-500">to</span>
      <DatePicker
        value={endDate}
        onChange={onEndDateChange}
        minDate={startDate || minDate}
        maxDate={maxDate}
        placeholder="End date"
        {...props}
      />
    </div>
  )
}