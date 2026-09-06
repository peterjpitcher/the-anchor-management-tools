'use client'

/**
 * The small labelled controls used by `ArtworkBrandingModal`.
 *
 * They exist as their own file for one reason: every control in the placement
 * editor has to be a real, labelled, focusable form control, and keeping them
 * here means the modal cannot quietly grow a bare div with an onClick on it.
 *
 * Two rules apply to anything added here:
 *
 * 1. Never use a `md:grid-cols`, `lg:grid-cols` or `xl:grid-cols` class on a
 *    layout that must keep its columns. `globals.css` forces
 *    `grid-template-columns: 1fr !important` on any class list containing those
 *    strings below 820px, which silently flattens a 2x2 picker into a stack.
 * 2. The 44px touch floor below 820px is met with padding on real buttons, not
 *    by swapping a button for a div, which would throw away the keyboard
 *    semantics the picker depends on.
 */

import { cn } from '@/lib/utils'

export interface OptionButtonsOption<T extends string> {
  value: T
  label: string
}

export interface OptionButtonsProps<T extends string> {
  /** Names the group for assistive technology. */
  label: string
  options: readonly OptionButtonsOption<T>[]
  value: T
  onChange: (value: T) => void
  /**
   * Applied to the button container. See rule 1 above: a breakpoint-prefixed
   * grid class here collapses the group to one column on a phone.
   */
  className?: string
}

export function OptionButtons<T extends string>({
  label,
  options,
  value,
  onChange,
  className,
}: OptionButtonsProps<T>): React.JSX.Element {
  return (
    <div role="radiogroup" aria-label={label} className={cn('flex flex-wrap gap-2', className)}>
      {options.map((option) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            // px-3 py-2 carries the control past the 44px floor on its own, so
            // the global rule never has to stretch it.
            className={cn(
              'rounded-md border px-3 py-2 text-sm font-medium transition-colors',
              'focus-visible:outline-none focus-visible:shadow-ring',
              selected
                ? 'border-primary bg-primary-soft text-primary-soft-fg'
                : 'border-border-strong bg-surface text-text hover:bg-surface-hover'
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

export interface SliderFieldProps {
  id: string
  label: string
  min: number
  max: number
  step?: number
  value: number
  onChange: (value: number) => void
  /** Rendered next to the slider, e.g. "22%". */
  valueLabel: string
  hint?: string
  disabled?: boolean
}

export function SliderField({
  id,
  label,
  min,
  max,
  step = 1,
  value,
  onChange,
  valueLabel,
  hint,
  disabled,
}: SliderFieldProps): React.JSX.Element {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium text-text">
          {label}
        </label>
        <output htmlFor={id} className="text-sm tabular-nums text-text-muted">
          {valueLabel}
        </output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-1 w-full accent-primary"
      />
      {hint && <p className="mt-1 text-xs text-text-muted">{hint}</p>}
    </div>
  )
}

export interface NumberFieldProps {
  id: string
  label: string
  min: number
  max: number
  step?: number
  value: number
  onChange: (value: number) => void
  suffix?: string
  disabled?: boolean
}

export function NumberField({
  id,
  label,
  min,
  max,
  step = 1,
  value,
  onChange,
  suffix,
  disabled,
}: NumberFieldProps): React.JSX.Element {
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-text-muted">
        {label}
        {suffix ? ` (${suffix})` : ''}
      </label>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => {
          const next = Number(event.target.value)
          // An empty field parses as NaN. Leaving the value untouched keeps the
          // preview honest while someone is midway through retyping a number.
          if (Number.isNaN(next)) return
          onChange(next)
        }}
        className="mt-1 w-full rounded-md border border-border-strong bg-surface px-2 py-2 text-sm text-text focus-visible:outline-none focus-visible:shadow-ring disabled:opacity-50"
      />
    </div>
  )
}
