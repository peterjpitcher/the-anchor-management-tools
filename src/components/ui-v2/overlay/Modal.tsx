'use client'

/**
 * Modal Component
 * 
 * Used on 67/107 pages (63%)
 * 
 * Enhanced modal with animations, nested support, and mobile optimization.
 * Provides consistent overlay patterns across the application.
 */

import { Fragment, ReactNode, useEffect, useRef, useState } from 'react'
import { Dialog, Transition } from '@headlessui/react'
import { cn } from '@/lib/utils'
import { XMarkIcon } from '@heroicons/react/24/outline'

export interface ModalProps {
  /**
   * Whether the modal is open
   */
  open: boolean
  
  /**
   * Callback when modal should close
   */
  onClose: () => void
  
  /**
   * Modal title
   */
  title?: string
  
  /**
   * Modal description (for accessibility)
   */
  description?: string
  
  /**
   * Modal content
   */
  children: ReactNode
  
  /**
   * Footer content (typically actions)
   */
  footer?: ReactNode
  
  /**
   * Size of the modal
   * @default 'md'
   */
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full'
  
  /**
   * Whether to show the close button
   * @default true
   */
  showCloseButton?: boolean
  
  /**
   * Whether clicking backdrop closes modal
   * @default true
   */
  closeOnBackdrop?: boolean
  
  /**
   * Whether pressing Escape closes modal
   * @default true
   */
  closeOnEscape?: boolean
  
  /**
   * Whether to center the modal vertically
   * @default true
   */
  centered?: boolean
  
  /**
   * Whether to show on mobile as fullscreen
   * @default false
   */
  mobileFullscreen?: boolean
  
  /**
   * Custom classes for the modal panel
   */
  className?: string
  
  /**
   * Custom classes for the overlay
   */
  overlayClassName?: string
  
  /**
   * Initial focus element ref
   */
  initialFocus?: React.RefObject<HTMLElement>
  
  /**
   * Z-index for the modal
   * @default 50
   */
  zIndex?: number
  
  /**
   * Whether to unmount on close (vs hide)
   * @default true
   */
  unmount?: boolean
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  showCloseButton = true,
  closeOnBackdrop = true,
  closeOnEscape = true,
  centered = true,
  mobileFullscreen = false,
  className,
  overlayClassName,
  initialFocus,
  zIndex = 50,
  unmount = true,
}: ModalProps) {
  const [isClosing, setIsClosing] = useState(false)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  
  // Handle close with animation
  const handleClose = () => {
    if (!closeOnBackdrop && !closeOnEscape) return
    setIsClosing(true)
    setTimeout(() => {
      onClose()
      setIsClosing(false)
    }, 200) // Match animation duration
  }
  
  // Size classes
  const sizeClasses = {
    sm: 'sm:max-w-md',
    md: 'sm:max-w-lg',
    lg: 'sm:max-w-2xl',
    xl: 'sm:max-w-4xl',
    full: 'sm:max-w-7xl',
  }
  
  // Panel classes
  const panelClasses = cn(
    'relative bg-white rounded-lg shadow-xl',
    'w-full transform transition-all',
    sizeClasses[size],
    mobileFullscreen && 'h-full sm:h-auto',
    'max-h-[90vh] flex flex-col',
    className
  )
  
  // Overlay classes
  const overlayClasses = cn(
    'fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity',
    overlayClassName
  )
  
  return (
    <Transition.Root show={open && !isClosing} as={Fragment} unmount={unmount}>
      <Dialog
        as="div"
        className="relative"
        style={{ zIndex }}
        onClose={closeOnBackdrop ? handleClose : () => {}}
        initialFocus={initialFocus || closeButtonRef}
      >
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className={overlayClasses} />
        </Transition.Child>

        <div className="fixed inset-0 z-10 overflow-y-auto">
          <div
            className={cn(
              'flex min-h-full',
              centered ? 'items-center justify-center p-4' : 'items-end sm:items-center justify-center sm:p-4',
              mobileFullscreen && 'p-0 sm:p-4'
            )}
          >
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom={centered ? 'opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95' : 'opacity-0 translate-y-full sm:translate-y-0 sm:scale-95'}
              enterTo="opacity-100 translate-y-0 sm:scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 translate-y-0 sm:scale-100"
              leaveTo={centered ? 'opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95' : 'opacity-0 translate-y-full sm:translate-y-0 sm:scale-95'}
            >
              <Dialog.Panel className={panelClasses}>
                {/* Header */}
                {(title || showCloseButton) && (
                  <div className="flex items-center justify-between p-4 sm:p-6 border-b border-gray-200">
                    <div className="flex-1 pr-4">
                      {title && (
                        <Dialog.Title as="h3" className="text-lg font-semibold leading-6 text-gray-900">
                          {title}
                        </Dialog.Title>
                      )}
                      {description && (
                        <Dialog.Description as="p" className="mt-1 text-sm text-gray-500">
                          {description}
                        </Dialog.Description>
                      )}
                    </div>
                    {showCloseButton && (
                      <button
                        ref={closeButtonRef}
                        type="button"
                        className={cn(
                          'rounded-full p-2 -m-2',
                          'text-gray-400 hover:text-gray-500',
                          'hover:bg-gray-100 focus:bg-gray-100',
                          'focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2',
                          'transition-colors'
                        )}
                        onClick={handleClose}
                      >
                        <span className="sr-only">Close</span>
                        <XMarkIcon className="h-6 w-6" aria-hidden="true" />
                      </button>
                    )}
                  </div>
                )}
                
                {/* Content */}
                <div className="flex-1 overflow-y-auto p-4 sm:p-6">
                  {children}
                </div>
                
                {/* Footer */}
                {footer && (
                  <div className="bg-gray-50 px-4 py-3 sm:px-6 border-t border-gray-200 rounded-b-lg">
                    {footer}
                  </div>
                )}
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition.Root>
  )
}

/**
 * ModalActions - Consistent modal footer actions
 */
export function ModalActions({
  children,
  align = 'right',
  className,
}: {
  children: ReactNode
  align?: 'left' | 'center' | 'right' | 'between'
  className?: string
}) {
  const alignClasses = {
    left: 'justify-start',
    center: 'justify-center', 
    right: 'justify-end',
    between: 'justify-between',
  }
  
  return (
    <div className={cn(
      'flex flex-col-reverse sm:flex-row gap-3',
      alignClasses[align],
      className
    )}>
      {children}
    </div>
  )
}

/**
 * ConfirmModal - Common confirmation dialog pattern
 */
export function ConfirmModal({
  open,
  onClose,
  onConfirm,
  title = 'Confirm Action',
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'primary',
  loading = false,
}: {
  open: boolean
  onClose: () => void
  onConfirm: () => void | Promise<void>
  title?: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'primary' | 'danger'
  loading?: boolean
}) {
  const [isLoading, setIsLoading] = useState(false)
  
  const handleConfirm = async () => {
    setIsLoading(true)
    try {
      await onConfirm()
      onClose()
    } finally {
      setIsLoading(false)
    }
  }
  
  const buttonVariantClasses = {
    primary: 'bg-green-600 hover:bg-green-700 focus:ring-green-500',
    danger: 'bg-red-600 hover:bg-red-700 focus:ring-red-500',
  }
  
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <ModalActions>
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading || loading}
            className="inline-flex justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isLoading || loading}
            className={cn(
              'inline-flex justify-center rounded-md border border-transparent px-4 py-2 text-sm font-medium text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed',
              buttonVariantClasses[variant]
            )}
          >
            {(isLoading || loading) && (
              <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            )}
            {confirmLabel}
          </button>
        </ModalActions>
      }
    >
      <p className="text-sm text-gray-500">{message}</p>
    </Modal>
  )
}

/**
 * AlertModal - Simple alert dialog
 */
export function AlertModal({
  open,
  onClose,
  title = 'Alert',
  message,
  buttonLabel = 'OK',
}: {
  open: boolean
  onClose: () => void
  title?: string
  message: string
  buttonLabel?: string
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <ModalActions align="center">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex justify-center rounded-md border border-transparent bg-green-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2"
          >
            {buttonLabel}
          </button>
        </ModalActions>
      }
    >
      <p className="text-sm text-gray-500">{message}</p>
    </Modal>
  )
}