'use client'

/**
 * DebouncedTextarea — backward-compatible wrapper
 * @deprecated Use ds/Textarea with external debounce instead
 */

import { forwardRef, useRef, useCallback, useImperativeHandle, useEffect } from 'react'
import { Textarea } from '../primitives/Textarea'

export interface DebouncedTextareaRef {
  getValue: () => string
  setValue: (value: string) => void
  flush: () => void
}

export interface DebouncedTextareaProps {
  value?: string
  defaultValue?: string
  onChange?: (value: string) => void
  /** @deprecated Use `onChange` instead */
  onValueChange?: (value: string) => void
  delay?: number
  placeholder?: string
  rows?: number
  maxRows?: number
  maxLength?: number
  className?: string
  disabled?: boolean
  label?: string
  error?: string | boolean
  hint?: string
  autoFocus?: boolean
  id?: string
  /** @deprecated Accepted for backward compatibility */
  fullWidth?: boolean
}

export const DebouncedTextarea = forwardRef<DebouncedTextareaRef, DebouncedTextareaProps>(
  ({ value, defaultValue, onChange, onValueChange, delay = 300, placeholder, rows, maxRows: _mr, maxLength, className, disabled, label, error, hint, autoFocus, id, fullWidth: _fw }, ref) => {
    const resolvedOnChange = onChange ?? onValueChange
    const internalRef = useRef<HTMLTextAreaElement>(null)
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const latestValue = useRef(value ?? defaultValue ?? '')

    useImperativeHandle(ref, () => ({
      getValue: () => latestValue.current,
      setValue: (v: string) => {
        latestValue.current = v
        if (internalRef.current) internalRef.current.value = v
      },
      flush: () => {
        if (timerRef.current) {
          clearTimeout(timerRef.current)
          timerRef.current = null
        }
        resolvedOnChange?.(latestValue.current)
      },
    }))

    useEffect(() => {
      return () => {
        if (timerRef.current) clearTimeout(timerRef.current)
      }
    }, [])

    const handleChange = useCallback(
      (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const val = e.target.value
        latestValue.current = val
        if (timerRef.current) clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => {
          resolvedOnChange?.(val)
        }, delay)
      },
      [resolvedOnChange, delay],
    )

    return (
      <Textarea
        ref={internalRef}
        id={id}
        defaultValue={value ?? defaultValue}
        onChange={handleChange}
        placeholder={placeholder}
        rows={rows}
        maxLength={maxLength}
        className={className}
        disabled={disabled}
        label={label}
        error={error}
        hint={hint}
        autoFocus={autoFocus}
      />
    )
  },
)

DebouncedTextarea.displayName = 'DebouncedTextarea'
