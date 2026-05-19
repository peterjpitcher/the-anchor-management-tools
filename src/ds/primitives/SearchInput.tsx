'use client'

import { cn } from '@/lib/utils'
import { Input } from './Input'

interface SearchInputProps {
  value?: string
  /** @deprecated Use `value` + `onChange` instead */
  defaultValue?: string
  onChange?: (v: string) => void
  /** @deprecated Use `onChange` instead */
  onSearch?: (v: string) => void
  /** @deprecated Accepted for backward compatibility */
  debounceDelay?: number
  /** @deprecated Accepted for backward compatibility */
  loading?: boolean
  placeholder?: string
  className?: string
}

const SearchIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.35-4.35" />
  </svg>
)

const ClearIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </svg>
)

export function SearchInput({
  value: valueProp,
  defaultValue,
  onChange,
  onSearch,
  debounceDelay: _debounce,
  loading: _loading,
  placeholder = 'Search...',
  className,
}: SearchInputProps) {
  const handleChange = onChange ?? onSearch ?? (() => {})
  const value = valueProp ?? defaultValue ?? ''
  return (
    <div className={cn('relative', className)}>
      <Input
        icon={<SearchIcon />}
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        placeholder={placeholder}
      />
      {value && (
        <button
          type="button"
          onClick={() => handleChange('')}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-text-subtle hover:text-text transition-colors"
          aria-label="Clear search"
        >
          <ClearIcon />
        </button>
      )}
    </div>
  )
}
