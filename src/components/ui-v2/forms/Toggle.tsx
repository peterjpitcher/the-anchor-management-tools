/**
 * Toggle Component
 * 
 * Switch/toggle control for binary options.
 * Accessible and mobile-optimized.
 */

import { forwardRef, InputHTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface ToggleProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  /**
   * Label for the toggle
   */
  label?: ReactNode
  
  /**
   * Description text
   */
  description?: ReactNode
  
  /**
   * Size of the toggle
   * @default 'md'
   */
  size?: 'sm' | 'md' | 'lg'
  
  /**
   * Color variant
   * @default 'primary'
   */
  variant?: 'primary' | 'success' | 'danger'
  
  /**
   * Label position
   * @default 'right'
   */
  labelPosition?: 'left' | 'right'
  
  /**
   * Whether to show on/off labels
   * @default false
   */
  showLabels?: boolean
  
  /**
   * Custom on label
   * @default 'On'
   */
  onLabel?: string
  
  /**
   * Custom off label
   * @default 'Off'
   */
  offLabel?: string
  
  /**
   * Whether the toggle has an error
   * @default false
   */
  error?: boolean
  
  /**
   * Additional classes
   */
  className?: string
  
  /**
   * Container classes
   */
  containerClassName?: string
}

export const Toggle = forwardRef<HTMLInputElement, ToggleProps>(({
  label,
  description,
  size = 'md',
  variant = 'primary',
  labelPosition = 'right',
  showLabels = false,
  onLabel = 'On',
  offLabel = 'Off',
  error = false,
  className,
  containerClassName,
  checked,
  disabled,
  onChange,
  ...props
}, ref) => {
  // Size classes
  const sizeClasses = {
    sm: {
      toggle: 'h-5 w-9',
      dot: 'h-3 w-3',
      translate: 'translate-x-4',
      label: 'text-sm',
      description: 'text-xs',
    },
    md: {
      toggle: 'h-6 w-11',
      dot: 'h-4 w-4',
      translate: 'translate-x-5',
      label: 'text-sm',
      description: 'text-sm',
    },
    lg: {
      toggle: 'h-7 w-14',
      dot: 'h-5 w-5',
      translate: 'translate-x-7',
      label: 'text-base',
      description: 'text-sm',
    },
  }
  
  // Variant classes
  const variantClasses = {
    primary: 'bg-green-600',
    success: 'bg-green-600',
    danger: 'bg-red-600',
  }
  
  const currentSize = sizeClasses[size]
  const currentVariant = variantClasses[variant]
  
  return (
    <label
      className={cn(
        'flex items-start gap-3',
        disabled && 'cursor-not-allowed opacity-50',
        !disabled && 'cursor-pointer',
        labelPosition === 'left' && 'flex-row-reverse',
        containerClassName
      )}
    >
      {/* Toggle switch */}
      <div className="relative flex-shrink-0">
        <input
          ref={ref}
          type="checkbox"
          className="sr-only"
          checked={checked}
          disabled={disabled}
          onChange={onChange}
          {...props}
        />
        
        {/* Track */}
        <div
          className={cn(
            'relative inline-flex items-center rounded-full transition-colors duration-200',
            currentSize.toggle,
            checked ? currentVariant : 'bg-gray-200',
            error && 'ring-2 ring-red-500 ring-offset-2',
            className
          )}
          aria-hidden="true"
        >
          {/* On/Off labels inside track */}
          {showLabels && (
            <>
              <span
                className={cn(
                  'absolute left-1 text-xs font-medium transition-opacity',
                  size === 'sm' && 'text-[10px]',
                  checked ? 'opacity-100 text-white' : 'opacity-0'
                )}
              >
                {onLabel}
              </span>
              <span
                className={cn(
                  'absolute right-1 text-xs font-medium transition-opacity',
                  size === 'sm' && 'text-[10px]',
                  !checked ? 'opacity-100 text-gray-600' : 'opacity-0'
                )}
              >
                {offLabel}
              </span>
            </>
          )}
          
          {/* Dot */}
          <span
            className={cn(
              'absolute left-1 inline-block rounded-full bg-white shadow-sm',
              'transform transition-transform duration-200',
              currentSize.dot,
              checked && currentSize.translate
            )}
          />
        </div>
      </div>
      
      {/* Label and description */}
      {(label || description) && (
        <div className="flex-1">
          {label && (
            <div className={cn(
              'font-medium text-gray-900',
              currentSize.label
            )}>
              {label}
            </div>
          )}
          {description && (
            <div className={cn(
              'text-gray-500 mt-0.5',
              currentSize.description
            )}>
              {description}
            </div>
          )}
        </div>
      )}
    </label>
  )
})

Toggle.displayName = 'Toggle'

/**
 * ToggleGroup - Group multiple toggles with a common label
 */
export function ToggleGroup({
  label,
  description,
  children,
  error,
  required,
  className,
}: {
  label?: ReactNode
  description?: ReactNode
  children: ReactNode
  error?: boolean
  required?: boolean
  className?: string
}) {
  return (
    <fieldset className={cn('space-y-3', className)}>
      {label && (
        <legend className="text-sm font-medium text-gray-900">
          {label}
          {required && <span className="text-red-500 ml-1">*</span>}
        </legend>
      )}
      {description && (
        <p className="text-sm text-gray-500">{description}</p>
      )}
      <div className="space-y-3">
        {children}
      </div>
      {error && (
        <p className="text-sm text-red-600">Please select at least one option</p>
      )}
    </fieldset>
  )
}

/**
 * CompactToggle - Minimal toggle without labels
 */
export const CompactToggle = forwardRef<HTMLInputElement, Omit<ToggleProps, 'showLabels'>>((
  props,
  ref
) => {
  return <Toggle ref={ref} size="sm" {...props} />
})

CompactToggle.displayName = 'CompactToggle'

/**
 * FeatureToggle - Toggle with icon and detailed description
 */
export function FeatureToggle({
  icon,
  title,
  description,
  checked,
  onChange,
  disabled,
  className,
}: {
  icon?: ReactNode
  title: string
  description: string
  checked?: boolean
  onChange?: (checked: boolean) => void
  disabled?: boolean
  className?: string
}) {
  return (
    <div className={cn(
      'flex items-start gap-4 p-4 rounded-lg border',
      checked ? 'border-green-200 bg-green-50' : 'border-gray-200',
      disabled && 'opacity-50',
      className
    )}>
      {icon && (
        <div className="flex-shrink-0 mt-0.5">
          <div className="h-10 w-10 rounded-lg bg-white shadow-sm flex items-center justify-center">
            {icon}
          </div>
        </div>
      )}
      <div className="flex-1 min-w-0">
        <Toggle
          label={title}
          description={description}
          checked={checked}
          onChange={(e) => onChange?.(e.target.checked)}
          disabled={disabled}
          labelPosition="left"
          containerClassName="flex-row-reverse justify-between"
        />
      </div>
    </div>
  )
}