'use client'

import { toast as hotToast, type ToastOptions } from 'react-hot-toast'
import { Icon } from '../icons'

type ToastStatus = 'success' | 'warning' | 'danger' | 'info'

/** Shared look for every toast. The root <Toaster> in src/app/layout.tsx uses the same values,
 * so a direct react-hot-toast call and this helper look alike. */
const defaultOpts: ToastOptions = {
  duration: 4000,
  style: {
    borderRadius: 'var(--radius-default)',
    padding: '12px 14px',
    fontSize: '0.875rem',
    maxWidth: '28rem',
    background: 'var(--color-surface)',
    color: 'var(--color-text)',
    border: '1px solid var(--color-border)',
    boxShadow: 'var(--shadow-lg)',
  },
}

/** Soft tint, readable -fg text and a matching border for a status toast. */
function statusStyle(status: ToastStatus): React.CSSProperties {
  return {
    background: `var(--color-${status}-soft)`,
    color: `var(--color-${status}-fg)`,
    border: `1px solid var(--color-${status}-border)`,
  }
}

function success(message: string, options?: ToastOptions) {
  return hotToast(message, {
    ...defaultOpts,
    ...options,
    icon: <Icon name="check" className="w-5 h-5 text-success" />,
    style: { ...defaultOpts.style, ...options?.style, ...statusStyle('success') },
  })
}

function error(message: string, options?: ToastOptions) {
  return hotToast(message, {
    ...defaultOpts,
    ...options,
    duration: options?.duration ?? 6000,
    icon: <Icon name="x" className="w-5 h-5 text-danger" />,
    style: { ...defaultOpts.style, ...options?.style, ...statusStyle('danger') },
  })
}

function warning(message: string, options?: ToastOptions) {
  return hotToast(message, {
    ...defaultOpts,
    ...options,
    icon: <Icon name="alertTriangle" className="w-5 h-5 text-warning" />,
    style: { ...defaultOpts.style, ...options?.style, ...statusStyle('warning') },
  })
}

function info(message: string, options?: ToastOptions) {
  return hotToast(message, {
    ...defaultOpts,
    ...options,
    icon: <Icon name="info" className="w-5 h-5 text-info" />,
    style: { ...defaultOpts.style, ...options?.style, ...statusStyle('info') },
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
