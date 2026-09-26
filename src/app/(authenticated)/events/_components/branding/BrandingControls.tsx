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
 * 2. The 44px touch floor is met by the DS Modal, which lifts real buttons to
 *    44px on touch screens. Never swap a button for a div, which would throw
 *    away the keyboard semantics the picker depends on.
 */

import { Field, Input, Segmented } from '@/ds'

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

/**
 * A pick-one row of buttons: the DS Segmented control, which is a radio group of real buttons.
 * Segmented takes no name of its own, so the wrapping group carries it. Inside the DS Modal the
 * buttons get the 44px touch floor on touch screens.
 */
export function OptionButtons<T extends string>({
  label,
  options,
  value,
  onChange,
  className,
}: OptionButtonsProps<T>): React.JSX.Element {
  return (
    <div role="group" aria-label={label}>
      <Segmented
        options={options.map((option) => ({ id: option.value, label: option.label }))}
        value={value}
        onChange={(id) => onChange(id as T)}
        className={className}
      />
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

/**
 * The DS has no slider, so the native range input stays, labelled by a DS Field. The current
 * value sits at the right of the label row.
 */
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
    <div className="relative">
      <Field label={label} hint={hint}>
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(Number(event.target.value))}
          className="w-full accent-primary disabled:opacity-50"
        />
      </Field>
      <output htmlFor={id} className="absolute right-0 top-0 text-xs tabular-nums text-text-muted">
        {valueLabel}
      </output>
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
    <Input
      id={id}
      label={`${label}${suffix ? ` (${suffix})` : ''}`}
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
    />
  )
}
