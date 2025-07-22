/**
 * Radio Component
 * 
 * Used on 25/107 pages (23%)
 * 
 * Accessible radio button groups with proper keyboard navigation and ARIA attributes.
 * Supports horizontal/vertical layouts and card-style options.
 */

import { InputHTMLAttributes, forwardRef, useId } from 'react'
import { cn } from '@/lib/utils'

export interface RadioOption {
  /**
   * Value for the radio option
   */
  value: string
  
  /**
   * Display label for the option
   */
  label: string
  
  /**
   * Description text below the label
   */
  description?: string
  
  /**
   * Whether the option is disabled
   * @default false
   */
  disabled?: boolean
  
  /**
   * Icon to display with the option
   */
  icon?: React.ReactNode
}

export interface RadioGroupProps {
  /**
   * Array of radio options
   */
  options: RadioOption[]
  
  /**
   * Currently selected value
   */
  value?: string
  
  /**
   * Callback when value changes
   */
  onChange?: (value: string) => void
  
  /**
   * Name attribute for the radio group
   */
  name: string
  
  /**
   * Whether the radio group has an error
   * @default false
   */
  error?: boolean
  
  /**
   * Layout direction
   * @default 'vertical'
   */
  orientation?: 'vertical' | 'horizontal'
  
  /**
   * Size of the radio buttons
   * @default 'md'
   */
  size?: 'sm' | 'md' | 'lg'
  
  /**
   * Visual variant
   * @default 'default'
   */
  variant?: 'default' | 'card'
  
  /**
   * Whether the entire group is disabled
   * @default false
   */
  disabled?: boolean
  
  /**
   * Additional CSS classes
   */
  className?: string
  
  /**
   * Legend text for the radio group
   */
  legend?: string
  
  /**
   * Whether to hide the legend visually (still accessible)
   * @default false
   */
  legendSrOnly?: boolean
}

export const RadioGroup = forwardRef<HTMLFieldSetElement, RadioGroupProps>(({
  options,
  value,
  onChange,
  name,
  error = false,
  orientation = 'vertical',
  size = 'md',
  variant = 'default',
  disabled = false,
  className,
  legend,
  legendSrOnly = false,
}, ref) => {
  const groupId = useId()
  
  // Size classes
  const sizeClasses = {
    sm: {
      radio: 'h-4 w-4',
      label: 'text-sm',
      description: 'text-xs',
      padding: 'p-3',
      gap: 'gap-2',
    },
    md: {
      radio: 'h-4 w-4',
      label: 'text-sm',
      description: 'text-sm',
      padding: 'p-4',
      gap: 'gap-3',
    },
    lg: {
      radio: 'h-5 w-5',
      label: 'text-base',
      description: 'text-sm',
      padding: 'p-5',
      gap: 'gap-3',
    },
  }
  
  // Layout classes
  const orientationClasses = {
    vertical: variant === 'card' ? 'space-y-3' : 'space-y-4',
    horizontal: 'flex flex-wrap gap-6',
  }
  
  return (
    <fieldset
      ref={ref}
      className={className}
      aria-describedby={error ? `${groupId}-error` : undefined}
    >
      {legend && (
        <legend className={cn(
          'text-base font-medium text-gray-900 mb-4',
          legendSrOnly && 'sr-only'
        )}>
          {legend}
        </legend>
      )}
      
      <div className={orientationClasses[orientation]}>
        {options.map((option) => {
          const optionId = `${groupId}-${option.value}`
          const isDisabled = disabled || option.disabled
          const isChecked = value === option.value
          
          if (variant === 'card') {
            return (
              <label
                key={option.value}
                htmlFor={optionId}
                className={cn(
                  'relative flex cursor-pointer rounded-lg border bg-white shadow-sm',
                  sizeClasses[size].padding,
                  isChecked
                    ? 'border-green-600 ring-2 ring-green-600'
                    : 'border-gray-200',
                  isDisabled
                    ? 'cursor-not-allowed opacity-50'
                    : 'hover:bg-gray-50',
                  error && 'border-red-300'
                )}
              >
                <input
                  type="radio"
                  id={optionId}
                  name={name}
                  value={option.value}
                  checked={isChecked}
                  onChange={(e) => onChange?.(e.target.value)}
                  disabled={isDisabled}
                  className="sr-only"
                  aria-describedby={
                    option.description ? `${optionId}-description` : undefined
                  }
                />
                
                <div className="flex flex-1">
                  <div className="flex flex-col">
                    <span className={cn(
                      'block font-medium',
                      sizeClasses[size].label,
                      isChecked ? 'text-green-900' : 'text-gray-900'
                    )}>
                      {option.label}
                    </span>
                    {option.description && (
                      <span
                        id={`${optionId}-description`}
                        className={cn(
                          'mt-1',
                          sizeClasses[size].description,
                          isChecked ? 'text-green-700' : 'text-gray-500'
                        )}
                      >
                        {option.description}
                      </span>
                    )}
                  </div>
                  {option.icon && (
                    <div className="ml-auto flex-shrink-0">
                      {option.icon}
                    </div>
                  )}
                </div>
                
                <div
                  className={cn(
                    'absolute -inset-px rounded-lg pointer-events-none',
                    isChecked ? 'border-2 border-green-600' : 'border border-transparent'
                  )}
                  aria-hidden="true"
                />
              </label>
            )
          }
          
          // Default variant
          return (
            <div key={option.value} className="flex items-start">
              <input
                type="radio"
                id={optionId}
                name={name}
                value={option.value}
                checked={isChecked}
                onChange={(e) => onChange?.(e.target.value)}
                disabled={isDisabled}
                className={cn(
                  sizeClasses[size].radio,
                  'text-green-600 border-gray-300',
                  'focus:ring-2 focus:ring-offset-2 focus:ring-green-500',
                  'disabled:text-gray-300',
                  error && 'border-red-500',
                  'mt-0.5' // Align with first line of label
                )}
                aria-describedby={
                  option.description ? `${optionId}-description` : undefined
                }
              />
              <label
                htmlFor={optionId}
                className={cn(
                  'ml-3 flex flex-col',
                  isDisabled && 'cursor-not-allowed opacity-50'
                )}
              >
                <span className={cn(
                  'font-medium text-gray-900',
                  sizeClasses[size].label
                )}>
                  {option.label}
                </span>
                {option.description && (
                  <span
                    id={`${optionId}-description`}
                    className={cn(
                      'text-gray-500',
                      sizeClasses[size].description
                    )}
                  >
                    {option.description}
                  </span>
                )}
              </label>
            </div>
          )
        })}
      </div>
      
      {error && (
        <p
          id={`${groupId}-error`}
          className="mt-2 text-sm text-red-600"
          role="alert"
        >
          Please select an option
        </p>
      )}
    </fieldset>
  )
})

RadioGroup.displayName = 'RadioGroup'

/**
 * Individual Radio component for custom implementations
 */
export interface RadioProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  /**
   * Label for the radio button
   */
  label?: string
  
  /**
   * Description text below the label
   */
  description?: string
  
  /**
   * Size of the radio button
   * @default 'md'
   */
  size?: 'sm' | 'md' | 'lg'
  
  /**
   * Whether the radio has an error
   * @default false
   */
  error?: boolean
}

export const Radio = forwardRef<HTMLInputElement, RadioProps>(({
  label,
  description,
  size = 'md',
  error = false,
  className,
  id,
  ...props
}, ref) => {
  const inputId = id || useId()
  
  // Size classes
  const sizeClasses = {
    sm: {
      radio: 'h-4 w-4',
      label: 'text-sm',
      description: 'text-xs',
    },
    md: {
      radio: 'h-4 w-4', 
      label: 'text-sm',
      description: 'text-sm',
    },
    lg: {
      radio: 'h-5 w-5',
      label: 'text-base', 
      description: 'text-sm',
    },
  }
  
  const input = (
    <input
      ref={ref}
      type="radio"
      id={inputId}
      className={cn(
        sizeClasses[size].radio,
        'text-green-600 border-gray-300',
        'focus:ring-2 focus:ring-offset-2 focus:ring-green-500',
        'disabled:text-gray-300',
        error && 'border-red-500',
        className
      )}
      aria-describedby={description ? `${inputId}-description` : undefined}
      {...props}
    />
  )
  
  if (!label) {
    return input
  }
  
  return (
    <div className="flex items-start">
      {input}
      <label
        htmlFor={inputId}
        className={cn(
          'ml-3 flex flex-col',
          props.disabled && 'cursor-not-allowed opacity-50'
        )}
      >
        <span className={cn(
          'font-medium text-gray-900',
          sizeClasses[size].label
        )}>
          {label}
        </span>
        {description && (
          <span
            id={`${inputId}-description`}
            className={cn(
              'text-gray-500',
              sizeClasses[size].description
            )}
          >
            {description}
          </span>
        )}
      </label>
    </div>
  )
})

Radio.displayName = 'Radio'