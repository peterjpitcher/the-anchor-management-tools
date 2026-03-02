import { useEffect, useState, useCallback, useRef } from 'react'

/**
 * Debounce a value
 * @param value The value to debounce
 * @param delay The delay in milliseconds
 * @returns The debounced value
 */
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value)

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value)
    }, delay)

    return () => {
      clearTimeout(handler)
    }
  }, [value, delay])

  return debouncedValue
}

/**
 * Debounce a callback function
 * @param callback The callback to debounce
 * @param delay The delay in milliseconds
 * @returns The debounced callback
 */
export function useDebouncedCallback<T extends (...args: any[]) => any>(
  callback: T,
  delay: number
): (...args: Parameters<T>) => void {
  const timeoutRef = useRef<NodeJS.Timeout | undefined>(undefined)
  const callbackRef = useRef(callback)

  // Update callback ref when callback changes
  useEffect(() => {
    callbackRef.current = callback
  }, [callback])

  const debouncedCallback = useCallback(
    (...args: Parameters<T>) => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }

      timeoutRef.current = setTimeout(() => {
        callbackRef.current(...args)
      }, delay)
    },
    [delay]
  )

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  return debouncedCallback
}

/**
 * Debounced search hook with loading state
 * @param searchFn The search function to call
 * @param delay The debounce delay in milliseconds
 * @returns Object with search input handler, results, loading state, and error
 */
export function useDebouncedSearch<T>(
  searchFn: (query: string) => Promise<T>,
  delay: number = 300
) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<T | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  
  const debouncedQuery = useDebounce(query, delay)

  useEffect(() => {
    if (!debouncedQuery) {
      setResults(null)
      return
    }

    let cancelled = false

    const performSearch = async () => {
      setLoading(true)
      setError(null)

      try {
        const data = await searchFn(debouncedQuery)
        if (!cancelled) {
          setResults(data)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error('Search failed'))
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    performSearch()

    return () => {
      cancelled = true
    }
  }, [debouncedQuery, searchFn])

  return {
    query,
    setQuery,
    results,
    loading,
    error,
    clearResults: () => setResults(null)
  }
}