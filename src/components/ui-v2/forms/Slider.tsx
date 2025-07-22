'use client'

/**
 * Slider Component
 * 
 * Range input control with value display and custom styling.
 * Supports single value and range selection.
 */

import { forwardRef, InputHTMLAttributes, useState, useRef, useEffect, ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface SliderProps {
  /**
   * Label for the slider
   */
  label?: ReactNode
  
  /**
   * Current value(s)
   */
  value?: number | [number, number]
  
  /**
   * Callback when value changes
   */
  onValueChange?: (value: number | [number, number]) => void
  
  /**
   * Minimum value
   * @default 0
   */
  min?: number
  
  /**
   * Maximum value
   * @default 100
   */
  max?: number
  
  /**
   * Step increment
   * @default 1
   */
  step?: number
  
  /**
   * Whether to show value label
   * @default true
   */
  showValue?: boolean
  
  /**
   * Position of value label
   * @default 'top'
   */
  valuePosition?: 'top' | 'right' | 'tooltip'
  
  /**
   * Whether this is a range slider
   * @default false
   */
  range?: boolean
  
  /**
   * Marks to show on the slider
   */
  marks?: Array<{
    value: number
    label?: string
  }>
  
  /**
   * Whether to show marks
   * @default false
   */
  showMarks?: boolean
  
  /**
   * Custom format function for value display
   */
  formatValue?: (value: number) => string
  
  /**
   * Size variant
   * @default 'md'
   */
  size?: 'sm' | 'md' | 'lg'
  
  /**
   * Color variant
   * @default 'primary'
   */
  variant?: 'primary' | 'success' | 'warning' | 'danger'
  
  /**
   * Whether the slider has an error
   * @default false
   */
  error?: boolean
  
  /**
   * Helper text
   */
  helperText?: ReactNode
  
  /**
   * Additional classes
   */
  className?: string
  
  /**
   * Whether slider is disabled
   * @default false
   */
  disabled?: boolean
}

export const Slider = forwardRef<HTMLInputElement, SliderProps>(({
  label,
  value: controlledValue,
  onValueChange,
  min = 0,
  max = 100,
  step = 1,
  showValue = true,
  valuePosition = 'top',
  range = false,
  marks = [],
  showMarks = false,
  formatValue = (v) => v.toString(),
  size = 'md',
  variant = 'primary',
  error = false,
  helperText,
  className,
  disabled = false,
}, ref) => {
  const [internalValue, setInternalValue] = useState<number | [number, number]>(
    range ? [min, max] : min
  )
  const [isDragging, setIsDragging] = useState(false)
  const [activeThumb, setActiveThumb] = useState<0 | 1 | null>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  
  const value = controlledValue ?? internalValue
  
  // Normalize value to always be array for calculations
  const normalizedValue = Array.isArray(value) ? value : [value]
  
  // Size classes
  const sizeClasses = {
    sm: {
      track: 'h-1',
      thumb: 'h-3 w-3',
      label: 'text-sm',
      value: 'text-xs',
    },
    md: {
      track: 'h-1.5',
      thumb: 'h-4 w-4',
      label: 'text-sm',
      value: 'text-sm',
    },
    lg: {
      track: 'h-2',
      thumb: 'h-5 w-5',
      label: 'text-base',
      value: 'text-base',
    },
  }
  
  // Variant classes
  const variantClasses = {
    primary: 'bg-green-600',
    success: 'bg-green-600',
    warning: 'bg-yellow-600',
    danger: 'bg-red-600',
  }
  
  const currentSize = sizeClasses[size]
  const currentVariant = variantClasses[variant]
  
  // Calculate position percentage
  const getPositionPercentage = (val: number) => {
    return ((val - min) / (max - min)) * 100
  }
  
  // Handle value change
  const handleValueChange = (newValue: number | [number, number]) => {
    if (!disabled) {
      setInternalValue(newValue)
      onValueChange?.(newValue)
    }
  }
  
  // Update value from mouse/touch position
  const updateValueFromPosition = (clientX: number, thumbIndex?: 0 | 1) => {
    if (!trackRef.current) return
    
    const rect = trackRef.current.getBoundingClientRect()
    const percentage = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    const newValue = Math.round((percentage * (max - min) + min) / step) * step
    
    if (range && Array.isArray(value)) {
      const newValues = [...value] as [number, number]
      const targetIndex = thumbIndex ?? (Math.abs(newValue - value[0]) < Math.abs(newValue - value[1]) ? 0 : 1)
      newValues[targetIndex] = newValue
      
      // Ensure min is less than max
      if (newValues[0] > newValues[1]) {
        newValues.reverse()
      }
      
      handleValueChange(newValues)
    } else {
      handleValueChange(Math.max(min, Math.min(max, newValue)))
    }
  }
  
  // Mouse handlers
  const handleMouseDown = (e: React.MouseEvent, thumbIndex?: 0 | 1) => {
    if (disabled) return
    e.preventDefault()
    setIsDragging(true)
    setActiveThumb(thumbIndex ?? null)
    updateValueFromPosition(e.clientX, thumbIndex)
    
    const handleMouseMove = (e: MouseEvent) => {
      updateValueFromPosition(e.clientX, thumbIndex)
    }
    
    const handleMouseUp = () => {
      setIsDragging(false)
      setActiveThumb(null)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
    
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }
  
  // Touch handlers
  const handleTouchStart = (e: React.TouchEvent, thumbIndex?: 0 | 1) => {
    if (disabled) return
    e.preventDefault()
    setIsDragging(true)
    setActiveThumb(thumbIndex ?? null)
    updateValueFromPosition(e.touches[0].clientX, thumbIndex)
    
    const handleTouchMove = (e: TouchEvent) => {
      updateValueFromPosition(e.touches[0].clientX, thumbIndex)
    }
    
    const handleTouchEnd = () => {
      setIsDragging(false)
      setActiveThumb(null)
      document.removeEventListener('touchmove', handleTouchMove)
      document.removeEventListener('touchend', handleTouchEnd)
    }
    
    document.addEventListener('touchmove', handleTouchMove)
    document.addEventListener('touchend', handleTouchEnd)
  }
  
  // Render value label
  const renderValueLabel = () => {
    if (!showValue || valuePosition === 'tooltip') return null
    
    const displayValue = range && Array.isArray(value)
      ? `${formatValue(value[0])} - ${formatValue(value[1])}`
      : formatValue(normalizedValue[0])
    
    return (
      <span className={cn(
        'text-gray-700 font-medium',
        currentSize.value
      )}>
        {displayValue}
      </span>
    )
  }
  
  return (
    <div className={cn('space-y-2', className)}>
      {/* Label and value */}
      {(label || (showValue && valuePosition === 'right')) && (
        <div className="flex items-center justify-between">
          {label && (
            <label className={cn(
              'font-medium text-gray-900',
              currentSize.label,
              disabled && 'text-gray-500'
            )}>
              {label}
            </label>
          )}
          {valuePosition === 'right' && renderValueLabel()}
        </div>
      )}
      
      {valuePosition === 'top' && showValue && (
        <div className="text-center">
          {renderValueLabel()}
        </div>
      )}
      
      {/* Slider track and thumbs */}
      <div className="relative">
        {/* Track */}
        <div
          ref={trackRef}
          className={cn(
            'relative w-full rounded-full bg-gray-200 cursor-pointer',
            currentSize.track,
            disabled && 'cursor-not-allowed opacity-50'
          )}
          onMouseDown={handleMouseDown}
          onTouchStart={handleTouchStart}
        >
          {/* Filled track */}
          <div
            className={cn(
              'absolute h-full rounded-full',
              currentVariant,
              error && 'bg-red-600'
            )}
            style={{
              left: range ? `${getPositionPercentage(normalizedValue[0])}%` : '0%',
              right: range 
                ? `${100 - getPositionPercentage(normalizedValue[1] ?? normalizedValue[0])}%`
                : `${100 - getPositionPercentage(normalizedValue[0])}%`
            }}
          />
          
          {/* Marks */}
          {showMarks && marks.map((mark) => {
            const position = getPositionPercentage(mark.value)
            const isActive = range && Array.isArray(value)
              ? mark.value >= value[0] && mark.value <= value[1]
              : mark.value <= normalizedValue[0]
              
            return (
              <div
                key={mark.value}
                className="absolute top-1/2 -translate-y-1/2"
                style={{ left: `${position}%` }}
              >
                <div
                  className={cn(
                    'w-1 h-1 rounded-full -translate-x-1/2',
                    isActive ? currentVariant : 'bg-gray-400'
                  )}
                />
                {mark.label && (
                  <span className="absolute top-full mt-1 left-1/2 -translate-x-1/2 text-xs text-gray-500 whitespace-nowrap">
                    {mark.label}
                  </span>
                )}
              </div>
            )
          })}
          
          {/* Thumbs */}
          {normalizedValue.map((val, index) => {
            if (!range && index > 0) return null
            
            const position = getPositionPercentage(val)
            const isActive = activeThumb === index || (!range && isDragging)
            
            return (
              <div
                key={index}
                className={cn(
                  'absolute top-1/2 -translate-y-1/2 -translate-x-1/2',
                  'transition-transform',
                  isActive && 'scale-110'
                )}
                style={{ left: `${position}%` }}
                onMouseDown={(e) => {
                  e.stopPropagation()
                  handleMouseDown(e, index as 0 | 1)
                }}
                onTouchStart={(e) => {
                  e.stopPropagation()
                  handleTouchStart(e, index as 0 | 1)
                }}
              >
                <div
                  className={cn(
                    'rounded-full bg-white shadow-md border-2',
                    'hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-offset-2',
                    currentSize.thumb,
                    error ? 'border-red-600 focus:ring-red-500' : `border-current focus:ring-current`,
                    currentVariant,
                    disabled && 'cursor-not-allowed'
                  )}
                  tabIndex={disabled ? -1 : 0}
                  role="slider"
                  aria-valuemin={min}
                  aria-valuemax={max}
                  aria-valuenow={val}
                  aria-label={range ? `${index === 0 ? 'Minimum' : 'Maximum'} value` : 'Value'}
                />
                
                {/* Tooltip */}
                {valuePosition === 'tooltip' && showValue && isActive && (
                  <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2">
                    <div className="bg-gray-900 text-white px-2 py-1 rounded text-xs whitespace-nowrap">
                      {formatValue(val)}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
        
        {/* Min/Max labels */}
        <div className="flex justify-between mt-1">
          <span className="text-xs text-gray-500">{formatValue(min)}</span>
          <span className="text-xs text-gray-500">{formatValue(max)}</span>
        </div>
      </div>
      
      {/* Helper text */}
      {helperText && (
        <p className={cn(
          'text-sm',
          error ? 'text-red-600' : 'text-gray-500'
        )}>
          {helperText}
        </p>
      )}
    </div>
  )
})

Slider.displayName = 'Slider'

/**
 * RangeSlider - Convenience component for range selection
 */
export const RangeSlider = forwardRef<HTMLInputElement, Omit<SliderProps, 'range'>>((
  props,
  ref
) => {
  return <Slider ref={ref} range {...props} />
})

RangeSlider.displayName = 'RangeSlider'

/**
 * PercentageSlider - Slider formatted as percentage
 */
export const PercentageSlider = forwardRef<HTMLInputElement, Omit<SliderProps, 'formatValue' | 'max'>>((
  props,
  ref
) => {
  return (
    <Slider
      ref={ref}
      max={100}
      formatValue={(v) => `${v}%`}
      {...props}
    />
  )
})

PercentageSlider.displayName = 'PercentageSlider'