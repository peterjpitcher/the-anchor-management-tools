'use client'

import { useId } from 'react'
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

interface RadioProps {
  label: string
  description?: string
  checked?: boolean
  onChange?: (value: string) => void
  disabled?: boolean
  name?: string
  value: string
  id?: string
  className?: string
}

export function Radio({
  label,
  description,
  checked = false,
  onChange,
  disabled = false,
  name,
  value,
  id: idProp,
  className,
}: RadioProps) {
  const autoId = useId()
  const id = idProp ?? autoId
  const descriptionId = description ? `${id}-description` : undefined

  return (
    <div className={cn('flex gap-3 items-start', className)}>
      <div className={cn('relative mt-0.5 h-4 w-4 shrink-0', TOUCH_BOX_COLUMN)}>
        <input
          id={id}
          type="radio"
          name={name}
          value={value}
          checked={checked}
          disabled={disabled}
          aria-describedby={descriptionId}
          onChange={(event) => {
            if (event.target.checked) onChange?.(value)
          }}
          className={cn(
            'peer absolute inset-0 z-10 h-4 w-4 cursor-pointer opacity-0 disabled:cursor-not-allowed',
            TOUCH_BOX_INPUT
          )}
        />
        <span
          aria-hidden="true"
          className={cn(
            'absolute inset-0 rounded-full border-2 transition-[background,border-color,box-shadow] duration-[120ms]',
            TOUCH_BOX_FACE,
            // The real input is invisible, so the focus pattern is drawn on this circle.
            'peer-focus-visible:outline-hidden peer-focus-visible:shadow-ring',
            checked ? 'border-primary' : 'border-border-strong bg-surface',
            disabled && 'opacity-50'
          )}
        />
        {checked && (
          <span
            className="pointer-events-none absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary"
            aria-hidden="true"
          />
        )}
      </div>

      <div className="flex flex-col">
        <label
          htmlFor={id}
          className={cn(
            'text-ui text-text cursor-pointer',
            TOUCH_LABEL,
            disabled && 'cursor-not-allowed opacity-50'
          )}
        >
          {label}
        </label>
        {description && (
          <span id={descriptionId} className="text-xs text-text-muted mt-0.5">{description}</span>
        )}
      </div>
    </div>
  )
}
