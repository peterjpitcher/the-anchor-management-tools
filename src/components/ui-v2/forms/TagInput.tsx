'use client'

/**
 * TagInput Component
 * 
 * Input field for managing tags with autocomplete and validation.
 * Supports custom rendering, keyboard navigation, and paste handling.
 */

import { useState, useRef, KeyboardEvent, ClipboardEvent, forwardRef, ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { XMarkIcon } from '@heroicons/react/20/solid'
import { Input } from './Input'
import { Badge } from '../display/Badge'

export interface TagInputProps {
  /**
   * Current tags
   */
  value?: string[]
  
  /**
   * Callback when tags change
   */
  onChange?: (tags: string[]) => void
  
  /**
   * Placeholder text
   * @default 'Add tags...'
   */
  placeholder?: string
  
  /**
   * Suggested tags
   */
  suggestions?: string[]
  
  /**
   * Maximum number of tags
   */
  maxTags?: number
  
  /**
   * Maximum tag length
   */
  maxLength?: number
  
  /**
   * Delimiter for parsing pasted text
   * @default ','
   */
  delimiter?: string | RegExp
  
  /**
   * Whether tags must be unique
   * @default true
   */
  unique?: boolean
  
  /**
   * Validation function
   */
  validate?: (tag: string) => boolean | string
  
  /**
   * Transform function (e.g., lowercase)
   */
  transform?: (tag: string) => string
  
  /**
   * Whether to allow custom tags (not in suggestions)
   * @default true
   */
  allowCustom?: boolean
  
  /**
   * Whether input is disabled
   * @default false
   */
  disabled?: boolean
  
  /**
   * Whether input has error
   * @default false
   */
  error?: boolean
  
  /**
   * Size variant
   * @default 'md'
   */
  size?: 'sm' | 'md' | 'lg'
  
  /**
   * Tag variant
   * @default 'secondary'
   */
  tagVariant?: 'default' | 'secondary' | 'success' | 'warning' | 'error'
  
  /**
   * Custom tag renderer
   */
  renderTag?: (tag: string, index: number, onRemove: () => void) => ReactNode
  
  /**
   * Additional container classes
   */
  className?: string
  
  /**
   * Additional input classes
   */
  inputClassName?: string
  
  /**
   * Callback when input is focused
   */
  onFocus?: () => void
  
  /**
   * Callback when input is blurred
   */
  onBlur?: () => void
  
  /**
   * Whether to show count
   * @default false
   */
  showCount?: boolean
  
  /**
   * Helper text
   */
  helperText?: ReactNode
}

export const TagInput = forwardRef<HTMLInputElement, TagInputProps>(({
  value = [],
  onChange,
  placeholder = 'Add tags...',
  suggestions = [],
  maxTags,
  maxLength,
  delimiter = ',',
  unique = true,
  validate,
  transform,
  allowCustom = true,
  disabled = false,
  error = false,
  size = 'md',
  tagVariant = 'secondary',
  renderTag,
  className,
  inputClassName,
  onFocus,
  onBlur,
  showCount = false,
  helperText,
}, ref) => {
  const [inputValue, setInputValue] = useState('')
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [selectedSuggestion, setSelectedSuggestion] = useState(-1)
  const [validationError, setValidationError] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  
  // Filter suggestions
  const filteredSuggestions = suggestions.filter(suggestion =>
    suggestion.toLowerCase().includes(inputValue.toLowerCase()) &&
    (!unique || !value.includes(suggestion))
  )
  
  // Add tag
  const addTag = (tag: string) => {
    // Transform
    const transformedTag = transform ? transform(tag) : tag.trim()
    
    if (!transformedTag) return
    
    // Check max tags
    if (maxTags && value.length >= maxTags) {
      setValidationError(`Maximum ${maxTags} tags allowed`)
      return
    }
    
    // Check max length
    if (maxLength && transformedTag.length > maxLength) {
      setValidationError(`Tag must be ${maxLength} characters or less`)
      return
    }
    
    // Check unique
    if (unique && value.includes(transformedTag)) {
      setValidationError('Tag already exists')
      return
    }
    
    // Validate
    if (validate) {
      const result = validate(transformedTag)
      if (typeof result === 'string') {
        setValidationError(result)
        return
      }
      if (!result) {
        setValidationError('Invalid tag')
        return
      }
    }
    
    // Check if custom allowed
    if (!allowCustom && !suggestions.includes(transformedTag)) {
      setValidationError('Please select from suggestions')
      return
    }
    
    // Add tag
    onChange?.([...value, transformedTag])
    setInputValue('')
    setValidationError(null)
    setShowSuggestions(false)
  }
  
  // Remove tag
  const removeTag = (index: number) => {
    if (disabled) return
    const newTags = [...value]
    newTags.splice(index, 1)
    onChange?.(newTags)
  }
  
  // Handle key down
  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      
      if (showSuggestions && selectedSuggestion >= 0 && selectedSuggestion < filteredSuggestions.length) {
        addTag(filteredSuggestions[selectedSuggestion])
        setSelectedSuggestion(-1)
      } else if (inputValue) {
        addTag(inputValue)
      }
    } else if (e.key === 'Backspace' && !inputValue && value.length > 0) {
      removeTag(value.length - 1)
    } else if (e.key === 'ArrowDown' && showSuggestions) {
      e.preventDefault()
      setSelectedSuggestion(prev => 
        prev < filteredSuggestions.length - 1 ? prev + 1 : prev
      )
    } else if (e.key === 'ArrowUp' && showSuggestions) {
      e.preventDefault()
      setSelectedSuggestion(prev => prev > 0 ? prev - 1 : -1)
    } else if (e.key === 'Escape') {
      setShowSuggestions(false)
      setSelectedSuggestion(-1)
    }
  }
  
  // Handle paste
  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault()
    const pastedText = e.clipboardData.getData('text')
    const tags = pastedText.split(delimiter).map(tag => tag.trim()).filter(Boolean)
    
    tags.forEach(tag => {
      if (!maxTags || value.length < maxTags) {
        addTag(tag)
      }
    })
  }
  
  // Handle input change
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setInputValue(value)
    setValidationError(null)
    setShowSuggestions(value.length > 0 && filteredSuggestions.length > 0)
    setSelectedSuggestion(-1)
  }
  
  // Handle focus
  const handleFocus = () => {
    onFocus?.()
    if (inputValue && filteredSuggestions.length > 0) {
      setShowSuggestions(true)
    }
  }
  
  // Handle blur
  const handleBlur = () => {
    onBlur?.()
    // Delay to allow clicking suggestions
    setTimeout(() => {
      setShowSuggestions(false)
      setSelectedSuggestion(-1)
    }, 200)
  }
  
  // Size classes
  const sizeClasses = {
    sm: 'min-h-[32px] gap-1.5 p-1.5',
    md: 'min-h-[40px] gap-2 p-2',
    lg: 'min-h-[48px] gap-2.5 p-2.5',
  }
  
  return (
    <div className={cn('space-y-1', className)}>
      {/* Tags container */}
      <div
        ref={containerRef}
        onClick={() => !disabled && containerRef.current?.querySelector('input')?.focus()}
        className={cn(
          'flex flex-wrap items-center rounded-md border transition-colors cursor-text',
          sizeClasses[size],
          error || validationError
            ? 'border-red-300 focus-within:border-red-500 focus-within:ring-red-500'
            : 'border-gray-300 focus-within:border-green-500 focus-within:ring-green-500',
          'focus-within:ring-2 focus-within:ring-opacity-20',
          disabled && 'opacity-50 cursor-not-allowed bg-gray-50'
        )}
      >
        {/* Tags */}
        {value.map((tag, index) => (
          <div key={index} className="flex-shrink-0">
            {renderTag ? (
              renderTag(tag, index, () => removeTag(index))
            ) : (
              <Badge
                variant={tagVariant}
                size={size === 'sm' ? 'sm' : 'md'}
                removable={!disabled}
                onRemove={() => removeTag(index)}
              >
                {tag}
              </Badge>
            )}
          </div>
        ))}
        
        {/* Input */}
        {(!maxTags || value.length < maxTags) && (
          <div className="relative flex-1 min-w-[100px]">
            <input
              ref={ref}
              type="text"
              value={inputValue}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              onFocus={handleFocus}
              onBlur={handleBlur}
              placeholder={value.length === 0 ? placeholder : ''}
              disabled={disabled}
              className={cn(
                'w-full bg-transparent border-0 outline-none placeholder-gray-400',
                size === 'sm' && 'text-sm',
                size === 'lg' && 'text-lg',
                'focus:ring-0',
                inputClassName
              )}
            />
            
            {/* Suggestions dropdown */}
            {showSuggestions && (
              <div className="absolute top-full left-0 right-0 mt-1 max-h-48 overflow-auto rounded-md bg-white shadow-lg ring-1 ring-black ring-opacity-5 z-10">
                {filteredSuggestions.map((suggestion, index) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => {
                      addTag(suggestion)
                      setSelectedSuggestion(-1)
                    }}
                    className={cn(
                      'w-full px-3 py-2 text-left text-sm hover:bg-gray-100',
                      selectedSuggestion === index && 'bg-gray-100'
                    )}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        
        {/* Count */}
        {showCount && maxTags && (
          <div className="flex-shrink-0 text-sm text-gray-500">
            {value.length}/{maxTags}
          </div>
        )}
      </div>
      
      {/* Helper text or error */}
      {(helperText || validationError) && (
        <p className={cn(
          'text-sm',
          validationError ? 'text-red-600' : 'text-gray-500'
        )}>
          {validationError || helperText}
        </p>
      )}
    </div>
  )
})

TagInput.displayName = 'TagInput'

/**
 * EmailTagInput - Tag input optimized for email addresses
 */
export const EmailTagInput = forwardRef<HTMLInputElement, Omit<TagInputProps, 'validate' | 'transform'>>((
  props,
  ref
) => {
  const validateEmail = (email: string) => {
    const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    return regex.test(email) || 'Invalid email address'
  }
  
  return (
    <TagInput
      ref={ref}
      placeholder="Add email addresses..."
      validate={validateEmail}
      transform={(email) => email.toLowerCase().trim()}
      delimiter={/[,;\s]+/}
      {...props}
    />
  )
})

EmailTagInput.displayName = 'EmailTagInput'

/**
 * SkillTagInput - Tag input for skills with predefined options
 */
export function SkillTagInput({
  skills = [],
  ...props
}: {
  skills?: string[]
} & Omit<TagInputProps, 'suggestions'>) {
  return (
    <TagInput
      placeholder="Add skills..."
      suggestions={skills}
      tagVariant="success"
      transform={(skill) => skill.charAt(0).toUpperCase() + skill.slice(1).toLowerCase()}
      {...props}
    />
  )
}