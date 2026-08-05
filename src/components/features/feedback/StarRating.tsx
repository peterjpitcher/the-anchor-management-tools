'use client'

import { useState } from 'react'
import { Star } from 'lucide-react'
import { cn } from '@/lib/utils'

interface StarRatingProps {
  value: number
  onChange: (n: number) => void
  max?: number
}

/**
 * Restyled onto the guest design system, logic untouched.
 *
 * The 44x44px button is the touch target and the 30px star is the mark inside
 * it. Focus is deliberately unstyled here: the gold ring comes from the
 * `.guest-theme :focus-visible` rule in globals.css, which is why the old
 * `focus-visible:ring-blue-500` is gone rather than recoloured.
 */
export function StarRating({ value, onChange, max = 5 }: StarRatingProps) {
  const [hovered, setHovered] = useState(0)

  function handleKeyDown(event: React.KeyboardEvent, n: number) {
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
            className="flex h-11 w-11 items-center justify-center rounded-guest-field"
          >
            {/*
              Lucide ships `fill="none" stroke="currentColor"` as presentation
              attributes. `fill-current` and `stroke-none` are CSS, which wins,
              turning the outline star into the solid one the design calls for.
            */}
            <Star
              aria-hidden="true"
              className={cn(
                'h-[30px] w-[30px] fill-current stroke-none transition-colors duration-200',
                active ? 'text-anchor-gold' : 'text-guest-border-strong'
              )}
            />
          </button>
        )
      })}
    </div>
  )
}
