'use client'

/**
 * Rating Component
 * 
 * Star rating input with customizable icons and display modes.
 * Supports half ratings, readonly display, and hover effects.
 */

import { useState, ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { StarIcon } from '@heroicons/react/24/solid'
import { StarIcon as StarOutlineIcon } from '@heroicons/react/24/outline'

export interface RatingProps {
  /**
   * Current rating value
   */
  value?: number
  
  /**
   * Callback when rating changes
   */
  onChange?: (rating: number) => void
  
  /**
   * Maximum rating value
   * @default 5
   */
  max?: number
  
  /**
   * Whether to allow half ratings
   * @default false
   */
  allowHalf?: boolean
  
  /**
   * Whether rating is readonly
   * @default false
   */
  readonly?: boolean
  
  /**
   * Whether rating is disabled
   * @default false
   */
  disabled?: boolean
  
  /**
   * Size variant
   * @default 'md'
   */
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  
  /**
   * Custom filled icon
   */
  filledIcon?: ReactNode
  
  /**
   * Custom empty icon
   */
  emptyIcon?: ReactNode
  
  /**
   * Color of filled stars
   * @default 'yellow'
   */
  color?: 'yellow' | 'green' | 'blue' | 'red' | 'purple' | 'gray'
  
  /**
   * Whether to show value label
   * @default false
   */
  showLabel?: boolean
  
  /**
   * Custom label format
   */
  labelFormat?: (value: number, max: number) => string
  
  /**
   * Label position
   * @default 'right'
   */
  labelPosition?: 'left' | 'right' | 'top' | 'bottom'
  
  /**
   * Whether to show tooltips
   * @default false
   */
  showTooltips?: boolean
  
  /**
   * Tooltip labels
   */
  tooltips?: string[]
  
  /**
   * Additional classes
   */
  className?: string
  
  /**
   * Character to use instead of icons
   */
  character?: string
  
  /**
   * Whether to allow clearing (clicking same rating)
   * @default true
   */
  allowClear?: boolean
  
  /**
   * Callback on hover
   */
  onHoverChange?: (rating: number | null) => void
}

export function Rating({
  value = 0,
  onChange,
  max = 5,
  allowHalf = false,
  readonly = false,
  disabled = false,
  size = 'md',
  filledIcon,
  emptyIcon,
  color = 'yellow',
  showLabel = false,
  labelFormat,
  labelPosition = 'right',
  showTooltips = false,
  tooltips = [],
  className,
  character,
  allowClear = true,
  onHoverChange,
}: RatingProps) {
  const [hoverValue, setHoverValue] = useState<number | null>(null)
  const displayValue = hoverValue ?? value
  
  // Size classes
  const sizeClasses = {
    xs: 'h-3 w-3',
    sm: 'h-4 w-4',
    md: 'h-5 w-5',
    lg: 'h-6 w-6',
    xl: 'h-8 w-8',
  }
  
  // Color classes
  const colorClasses = {
    yellow: 'text-yellow-400',
    green: 'text-green-500',
    blue: 'text-blue-500',
    red: 'text-red-500',
    purple: 'text-purple-500',
    gray: 'text-gray-400',
  }
  
  // Handle click
  const handleClick = (rating: number) => {
    if (readonly || disabled || !onChange) return
    
    // Allow clearing if clicking the same rating
    if (allowClear && rating === value) {
      onChange(0)
    } else {
      onChange(rating)
    }
  }
  
  // Handle mouse enter
  const handleMouseEnter = (rating: number) => {
    if (readonly || disabled) return
    setHoverValue(rating)
    onHoverChange?.(rating)
  }
  
  // Handle mouse leave
  const handleMouseLeave = () => {
    setHoverValue(null)
    onHoverChange?.(null)
  }
  
  // Get tooltip
  const getTooltip = (index: number) => {
    if (!showTooltips) return undefined
    return tooltips[index] || `${index + 1} star${index === 0 ? '' : 's'}`
  }
  
  // Render star
  const renderStar = (index: number) => {
    const rating = index + 1
    const isHalf = allowHalf && displayValue > index && displayValue < rating
    const isFilled = displayValue >= rating || (isHalf && displayValue >= index + 0.5)
    
    const starClasses = cn(
      sizeClasses[size],
      'transition-colors',
      isFilled && colorClasses[color],
      !isFilled && 'text-gray-300',
      !readonly && !disabled && 'cursor-pointer hover:scale-110',
      disabled && 'opacity-50 cursor-not-allowed'
    )
    
    // Character mode
    if (character) {
      return (
        <span
          className={cn(
            starClasses,
            'inline-flex items-center justify-center font-bold'
          )}
        >
          {character}
        </span>
      )
    }
    
    // Icon mode
    if (isHalf) {
      return (
        <div className="relative">
          <StarOutlineIcon className={starClasses} />
          <div className="absolute inset-0 overflow-hidden" style={{ width: '50%' }}>
            <StarIcon className={starClasses} />
          </div>
        </div>
      )
    }
    
    const Icon = isFilled 
      ? (filledIcon || <StarIcon className={starClasses} />)
      : (emptyIcon || <StarOutlineIcon className={starClasses} />)
    
    return Icon
  }
  
  // Render clickable area
  const renderClickableArea = (index: number) => {
    const rating = index + 1
    
    if (allowHalf) {
      return (
        <>
          <button
            type="button"
            className="absolute inset-y-0 left-0 w-1/2"
            onClick={() => handleClick(index + 0.5)}
            onMouseEnter={() => handleMouseEnter(index + 0.5)}
            aria-label={`Rate ${index + 0.5} out of ${max}`}
          />
          <button
            type="button"
            className="absolute inset-y-0 right-0 w-1/2"
            onClick={() => handleClick(rating)}
            onMouseEnter={() => handleMouseEnter(rating)}
            aria-label={`Rate ${rating} out of ${max}`}
          />
        </>
      )
    }
    
    return (
      <button
        type="button"
        className="absolute inset-0"
        onClick={() => handleClick(rating)}
        onMouseEnter={() => handleMouseEnter(rating)}
        aria-label={`Rate ${rating} out of ${max}`}
      />
    )
  }
  
  // Format label
  const getLabel = () => {
    if (!showLabel) return null
    
    if (labelFormat) {
      return labelFormat(value, max)
    }
    
    if (value === 0) {
      return 'Not rated'
    }
    
    return `${value}${allowHalf && value % 1 !== 0 ? '.5' : ''} / ${max}`
  }
  
  const label = getLabel()
  const stars = Array.from({ length: max }, (_, i) => (
    <div
      key={i}
      className="relative inline-block"
      title={getTooltip(i)}
    >
      {renderStar(i)}
      {!readonly && !disabled && renderClickableArea(i)}
    </div>
  ))
  
  const starsContainer = (
    <div
      className={cn(
        'inline-flex items-center gap-0.5',
        !readonly && !disabled && 'group'
      )}
      onMouseLeave={handleMouseLeave}
      role="radiogroup"
      aria-label="Rating"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-readonly={readonly}
      aria-disabled={disabled}
    >
      {stars}
    </div>
  )
  
  return (
    <div
      className={cn(
        'inline-flex',
        labelPosition === 'top' || labelPosition === 'bottom' ? 'flex-col' : 'items-center',
        labelPosition === 'left' || labelPosition === 'right' ? 'gap-2' : 'gap-1',
        className
      )}
    >
      {label && (labelPosition === 'left' || labelPosition === 'top') && (
        <span className="text-sm text-gray-600">{label}</span>
      )}
      
      {starsContainer}
      
      {label && (labelPosition === 'right' || labelPosition === 'bottom') && (
        <span className="text-sm text-gray-600">{label}</span>
      )}
    </div>
  )
}

/**
 * RatingDisplay - Readonly rating display
 */
export function RatingDisplay({
  rating,
  max = 5,
  showCount,
  count,
  ...props
}: {
  rating: number
  max?: number
  showCount?: boolean
  count?: number
} & Omit<RatingProps, 'value' | 'onChange' | 'readonly'>) {
  return (
    <div className="inline-flex items-center gap-2">
      <Rating
        value={rating}
        max={max}
        readonly
        {...props}
      />
      {showCount && count != null && (
        <span className="text-sm text-gray-500">
          ({count})
        </span>
      )}
    </div>
  )
}

/**
 * RatingInput - Rating with label and error handling
 */
export function RatingInput({
  label,
  error,
  required,
  helperText,
  ...props
}: {
  label?: string
  error?: boolean | string
  required?: boolean
  helperText?: string
} & RatingProps) {
  return (
    <div className="space-y-1">
      {label && (
        <label className="block text-sm font-medium text-gray-700">
          {label}
          {required && <span className="text-red-500 ml-1">*</span>}
        </label>
      )}
      
      <Rating {...props} />
      
      {(error || helperText) && (
        <p className={cn(
          'text-sm',
          error ? 'text-red-600' : 'text-gray-500'
        )}>
          {typeof error === 'string' ? error : helperText}
        </p>
      )}
    </div>
  )
}

/**
 * useRating - Hook for managing rating state
 */
export function useRating(initialValue = 0) {
  const [rating, setRating] = useState(initialValue)
  const [hoverRating, setHoverRating] = useState<number | null>(null)
  
  return {
    rating,
    setRating,
    hoverRating,
    setHoverRating,
    displayRating: hoverRating ?? rating,
    reset: () => {
      setRating(initialValue)
      setHoverRating(null)
    },
  }
}