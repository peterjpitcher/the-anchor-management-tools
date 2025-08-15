'use client'

import React from 'react'
import { MagnifyingGlassIcon, XMarkIcon } from '@heroicons/react/24/outline'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'

interface SearchInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  value: string
  onValueChange: (value: string) => void
  loading?: boolean
  onClear?: () => void
  containerClassName?: string
  iconClassName?: string
}

export function SearchInput({
  value,
  onValueChange,
  loading = false,
  onClear,
  className,
  containerClassName,
  iconClassName,
  placeholder = 'Search...',
  disabled,
  ...props
}: SearchInputProps) {
  const handleClear = () => {
    onValueChange('')
    onClear?.()
  }

  return (
    <div className={cn('relative', containerClassName)}>
      <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
        {loading ? (
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600" />
        ) : (
          <MagnifyingGlassIcon className={cn('h-5 w-5 text-gray-400', iconClassName)} />
        )}
      </div>
      
      <input
        type="search"
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        className={cn(
          'block w-full rounded-md border border-gray-300 bg-white py-2 pl-10 pr-10',
          'text-sm placeholder-gray-500',
          'focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500',
          'disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500',
          'min-h-[44px]', // Mobile touch target
          className
        )}
        placeholder={placeholder}
        disabled={disabled}
        {...props}
      />
      
      {value && !loading && (
        <button
          type="button"
          onClick={handleClear}
          className="absolute inset-y-0 right-0 flex items-center pr-3 hover:text-gray-600"
          disabled={disabled}
        >
          <XMarkIcon className="h-5 w-5 text-gray-400" />
        </button>
      )}
    </div>
  )
}

// Mobile-optimized search with suggestions
interface SearchWithSuggestionsProps {
  value: string
  onValueChange: (value: string) => void
  suggestions?: string[]
  onSuggestionSelect?: (suggestion: string) => void
  loading?: boolean
  className?: string
  placeholder?: string
}

export function SearchWithSuggestions({
  value,
  onValueChange,
  suggestions = [],
  onSuggestionSelect,
  loading = false,
  className,
  placeholder = 'Search...'
}: SearchWithSuggestionsProps) {
  const [showSuggestions, setShowSuggestions] = React.useState(false)
  const containerRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setShowSuggestions(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleSelect = (suggestion: string) => {
    onValueChange(suggestion)
    onSuggestionSelect?.(suggestion)
    setShowSuggestions(false)
  }

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <SearchInput
        value={value}
        onValueChange={onValueChange}
        loading={loading}
        onFocus={() => setShowSuggestions(true)}
        placeholder={placeholder}
      />
      
      {showSuggestions && suggestions.length > 0 && (
        <div className="absolute top-full left-0 right-0 z-50 mt-1 max-h-60 overflow-auto rounded-md bg-white py-1 shadow-lg ring-1 ring-black ring-opacity-5">
          {suggestions.map((suggestion, index) => (
            <button
              key={index}
              type="button"
              onClick={() => handleSelect(suggestion)}
              className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 focus:bg-gray-100 focus:outline-none"
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// Search loading skeleton
export function SearchSkeleton() {
  return <Skeleton className="h-11 w-full rounded-md" />
}