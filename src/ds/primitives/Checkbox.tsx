'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

// Touch screens (pointer: coarse): the label grows to the 44px touch target, 13px of padding
// above and below one 18px line of text-ui, so callers never need their own <label> around
// the control to make it easier to tap. The box column takes the same padding, so the box
// stays level with the first line of the label whatever the row's alignment, and the real
// input stretches over that column too. A mouse sees the compact layout unchanged.
// Each class is written out in full so Tailwind can find it.
const TOUCH_LABEL = 'pointer-coarse:py-[calc((var(--spacing-touch)_-_var(--text-ui--line-height))/2)]'
const TOUCH_BOX_COLUMN = 'pointer-coarse:box-content pointer-coarse:py-[calc((var(--spacing-touch)_-_var(--text-ui--line-height))/2)]'
const TOUCH_BOX_INPUT = 'pointer-coarse:h-full'
const TOUCH_BOX_FACE = 'pointer-coarse:inset-y-[calc((var(--spacing-touch)_-_var(--text-ui--line-height))/2)]'
// A checkbox named only by aria-label (a row selector, a "mark done" tick) has no label to grow,
// so with `touchTarget` the invisible input itself becomes a 44px square centred on the 16px box
// on touch screens. Nothing around it moves: only the area a finger can hit grows.
const TOUCH_TARGET_INPUT =
  'pointer-coarse:h-touch pointer-coarse:w-touch pointer-coarse:top-[calc((1rem_-_var(--spacing-touch))/2)] pointer-coarse:left-[calc((1rem_-_var(--spacing-touch))/2)]'

interface CheckboxProps {
  label?: string
  'aria-label'?: string
  description?: string
  checked?: boolean
  defaultChecked?: boolean
  indeterminate?: boolean
  onChange?: (checked: boolean) => void
  disabled?: boolean
  id?: string
  name?: string
  value?: string
  /**
   * For a checkbox with no visible label (named by `aria-label`): on touch screens its tap area
   * grows to a 44px square around the box, the touch row a visible label would give it, without
   * moving anything. Use it instead of wrapping the checkbox in a <label> to make it easier to
   * tap. A checkbox with a visible label already gets its touch row from the label. The area
   * reaches 14px past each side of the box and sits above its neighbours, so leave 14px (gap-3.5)
   * before a link or button beside it, or the checkbox takes that control's first taps.
   */
  touchTarget?: boolean
  /** @deprecated Accepted for backward compatibility */
  error?: boolean
  className?: string
  children?: React.ReactNode
}

export function Checkbox({
  label,
  'aria-label': ariaLabel,
  description,
  checked,
  defaultChecked,
  indeterminate,
  onChange,
  disabled = false,
  id: idProp,
  name,
  value,
  touchTarget = false,
  error: _error,
  className,
  children,
}: CheckboxProps) {
  const displayLabel = label ?? (typeof children === 'string' ? children : undefined)
  const autoId = useId()
  const id = idProp ?? autoId
  const inputRef = useRef<HTMLInputElement>(null)
  const isControlled = checked !== undefined
  const [uncontrolledChecked, setUncontrolledChecked] = useState(defaultChecked ?? false)
  const resolvedChecked = isControlled ? checked : uncontrolledChecked

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.indeterminate = Boolean(indeterminate)
    }
  }, [indeterminate])

  return (
    <div className={cn('flex gap-3 items-start', className)}>
      <div className={cn('relative mt-0.5 h-4 w-4 shrink-0', displayLabel && TOUCH_BOX_COLUMN)}>
        <input
          ref={inputRef}
          id={id}
          type="checkbox"
          name={name}
          value={value}
          checked={isControlled ? resolvedChecked : undefined}
          defaultChecked={!isControlled ? defaultChecked : undefined}
          aria-checked={indeterminate ? 'mixed' : resolvedChecked}
          aria-label={!displayLabel ? (ariaLabel ?? label) : undefined}
          disabled={disabled}
          onChange={(event) => {
            const nextChecked = event.target.checked
            if (!isControlled) {
              setUncontrolledChecked(nextChecked)
            }
            onChange?.(nextChecked)
          }}
          className={cn(
            'peer absolute inset-0 z-10 h-4 w-4 cursor-pointer opacity-0 disabled:cursor-not-allowed',
            displayLabel ? TOUCH_BOX_INPUT : touchTarget && TOUCH_TARGET_INPUT
          )}
        />
        <span
          aria-hidden="true"
          className={cn(
            'absolute inset-0 rounded-sm border transition-[background,border-color,box-shadow] duration-[120ms]',
            displayLabel && TOUCH_BOX_FACE,
            // The real input is invisible, so the focus pattern is drawn on this box.
            'peer-focus-visible:outline-hidden peer-focus-visible:shadow-ring',
            resolvedChecked || indeterminate
              ? 'bg-primary border-primary'
              : 'bg-surface border-border-strong',
            disabled && 'opacity-50'
          )}
        />
        {(resolvedChecked || indeterminate) && (
          <svg
            className={cn('pointer-events-none absolute inset-0 h-4 w-4 text-primary-fg', displayLabel && TOUCH_BOX_FACE)}
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            {indeterminate ? <path d="M4 8h8" /> : <path d="M4 8l3 3 5-6" />}
          </svg>
        )}
      </div>

      {(displayLabel || description) && (
        <div className="flex flex-col">
          {displayLabel && (
            <label
              htmlFor={id}
              className={cn(
                'text-ui text-text cursor-pointer',
                TOUCH_LABEL,
                disabled && 'cursor-not-allowed opacity-50'
              )}
            >
              {displayLabel}
            </label>
          )}
          {description && (
            <span className="text-xs text-text-muted mt-0.5">{description}</span>
          )}
        </div>
      )}
    </div>
  )
}
