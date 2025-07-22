'use client'

/**
 * ConfirmDialog Component
 * 
 * Used on 78/107 pages (73%)
 * 
 * Confirmation dialog for destructive or important actions.
 * Supports async operations, loading states, and customizable content.
 */

import { ReactNode, useState } from 'react'
import { cn } from '@/lib/utils'
import { 
  ExclamationTriangleIcon,
  InformationCircleIcon,
  CheckCircleIcon,
  XCircleIcon,
  TrashIcon,
  ArrowPathIcon
} from '@heroicons/react/24/outline'
import { Modal, ModalActions } from './Modal'
import { Button } from '../forms/Button'

export interface ConfirmDialogProps {
  /**
   * Whether the dialog is open
   */
  open: boolean
  
  /**
   * Callback when dialog should close
   */
  onClose: () => void
  
  /**
   * Callback when action is confirmed
   */
  onConfirm: (() => void) | (() => Promise<void>)
  
  /**
   * Dialog title
   */
  title: string
  
  /**
   * Dialog message/description
   */
  message?: ReactNode
  
  /**
   * Type of confirmation
   * @default 'warning'
   */
  type?: 'danger' | 'warning' | 'info' | 'success'
  
  /**
   * Confirm button text
   * @default 'Confirm'
   */
  confirmText?: string
  
  /**
   * Cancel button text
   * @default 'Cancel'
   */
  cancelText?: string
  
  /**
   * Whether to show icon
   * @default true
   */
  showIcon?: boolean
  
  /**
   * Custom icon
   */
  icon?: ReactNode
  
  /**
   * Confirm button variant
   */
  confirmVariant?: 'primary' | 'danger' | 'success'
  
  /**
   * Whether the action is destructive
   * @default false
   */
  destructive?: boolean
  
  /**
   * Whether to require typing confirmation
   * @default false
   */
  requireConfirmation?: boolean
  
  /**
   * Text that must be typed for confirmation
   */
  confirmationText?: string
  
  /**
   * Custom confirmation placeholder
   */
  confirmationPlaceholder?: string
  
  /**
   * Additional content to show in dialog
   */
  children?: ReactNode
  
  /**
   * Whether to close on confirm
   * @default true
   */
  closeOnConfirm?: boolean
  
  /**
   * Loading text while confirming
   * @default 'Processing...'
   */
  loadingText?: string
  
  /**
   * Size of the dialog
   * @default 'sm'
   */
  size?: 'xs' | 'sm' | 'md' | 'lg'
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  type = 'warning',
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  showIcon = true,
  icon,
  confirmVariant,
  destructive = false,
  requireConfirmation = false,
  confirmationText = 'DELETE',
  confirmationPlaceholder = `Type "${confirmationText}" to confirm`,
  children,
  closeOnConfirm = true,
  loadingText = 'Processing...',
  size = 'sm',
}: ConfirmDialogProps) {
  const [loading, setLoading] = useState(false)
  const [confirmationInput, setConfirmationInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  
  // Determine icon and colors based on type
  const typeConfig = {
    danger: {
      icon: <XCircleIcon />,
      iconColor: 'text-red-600',
      iconBg: 'bg-red-100',
      defaultVariant: 'danger' as const,
    },
    warning: {
      icon: <ExclamationTriangleIcon />,
      iconColor: 'text-yellow-600',
      iconBg: 'bg-yellow-100',
      defaultVariant: 'primary' as const,
    },
    info: {
      icon: <InformationCircleIcon />,
      iconColor: 'text-blue-600',
      iconBg: 'bg-blue-100',
      defaultVariant: 'primary' as const,
    },
    success: {
      icon: <CheckCircleIcon />,
      iconColor: 'text-green-600',
      iconBg: 'bg-green-100',
      defaultVariant: 'success' as const,
    },
  }
  
  const config = typeConfig[type]
  const finalConfirmVariant = confirmVariant || (destructive ? 'danger' : config.defaultVariant)
  const displayIcon = icon || config.icon
  
  // Check if confirmation is valid
  const isConfirmationValid = !requireConfirmation || confirmationInput === confirmationText
  
  // Handle confirm
  const handleConfirm = async () => {
    if (!isConfirmationValid) {
      setError('Please type the confirmation text exactly')
      return
    }
    
    setLoading(true)
    setError(null)
    
    try {
      const result = onConfirm()
      if (result instanceof Promise) {
        await result
      }
      
      if (closeOnConfirm) {
        onClose()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }
  
  // Reset state when dialog opens/closes
  const handleClose = () => {
    setConfirmationInput('')
    setError(null)
    setLoading(false)
    onClose()
  }
  
  return (
    <Modal
      open={open}
      onClose={handleClose}
      size={size === 'xs' ? 'sm' : size}
      closeOnEscape={!loading}
    >
      <div className="sm:flex sm:items-start">
        {showIcon && (
          <div className={cn(
            'mx-auto flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full sm:mx-0 sm:h-10 sm:w-10',
            config.iconBg
          )}>
            <span className={cn('h-6 w-6', config.iconColor)}>
              {displayIcon}
            </span>
          </div>
        )}
        
        <div className={cn(
          'text-center sm:text-left',
          showIcon ? 'mt-3 sm:ml-4 sm:mt-0' : 'w-full'
        )}>
          <h3 className="text-lg font-semibold leading-6 text-gray-900">
            {title}
          </h3>
          
          {message && (
            <div className="mt-2">
              <p className="text-sm text-gray-500">
                {message}
              </p>
            </div>
          )}
          
          {children && (
            <div className="mt-4">
              {children}
            </div>
          )}
          
          {requireConfirmation && (
            <div className="mt-4">
              <label htmlFor="confirmation" className="block text-sm font-medium text-gray-700">
                {confirmationPlaceholder}
              </label>
              <input
                type="text"
                id="confirmation"
                value={confirmationInput}
                onChange={(e) => {
                  setConfirmationInput(e.target.value)
                  setError(null)
                }}
                placeholder={confirmationText}
                className={cn(
                  'mt-1 block w-full rounded-md shadow-sm sm:text-sm',
                  'border-gray-300 focus:border-green-500 focus:ring-green-500',
                  error && 'border-red-300 focus:border-red-500 focus:ring-red-500'
                )}
                disabled={loading}
              />
              {error && (
                <p className="mt-1 text-sm text-red-600">{error}</p>
              )}
            </div>
          )}
        </div>
      </div>
      
      <ModalActions>
        <Button
          variant="secondary"
          onClick={handleClose}
          disabled={loading}
        >
          {cancelText}
        </Button>
        <Button
          variant={finalConfirmVariant}
          onClick={handleConfirm}
          loading={loading}
          disabled={!isConfirmationValid}
        >
          {loading ? loadingText : confirmText}
        </Button>
      </ModalActions>
    </Modal>
  )
}

/**
 * DeleteConfirmDialog - Specialized confirm dialog for delete actions
 */
export function DeleteConfirmDialog({
  itemName,
  itemType = 'item',
  onDelete,
  ...props
}: {
  itemName: string
  itemType?: string
  onDelete: (() => void) | (() => Promise<void>)
} & Omit<ConfirmDialogProps, 'title' | 'message' | 'type' | 'onConfirm' | 'destructive'>) {
  return (
    <ConfirmDialog
      {...props}
      type="danger"
      destructive
      title={`Delete ${itemType}?`}
      message={
        <>
          Are you sure you want to delete <strong>{itemName}</strong>? 
          This action cannot be undone.
        </>
      }
      confirmText="Delete"
      confirmVariant="danger"
      onConfirm={onDelete}
      icon={<TrashIcon />}
    />
  )
}

/**
 * RestoreConfirmDialog - Specialized confirm dialog for restore actions
 */
export function RestoreConfirmDialog({
  itemName,
  itemType = 'item',
  onRestore,
  ...props
}: {
  itemName: string
  itemType?: string
  onRestore: (() => void) | (() => Promise<void>)
} & Omit<ConfirmDialogProps, 'title' | 'message' | 'type' | 'onConfirm'>) {
  return (
    <ConfirmDialog
      {...props}
      type="info"
      title={`Restore ${itemType}?`}
      message={
        <>
          Are you sure you want to restore <strong>{itemName}</strong>?
        </>
      }
      confirmText="Restore"
      confirmVariant="primary"
      onConfirm={onRestore}
      icon={<ArrowPathIcon />}
    />
  )
}

/**
 * useConfirmDialog - Hook for managing confirm dialog state
 */
export function useConfirmDialog() {
  const [isOpen, setIsOpen] = useState(false)
  const [config, setConfig] = useState<Partial<ConfirmDialogProps>>({})
  
  const confirm = (options: Omit<ConfirmDialogProps, 'open' | 'onClose'>) => {
    return new Promise<boolean>((resolve) => {
      setConfig({
        ...options,
        onConfirm: async () => {
          const originalOnConfirm = options.onConfirm
          if (originalOnConfirm) {
            await originalOnConfirm()
          }
          resolve(true)
          setIsOpen(false)
        },
        onClose: () => {
          resolve(false)
          setIsOpen(false)
        },
      })
      setIsOpen(true)
    })
  }
  
  const dialog = (
    <ConfirmDialog
      open={isOpen}
      onClose={() => {
        setIsOpen(false)
        config.onClose?.()
      }}
      onConfirm={config.onConfirm || (() => {})}
      title={config.title || 'Confirm'}
      {...config}
    />
  )
  
  return { confirm, dialog }
}