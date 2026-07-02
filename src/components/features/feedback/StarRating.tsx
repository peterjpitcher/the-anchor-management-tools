'use client'

import { useState } from 'react'

interface StarRatingProps {
  value: number
  onChange: (n: number) => void
  max?: number
}

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
    <div className="flex items-center gap-1" role="group" aria-label="Star rating">
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
            className="flex h-11 w-11 items-center justify-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1"
          >
            <svg
              viewBox="0 0 24 24"
              className={`h-8 w-8 ${active ? 'text-yellow-400' : 'text-gray-300'}`}
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M12 2.5l2.9 5.88 6.49.94-4.7 4.58 1.11 6.46L12 17.77 6.2 20.36l1.11-6.46-4.7-4.58 6.49-.94L12 2.5z" />
            </svg>
          </button>
        )
      })}
    </div>
  )
}
