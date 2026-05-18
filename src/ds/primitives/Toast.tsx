'use client'

import { useEffect, useCallback } from 'react'
import { toast as hotToast, type ToastOptions } from 'react-hot-toast'
import { cn } from '@/lib/utils'
import { Icon } from '../icons'

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

const defaultOpts: ToastOptions = {
  duration: 4000,
  style: {
    borderRadius: '0.5rem',
    padding: '1rem',
    fontSize: '0.875rem',
    maxWidth: '28rem',
    background: 'var(--color-surface)',
    color: 'var(--color-text)',
    border: '1px solid var(--color-border)',
  },
}

function success(message: string, options?: ToastOptions) {
  return hotToast(message, {
    ...defaultOpts,
    ...options,
    icon: <Icon name="check" className="w-5 h-5 text-success" />,
    style: {
      ...defaultOpts.style,
      ...options?.style,
      background: 'var(--color-success-surface, #f0fdf4)',
      color: 'var(--color-success-text, #166534)',
      border: '1px solid var(--color-success-border, #bbf7d0)',
    },
  })
}

function error(message: string, options?: ToastOptions) {
  return hotToast(message, {
    ...defaultOpts,
    ...options,
    duration: options?.duration ?? 6000,
    icon: <Icon name="x" className="w-5 h-5 text-danger" />,
    style: {
      ...defaultOpts.style,
      ...options?.style,
      background: 'var(--color-danger-surface, #fef2f2)',
      color: 'var(--color-danger-text, #991b1b)',
      border: '1px solid var(--color-danger-border, #fecaca)',
    },
  })
}

function warning(message: string, options?: ToastOptions) {
  return hotToast(message, {
    ...defaultOpts,
    ...options,
    icon: <Icon name="alertTriangle" className="w-5 h-5 text-warning" />,
    style: {
      ...defaultOpts.style,
      ...options?.style,
      background: 'var(--color-warning-surface, #fffbeb)',
      color: 'var(--color-warning-text, #92400e)',
      border: '1px solid var(--color-warning-border, #fde68a)',
    },
  })
}

function info(message: string, options?: ToastOptions) {
  return hotToast(message, {
    ...defaultOpts,
    ...options,
    icon: <Icon name="info" className="w-5 h-5 text-info" />,
    style: {
      ...defaultOpts.style,
      ...options?.style,
      background: 'var(--color-info-surface, #eff6ff)',
      color: 'var(--color-info-text, #1e40af)',
      border: '1px solid var(--color-info-border, #bfdbfe)',
    },
  })
}

function loading(message: string, options?: ToastOptions) {
  return hotToast.loading(message, { ...defaultOpts, ...options })
}

function dismiss(toastId?: string) {
  hotToast.dismiss(toastId)
}

export const toast = {
  success,
  error,
  warning,
  info,
  loading,
  dismiss,
}
