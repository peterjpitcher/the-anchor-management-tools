'use client'

/**
 * useDebounce Hook
 * 
 * Delays updating a value until after a specified delay.
 * Useful for search inputs and other performance optimizations.
 */

import { useEffect, useState } from 'react'

export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value)

  useEffect(() => {
    // Update debounced value after delay
    const handler = setTimeout(() => {
      setDebouncedValue(value)
    }, delay)

    // Cancel timeout if value changes (or component unmounts)
    return () => {
      clearTimeout(handler)
    }
  }, [value, delay])

  return debouncedValue
}