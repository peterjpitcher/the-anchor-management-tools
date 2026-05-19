'use client'

/**
 * RadioGroup — backward-compatible wrapper
 * @deprecated Use ds/Radio components instead
 */

import { forwardRef, useId } from 'react'
import { cn } from '@/lib/utils'

export interface RadioOption {
  value: string
  label: string
  description?: string
  disabled?: boolean
  icon?: React.ReactNode
}

export interface RadioGroupProps {
  options: RadioOption[]
  value?: string
  onChange?: (value: string) => void
  name: string
  error?: boolean
  orientation?: 'vertical' | 'horizontal'
  size?: 'sm' | 'md' | 'lg'
  variant?: 'default' | 'card'
  disabled?: boolean
  className?: string
  legend?: string
  legendSrOnly?: boolean
}

export const RadioGroup = forwardRef<HTMLFieldSetElement, RadioGroupProps>(
  (
    {
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
    },
    ref,
  ) => {
    const groupId = useId()

    const sizeCls = {
      sm: { radio: 'h-4 w-4', label: 'text-sm', desc: 'text-xs', pad: 'p-3', gap: 'gap-2' },
      md: { radio: 'h-4 w-4', label: 'text-sm', desc: 'text-sm', pad: 'p-4', gap: 'gap-3' },
      lg: { radio: 'h-5 w-5', label: 'text-base', desc: 'text-sm', pad: 'p-4', gap: 'gap-3' },
    }

    const sc = sizeCls[size]

    return (
      <fieldset ref={ref} className={cn(className)} aria-invalid={error || undefined}>
        {legend && (
          <legend className={cn('text-sm font-medium text-gray-700 mb-3', legendSrOnly && 'sr-only')}>
            {legend}
          </legend>
        )}
        <div
          className={cn(
            'flex',
            orientation === 'vertical' ? 'flex-col gap-3' : 'flex-row flex-wrap gap-4',
          )}
        >
          {options.map((opt) => {
            const id = `${groupId}-${opt.value}`
            const isChecked = value === opt.value
            const isDisabled = disabled || opt.disabled

            if (variant === 'card') {
              return (
                <label
                  key={opt.value}
                  htmlFor={id}
                  className={cn(
                    'flex items-start cursor-pointer border rounded-lg transition-colors',
                    sc.pad,
                    sc.gap,
                    isChecked
                      ? 'border-green-600 bg-green-50 ring-1 ring-green-600'
                      : 'border-gray-200 hover:border-gray-300',
                    isDisabled && 'opacity-50 cursor-not-allowed',
                    error && !isChecked && 'border-red-300',
                  )}
                >
                  <input
                    id={id}
                    type="radio"
                    name={name}
                    value={opt.value}
                    checked={isChecked}
                    disabled={isDisabled}
                    onChange={() => onChange?.(opt.value)}
                    className={cn(sc.radio, 'mt-0.5 accent-green-600')}
                  />
                  <div className="flex-1 min-w-0">
                    {opt.icon && <span className="mb-1 block">{opt.icon}</span>}
                    <span className={cn(sc.label, 'font-medium text-gray-900')}>{opt.label}</span>
                    {opt.description && (
                      <span className={cn(sc.desc, 'text-gray-500 block mt-0.5')}>{opt.description}</span>
                    )}
                  </div>
                </label>
              )
            }

            return (
              <label
                key={opt.value}
                htmlFor={id}
                className={cn(
                  'flex items-start cursor-pointer',
                  sc.gap,
                  isDisabled && 'opacity-50 cursor-not-allowed',
                )}
              >
                <input
                  id={id}
                  type="radio"
                  name={name}
                  value={opt.value}
                  checked={isChecked}
                  disabled={isDisabled}
                  onChange={() => onChange?.(opt.value)}
                  className={cn(sc.radio, 'mt-0.5 accent-green-600')}
                />
                <div className="flex-1 min-w-0">
                  <span className={cn(sc.label, 'text-gray-900')}>{opt.label}</span>
                  {opt.description && (
                    <span className={cn(sc.desc, 'text-gray-500 block mt-0.5')}>{opt.description}</span>
                  )}
                </div>
              </label>
            )
          })}
        </div>
      </fieldset>
    )
  },
)

RadioGroup.displayName = 'RadioGroup'
