'use client'

import { forwardRef, useImperativeHandle, useRef, useState, useEffect, useCallback } from 'react'
import { Textarea, type TextareaProps } from '@/components/ui-v2/forms/Textarea'

export interface DebouncedTextareaRef {
  flush: () => void
}

interface DebouncedTextareaProps extends Omit<TextareaProps, 'value' | 'onChange'> {
  value: string
  onValueChange: (value: string) => void
  debounceMs?: number
}

const DebouncedTextarea = forwardRef<DebouncedTextareaRef, DebouncedTextareaProps>(
  function DebouncedTextarea({ value, onValueChange, debounceMs = 300, ...props }, ref) {
    const [localValue, setLocalValue] = useState(value)
    const timeoutRef = useRef<NodeJS.Timeout | null>(null)
    const latestLocalRef = useRef(localValue)

    // Sync local value with prop value if prop value changes externally
    useEffect(() => {
      setLocalValue(value)
    }, [value])

    useEffect(() => {
      latestLocalRef.current = localValue
    }, [localValue])

    const flush = useCallback(() => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
      if (latestLocalRef.current !== value) {
        onValueChange(latestLocalRef.current)
      }
    }, [value, onValueChange])

    useImperativeHandle(ref, () => ({ flush }), [flush])

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value
      setLocalValue(newValue)
      latestLocalRef.current = newValue

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
      timeoutRef.current = setTimeout(() => {
        onValueChange(newValue)
      }, debounceMs)
    }

    return <Textarea {...props} value={localValue} onChange={handleChange} />
  }
)

export default DebouncedTextarea
export { DebouncedTextarea }
export type { DebouncedTextareaProps }
