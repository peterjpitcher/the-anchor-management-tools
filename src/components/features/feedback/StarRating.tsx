'use client'

import { useState } from 'react'
import { Icon } from '@/ds/icons'
import { cn } from '@/lib/utils'

type StarRatingTone = 'guest' | 'staff'

interface StarRatingProps {
  value: number
  /** Called with the chosen rating. Leave it out for a read-only display of `value`. */
  onChange?: (n: number) => void
  max?: number
  /**
   * 'guest' (the default) is the public feedback page, drawn on the guest design system.
   * 'staff' uses the staff tokens, for staff screens such as the feedback inbox.
   */
  tone?: StarRatingTone
}

/*
 * One whole class string per tone and part (UI_UX rule 10). Guest focus is deliberately
 * unstyled: the gold ring comes from the `.guest-theme :focus-visible` rule in globals.css.
 * Staff buttons use the staff focus pattern.
 */
const TONE_STYLES: Record<StarRatingTone, { button: string; filled: string; empty: string }> = {
  guest: {
    button: 'flex h-11 w-11 items-center justify-center rounded-guest-field',
    filled: 'text-anchor-gold',
    empty: 'text-guest-border-strong',
  },
  staff: {
    button:
      'flex h-11 w-11 items-center justify-center rounded-default focus-visible:outline-hidden focus-visible:shadow-ring',
    filled: 'text-warning',
    empty: 'text-text-subtle',
  },
}

/**
 * Restyled onto the guest design system, logic untouched.
 *
 * The 44x44px button is the touch target and the 30px star is the mark inside
 * it. With no `onChange` the stars are a read-only picture of the rating: 16px,
 * no buttons, and one accessible name for the whole row.
 */
export function StarRating({ value, onChange, max = 5, tone = 'guest' }: StarRatingProps): React.JSX.Element {
  const [hovered, setHovered] = useState(0)
  const styles = TONE_STYLES[tone]

  /*
   * The DS icon ships `fill="none" stroke="currentColor"` as presentation
   * attributes. `fill-current` and `stroke-none` are CSS, which wins,
   * turning the outline star into the solid one the design calls for.
   */
  const star = (active: boolean, size: number): React.JSX.Element => (
    <Icon
      name="star"
      size={size}
      className={cn('fill-current stroke-none transition-colors duration-200', active ? styles.filled : styles.empty)}
    />
  )

  if (!onChange) {
    const shown = Math.max(0, Math.min(max, Math.round(value)))
    return (
      <span className="inline-flex items-center gap-0.5" role="img" aria-label={`${shown} out of ${max} stars`}>
        {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
          <span key={n} aria-hidden="true" className="inline-flex">
            {star(shown >= n, 16)}
          </span>
        ))}
      </span>
    )
  }

  function handleKeyDown(event: React.KeyboardEvent, n: number) {
    if (!onChange) return
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      event.preventDefault()
      onChange(Math.min(max, n + 1))
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      event.preventDefault()
      onChange(Math.max(1, n - 1))
    }
  }

  return (
    <div className="flex items-center gap-0.5" role="group" aria-label="Star rating">
      {Array.from({ length: max }, (_, i) => i + 1).map((n) => {
        const active = (hovered || value) >= n
        return (
          <button
            key={n}
            type="button"
            aria-label={`${n} star${n > 1 ? 's' : ''}`}
            aria-pressed={value === n}
            onClick={() => onChange(n)}
            onMouseEnter={() => setHovered(n)}
            onMouseLeave={() => setHovered(0)}
            onFocus={() => setHovered(n)}
            onBlur={() => setHovered(0)}
            onKeyDown={(event) => handleKeyDown(event, n)}
            className={styles.button}
          >
            {star(active, 30)}
          </button>
        )
      })}
    </div>
  )
}
