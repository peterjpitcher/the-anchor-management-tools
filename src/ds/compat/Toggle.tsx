'use client'

/**
 * Toggle — backward-compatible wrapper for Switch
 * @deprecated Use Switch from ds/primitives instead
 *
 * The legacy Toggle passed a synthetic event-like object to onChange.
 * Switch passes a plain boolean. This wrapper bridges both APIs.
 */

import { Switch } from '../primitives/Switch'

interface ToggleProps {
  label?: string
  checked: boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onChange: (valueOrEvent: any) => void
  disabled?: boolean
  size?: 'sm' | 'md'
  className?: string
}

export function Toggle({ label, checked, onChange, disabled, size, className }: ToggleProps) {
  return (
    <Switch
      label={label}
      checked={checked}
      onChange={(newChecked: boolean) => {
        // Create a synthetic event-like object for legacy consumers
        // that access event.target.checked
        const syntheticEvent = {
          target: { checked: newChecked },
          currentTarget: { checked: newChecked },
        }
        onChange(syntheticEvent)
      }}
      disabled={disabled}
      size={size}
      className={className}
    />
  )
}
