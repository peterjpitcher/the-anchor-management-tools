'use client'

import { useState, useEffect, useRef, ChangeEvent } from 'react'
import { Textarea, TextareaProps } from '@/components/ui-v2/forms/Textarea'

export interface DebouncedTextareaProps extends Omit<TextareaProps, 'onChange'> {
  value: string
  onValueChange: (value: string) => void
  debounceMs?: number
}

export function DebouncedTextarea({
  value: initialValue,
  onValueChange,
  debounceMs = 300,
  ...props
}: DebouncedTextareaProps) {
  const [localValue, setLocalValue] = useState(initialValue)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Sync local value with prop value if prop value changes externally
  useEffect(() => {
    setLocalValue(initialValue)
  }, [initialValue])

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value
    setLocalValue(newValue)

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }

    timeoutRef.current = setTimeout(() => {
      onValueChange(newValue)
    }, debounceMs)
  }

  return (
    <Textarea
      {...props}
      value={localValue}
      onChange={handleChange}
    />
  )
}
