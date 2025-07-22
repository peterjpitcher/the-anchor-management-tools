/**
 * Toast Component
 * 
 * Used on 107/107 pages (100%)
 * 
 * Wrapper around react-hot-toast that provides consistent styling
 * and behavior across the application.
 */

import { toast as hotToast, Toaster as HotToaster, ToastOptions } from 'react-hot-toast'
import { CheckCircleIcon, XCircleIcon, InformationCircleIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline'
import { XMarkIcon } from '@heroicons/react/20/solid'
import { tokens } from '../tokens'

/**
 * Default toast configuration
 */
const defaultOptions: ToastOptions = {
  duration: 4000,
  style: {
    borderRadius: '0.5rem',
    padding: '1rem',
    fontSize: '0.875rem',
    maxWidth: '28rem',
  },
}

/**
 * Success toast with consistent styling
 */
function success(message: string, options?: ToastOptions) {
  return hotToast(message, {
    ...defaultOptions,
    ...options,
    icon: <CheckCircleIcon className="h-5 w-5 text-green-600" />,
    style: {
      ...defaultOptions.style,
      ...options?.style,
      background: tokens.colors.feedback.success.background,
      color: tokens.colors.feedback.success.text,
      border: `1px solid ${tokens.colors.feedback.success.border}`,
    },
  })
}

/**
 * Error toast with consistent styling
 */
function error(message: string, options?: ToastOptions) {
  return hotToast(message, {
    ...defaultOptions,
    ...options,
    duration: options?.duration ?? 6000, // Errors stay longer
    icon: <XCircleIcon className="h-5 w-5 text-red-600" />,
    style: {
      ...defaultOptions.style,
      ...options?.style,
      background: tokens.colors.feedback.error.background,
      color: tokens.colors.feedback.error.text,
      border: `1px solid ${tokens.colors.feedback.error.border}`,
    },
  })
}

/**
 * Warning toast with consistent styling
 */
function warning(message: string, options?: ToastOptions) {
  return hotToast(message, {
    ...defaultOptions,
    ...options,
    icon: <ExclamationTriangleIcon className="h-5 w-5 text-yellow-600" />,
    style: {
      ...defaultOptions.style,
      ...options?.style,
      background: tokens.colors.feedback.warning.background,
      color: tokens.colors.feedback.warning.text,
      border: `1px solid ${tokens.colors.feedback.warning.border}`,
    },
  })
}

/**
 * Info toast with consistent styling
 */
function info(message: string, options?: ToastOptions) {
  return hotToast(message, {
    ...defaultOptions,
    ...options,
    icon: <InformationCircleIcon className="h-5 w-5 text-blue-600" />,
    style: {
      ...defaultOptions.style,
      ...options?.style,
      background: tokens.colors.feedback.info.background,
      color: tokens.colors.feedback.info.text,
      border: `1px solid ${tokens.colors.feedback.info.border}`,
    },
  })
}

/**
 * Loading toast with spinner
 */
function loading(message: string, options?: ToastOptions) {
  return hotToast.loading(message, {
    ...defaultOptions,
    ...options,
    style: {
      ...defaultOptions.style,
      ...options?.style,
    },
  })
}

/**
 * Promise toast that shows loading -> success/error
 */
function promise<T>(
  promise: Promise<T>,
  messages: {
    loading: string
    success: string | ((data: T) => string)
    error: string | ((error: any) => string)
  },
  options?: ToastOptions
) {
  return hotToast.promise(
    promise,
    {
      loading: messages.loading,
      success: messages.success,
      error: messages.error,
    },
    {
      ...defaultOptions,
      ...options,
      success: {
        icon: <CheckCircleIcon className="h-5 w-5 text-green-600" />,
        style: {
          ...defaultOptions.style,
          background: tokens.colors.feedback.success.background,
          color: tokens.colors.feedback.success.text,
          border: `1px solid ${tokens.colors.feedback.success.border}`,
        },
      },
      error: {
        icon: <XCircleIcon className="h-5 w-5 text-red-600" />,
        style: {
          ...defaultOptions.style,
          background: tokens.colors.feedback.error.background,
          color: tokens.colors.feedback.error.text,
          border: `1px solid ${tokens.colors.feedback.error.border}`,
        },
        duration: 6000,
      },
    }
  )
}

/**
 * Custom toast with full control
 */
function custom(jsx: React.ReactElement, options?: ToastOptions) {
  return hotToast.custom(jsx, {
    ...defaultOptions,
    ...options,
  })
}

/**
 * Dismiss a toast
 */
function dismiss(toastId?: string) {
  hotToast.dismiss(toastId)
}

/**
 * Remove all toasts
 */
function removeAll() {
  hotToast.remove()
}

/**
 * Toast API object
 */
export const toast = {
  success,
  error,
  warning,
  info,
  loading,
  promise,
  custom,
  dismiss,
  remove: removeAll,
}

/**
 * Toaster component that must be included in the app
 */
export function Toaster() {
  return (
    <HotToaster
      position="top-right"
      reverseOrder={false}
      gutter={8}
      containerStyle={{
        top: 80, // Account for header
      }}
      toastOptions={{
        // Default options for all toasts
        className: '',
        style: {
          ...defaultOptions.style,
        },
        // Mobile optimizations
        ...(typeof window !== 'undefined' && window.innerWidth < 640 && {
          position: 'top-center',
          style: {
            ...defaultOptions.style,
            margin: '0 1rem',
            maxWidth: 'calc(100vw - 2rem)',
          },
        }),
      }}
    />
  )
}

/**
 * Hook to use toast in components
 */
export function useToast() {
  return toast
}

/**
 * Action toast with custom button
 */
export function actionToast({
  message,
  action,
  onAction,
  variant = 'info',
}: {
  message: string
  action: string
  onAction: () => void
  variant?: 'info' | 'success' | 'warning' | 'error'
}) {
  const colors = {
    info: tokens.colors.feedback.info,
    success: tokens.colors.feedback.success,
    warning: tokens.colors.feedback.warning,
    error: tokens.colors.feedback.error,
  }

  const icons = {
    info: InformationCircleIcon,
    success: CheckCircleIcon,
    warning: ExclamationTriangleIcon,
    error: XCircleIcon,
  }

  const Icon = icons[variant]
  const color = colors[variant]

  return hotToast.custom(
    (t) => (
      <div
        className={`${
          t.visible ? 'animate-enter' : 'animate-leave'
        } max-w-md w-full bg-white shadow-lg rounded-lg pointer-events-auto flex ring-1 ring-black ring-opacity-5`}
        style={{
          background: color.background,
          borderColor: color.border,
        }}
      >
        <div className="flex-1 w-0 p-4">
          <div className="flex items-start">
            <div className="flex-shrink-0 pt-0.5">
              <Icon className="h-5 w-5" style={{ color: color.text }} />
            </div>
            <div className="ml-3 flex-1">
              <p className="text-sm font-medium" style={{ color: color.text }}>
                {message}
              </p>
            </div>
          </div>
        </div>
        <div className="flex border-l" style={{ borderColor: color.border }}>
          <button
            onClick={() => {
              onAction()
              toast.dismiss(t.id)
            }}
            className="w-full border border-transparent rounded-none rounded-r-lg p-4 flex items-center justify-center text-sm font-medium hover:bg-black hover:bg-opacity-5 focus:outline-none focus:ring-2 focus:ring-green-500"
            style={{ color: color.text }}
          >
            {action}
          </button>
        </div>
      </div>
    ),
    {
      duration: 6000,
    }
  )
}