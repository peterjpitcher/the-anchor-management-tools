'use client'

import { useEffect, useCallback } from 'react'
import { cn } from '@/lib/utils'

type ToastTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral'

interface ToastProps {
  tone?: ToastTone
  message: string
  visible: boolean
  onDismiss?: () => void
  duration?: number
}

const dotToneStyles: Record<ToastTone, string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
  neutral: 'bg-text-muted',
}

export function Toast({
  tone = 'neutral',
  message,
  visible,
  onDismiss,
  duration = 4000,
}: ToastProps) {
  const handleDismiss = useCallback(() => {
    onDismiss?.()
  }, [onDismiss])

  useEffect(() => {
    if (!visible || !onDismiss) return

    const timer = setTimeout(handleDismiss, duration)
    return () => clearTimeout(timer)
  }, [visible, duration, handleDismiss, onDismiss])

  if (!visible) return null

  return (
    <div
      className={cn(
        'fixed bottom-4 right-4 z-50',
        'bg-surface shadow-lg rounded-lg border border-border px-4 py-3',
        'flex items-center gap-3',
        'animate-[toast-slide-up_200ms_ease-out]'
      )}
      role="status"
      aria-live="polite"
    >
      <span
        className={cn('inline-block w-2 h-2 rounded-full shrink-0', dotToneStyles[tone])}
        aria-hidden="true"
      />
      <span className="text-sm text-text">{message}</span>
    </div>
  )
}
