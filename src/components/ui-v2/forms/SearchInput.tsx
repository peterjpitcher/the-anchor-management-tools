'use client'

/**
 * SearchInput Component
 * 
 * Used on 35/107 pages (33%)
 * 
 * Enhanced search input with debouncing, suggestions, and recent searches.
 * Provides consistent search experience across the application.
 */

import { InputHTMLAttributes, forwardRef, useState, useEffect, useRef, useCallback } from 'react'
import { cn } from '@/lib/utils'
import { MagnifyingGlassIcon, XMarkIcon } from '@heroicons/react/20/solid'
import { ClockIcon } from '@heroicons/react/24/outline'
import { Input } from './Input'
import { Spinner } from '../feedback/Spinner'
import { useDebounce } from '../hooks/useDebounce'

export interface SearchInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange'> {
  /**
   * Callback when search value changes (debounced)
   */
  onSearch: (value: string) => void
  
  /**
   * Debounce delay in milliseconds
   * @default 300
   */
  debounceDelay?: number
  
  /**
   * Whether to show loading state
   * @default false
   */
  loading?: boolean
  
  /**
   * Suggestions to show below input
   */
  suggestions?: string[]
  
  /**
   * Recent searches to show when focused
   */
  recentSearches?: string[]
  
  /**
   * Maximum recent searches to show
   * @default 5
   */
  maxRecentSearches?: number
  
  /**
   * Whether to show clear button
   * @default true
   */
  showClearButton?: boolean
  
  /**
   * Size of the input
   * @default 'md'
   */
  inputSize?: "sm" | "md" | "lg"
  
  /**
   * Visual variant
   * @default 'default'
   */
  variant?: 'default' | 'filled' | 'borderless'
  
  /**
   * Whether to auto-focus on mount
   * @default false
   */
  autoFocus?: boolean
  
  /**
   * Callback when a suggestion is selected
   */
  onSuggestionSelect?: (suggestion: string) => void
  
  /**
   * Callback when a recent search is selected
   */
  onRecentSearchSelect?: (search: string) => void
  
  /**
   * Whether to show voice search button (if supported)
   * @default false
   */
  showVoiceSearch?: boolean
  
  /**
   * Additional classes for the wrapper
   */
  wrapperClassName?: string
}

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(({
  onSearch,
  debounceDelay = 300,
  loading = false,
  suggestions = [],
  recentSearches = [],
  maxRecentSearches = 5,
  showClearButton = true,
  inputSize = 'md',
  variant = 'default',
  autoFocus = false,
  onSuggestionSelect,
  onRecentSearchSelect,
  showVoiceSearch = false,
  wrapperClassName,
  className,
  placeholder = 'Search...',
  value: controlledValue,
  defaultValue,
  ...props
}, ref) => {
  const [internalValue, setInternalValue] = useState(defaultValue || '')
  const [showDropdown, setShowDropdown] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  
  // Use controlled or uncontrolled value
  const value = controlledValue ?? internalValue
  
  // Debounced search value
  const debouncedValue = useDebounce(value, debounceDelay)
  
  // Trigger search when debounced value changes (only for uncontrolled components)
  useEffect(() => {
    if (controlledValue === undefined && (debouncedValue || debouncedValue === '')) {
      onSearch(String(debouncedValue))
    }
  }, [debouncedValue, onSearch, controlledValue])
  
  // Handle input change
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value
    if (controlledValue === undefined) {
      setInternalValue(newValue)
    } else {
      // For controlled component, call onSearch immediately to update parent state
      onSearch(newValue)
    }
    setShowDropdown(true)
    setSelectedIndex(-1)
  }
  
  // Handle clear
  const handleClear = () => {
    if (controlledValue === undefined) {
      setInternalValue('')
      onSearch('')
    } else {
      // Emit empty value and let parent clear
      onSearch('')
    }
    setShowDropdown(false)
    setSelectedIndex(-1)
    inputRef.current?.focus()
  }
  
  // Handle suggestion/recent search selection
  const handleSelect = (text: string, isRecent: boolean) => {
    if (controlledValue === undefined) {
      setInternalValue(text)
    }
    
    if (isRecent) {
      onRecentSearchSelect?.(text)
    } else {
      onSuggestionSelect?.(text)
    }
    
    onSearch(text)
    setShowDropdown(false)
    inputRef.current?.focus()
  }
  
  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    const items = [...(value ? suggestions : recentSearches.slice(0, maxRecentSearches))]
    
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setSelectedIndex(prev => 
          prev < items.length - 1 ? prev + 1 : prev
        )
        break
        
      case 'ArrowUp':
        e.preventDefault()
        setSelectedIndex(prev => prev > -1 ? prev - 1 : -1)
        break
        
      case 'Enter':
        if (selectedIndex >= 0 && selectedIndex < items.length) {
          e.preventDefault()
          handleSelect(items[selectedIndex], !value)
        }
        break
        
      case 'Escape':
        setShowDropdown(false)
        setSelectedIndex(-1)
        break
    }
  }
  
  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])
  
  // Voice search support
  const supportsVoiceSearch = typeof window !== 'undefined' && 
    'webkitSpeechRecognition' in window || 'SpeechRecognition' in window
  
  const handleVoiceSearch = () => {
    if (!supportsVoiceSearch) return
    
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    const recognition = new SpeechRecognition()
    
    recognition.lang = 'en-US'
    recognition.interimResults = false
    recognition.maxAlternatives = 1
    
    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript
      if (controlledValue === undefined) {
        setInternalValue(transcript)
      }
      onSearch(transcript)
    }
    
    recognition.start()
  }
  
  // Items to show in dropdown
  const dropdownItems = value ? suggestions : recentSearches.slice(0, maxRecentSearches)
  const showDropdownContent = showDropdown && dropdownItems.length > 0
  
  // Combine refs
  const setRefs = useCallback((node: HTMLInputElement | null) => {
    if (inputRef && 'current' in inputRef) {
      (inputRef as React.MutableRefObject<HTMLInputElement | null>).current = node
    }
    if (typeof ref === 'function') {
      ref(node)
    } else if (ref && 'current' in ref) {
      (ref as React.MutableRefObject<HTMLInputElement | null>).current = node
    }
  }, [ref])
  
  return (
    <div className={cn('relative', wrapperClassName)} ref={dropdownRef}>
      <div className="relative">
        <Input
          ref={setRefs}
          type="search"
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => setShowDropdown(true)}
          placeholder={placeholder}
          inputSize={inputSize}
          variant={variant}
          leftIcon={<MagnifyingGlassIcon />}
          rightIcon={
            loading ? (
              <Spinner size="sm" />
            ) : value && showClearButton ? (
              <button
                type="button"
                onClick={handleClear}
                className="text-gray-400 hover:text-gray-500 focus:outline-none"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            ) : showVoiceSearch && supportsVoiceSearch && !value ? (
              <button
                type="button"
                onClick={handleVoiceSearch}
                className="text-gray-400 hover:text-gray-500 focus:outline-none"
                aria-label="Voice search"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
              </button>
            ) : null
          }
          autoFocus={autoFocus}
          autoComplete="off"
          className={className}
          {...props}
        />
      </div>
      
      {/* Dropdown */}
      {showDropdownContent && (
        <div className="absolute z-10 mt-1 w-full bg-white shadow-lg rounded-md border border-gray-200 py-1 max-h-60 overflow-auto">
          {value ? (
            // Suggestions
            suggestions.map((suggestion, index) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => handleSelect(suggestion, false)}
                className={cn(
                  'w-full text-left px-4 py-2 text-sm',
                  'hover:bg-gray-100 focus:bg-gray-100 focus:outline-none',
                  selectedIndex === index && 'bg-gray-100'
                )}
              >
                <div className="flex items-center">
                  <MagnifyingGlassIcon className="h-4 w-4 text-gray-400 mr-3 flex-shrink-0" />
                  <span className="truncate">{suggestion}</span>
                </div>
              </button>
            ))
          ) : (
            // Recent searches
            <>
              {recentSearches.length > 0 && (
                <div className="px-4 py-2 text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Recent Searches
                </div>
              )}
              {recentSearches.slice(0, maxRecentSearches).map((search, index) => (
                <button
                  key={search}
                  type="button"
                  onClick={() => handleSelect(search, true)}
                  className={cn(
                    'w-full text-left px-4 py-2 text-sm',
                    'hover:bg-gray-100 focus:bg-gray-100 focus:outline-none',
                    selectedIndex === index && 'bg-gray-100'
                  )}
                >
                  <div className="flex items-center">
                    <ClockIcon className="h-4 w-4 text-gray-400 mr-3 flex-shrink-0" />
                    <span className="truncate">{search}</span>
                  </div>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
})

SearchInput.displayName = 'SearchInput'

/**
 * SearchBar - Search input with button
 */
export function SearchBar({
  onSearch,
  buttonLabel = 'Search',
  className,
  ...props
}: SearchInputProps & {
  buttonLabel?: string
}) {
  const [value, setValue] = useState('')
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSearch(value)
  }
  
  // Handle value change from SearchInput
  const handleSearchChange = (searchValue: string) => {
    setValue(searchValue)
    // Don't trigger onSearch here, wait for form submit
  }
  
  return (
    <form onSubmit={handleSubmit} className={cn('flex gap-2', className)}>
      <SearchInput
        value={value}
        onSearch={handleSearchChange}
        debounceDelay={0} // No debounce for SearchBar
        showClearButton={false}
        className="flex-1"
        {...props}
      />
      <button
        type="submit"
        className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
      >
        {buttonLabel}
      </button>
    </form>
  )
}

/**
 * GlobalSearch - Full-featured global search
 */
export function GlobalSearch({
  placeholder = 'Search everything...',
  categories = [],
  onCategoryChange,
  className,
  ...props
}: SearchInputProps & {
  categories?: Array<{ value: string; label: string }>
  onCategoryChange?: (category: string) => void
}) {
  const [selectedCategory, setSelectedCategory] = useState('all')
  
  const handleCategoryChange = (category: string) => {
    setSelectedCategory(category)
    onCategoryChange?.(category)
  }
  
  return (
    <div className={cn('flex items-center gap-2', className)}>
      {categories.length > 0 && (
        <select
          value={selectedCategory}
          onChange={(e) => handleCategoryChange(e.target.value)}
          className="rounded-md border-gray-300 text-sm focus:border-green-500 focus:ring-green-500"
        >
          <option value="all">All</option>
          {categories.map((cat) => (
            <option key={cat.value} value={cat.value}>
              {cat.label}
            </option>
          ))}
        </select>
      )}
      <SearchInput
        placeholder={placeholder}
        className="flex-1"
        {...props}
      />
    </div>
  )
}
