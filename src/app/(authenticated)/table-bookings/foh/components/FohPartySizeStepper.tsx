'use client'

import React from 'react'
import { Button, Input } from '@/ds'

/**
 * Party size with a minus and a plus beside the number (owner decision, 22 November 2026). On the
 * bar iPad the number pad covers half the screen for what is usually a change of one or two, so
 * the buttons do it in a tap; the number can still be typed. Every part is at least 44px.
 *
 * The value stays a string, as the forms hold it, so a half-typed number is never rewritten
 * under the person typing it.
 */
export const FohPartySizeStepper = React.forwardRef<HTMLInputElement, {
  label: string
  value: string
  onChange: (value: string) => void
  min?: number
  max?: number
  required?: boolean
  className?: string
}>(function FohPartySizeStepper({ label, value, onChange, min = 1, max, required, className }, ref) {
  const current = Number.parseInt(value, 10)
  const known = Number.isFinite(current)
  const step = (delta: number) => {
    // An empty or half-typed box starts from the smallest size rather than guessing.
    if (!known) { onChange(String(min)); return }
    const next = current + delta
    onChange(String(Math.max(min, max != null ? Math.min(max, next) : next)))
  }
  const stepButtonClass = 'size-11 shrink-0 px-0 text-xl font-semibold leading-none'

  return (
    <div className={className}>
      <div className="flex items-end gap-2">
        <Button
          type="button"
          variant="secondary"
          aria-label={`One fewer: ${label.toLowerCase()}`}
          disabled={known && current <= min}
          onClick={() => step(-1)}
          className={stepButtonClass}
        >
          <span aria-hidden="true">&minus;</span>
        </Button>
        <div className="min-w-20 flex-1">
          <Input
            ref={ref}
            label={label}
            type="number"
            inputMode="numeric"
            min={min}
            max={max}
            required={required}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            className="min-h-touch text-center text-base font-semibold"
          />
        </div>
        <Button
          type="button"
          variant="secondary"
          aria-label={`One more: ${label.toLowerCase()}`}
          disabled={known && max != null && current >= max}
          onClick={() => step(1)}
          className={stepButtonClass}
        >
          <span aria-hidden="true">+</span>
        </Button>
      </div>
    </div>
  )
})
