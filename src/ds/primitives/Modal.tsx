'use client'

import { Fragment } from 'react'
import {
  Dialog,
  DialogBackdrop,
  DialogPanel,
  DialogTitle,
  Transition,
  TransitionChild,
} from '@headlessui/react'
import { cn } from '@/lib/utils'

type ModalWidth = 'sm' | 'md' | 'lg' | 'xl'

interface ModalProps {
  open: boolean
  onClose: () => void
  title?: string
  /** @deprecated Use children instead */
  description?: string
  children: React.ReactNode
  footer?: React.ReactNode
  width?: ModalWidth
  /** @deprecated Use `width` instead */
  size?: ModalWidth
  /** @deprecated Accepted for backward compatibility */
  mobileFullscreen?: boolean
}

const widthStyles: Record<ModalWidth, string> = {
  sm: 'max-w-[400px]',
  md: 'max-w-[500px]',
  lg: 'max-w-[640px]',
  xl: 'max-w-[800px]',
}

export function Modal({
  open,
  onClose,
  title,
  description: _description,
  children,
  footer,
  width,
  size,
  mobileFullscreen: _mfs,
}: ModalProps) {
  const resolvedWidth = width ?? size ?? 'md'
  return (
    <Transition show={open} as={Fragment}>
      <Dialog onClose={onClose} className="relative z-50">
        <TransitionChild
          as={Fragment}
          enter="ease-out duration-200"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-150"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <DialogBackdrop className="fixed inset-0 bg-black/50" />
        </TransitionChild>

        <div className="fixed inset-0 overflow-y-auto p-0 sm:p-4">
          <div className="flex min-h-full items-end justify-center sm:items-center">
            <TransitionChild
              as={Fragment}
              enter="ease-out duration-200"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-150"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <DialogPanel
                className={cn(
                  'flex max-h-[92dvh] w-full flex-col overflow-hidden bg-surface rounded-t-xl shadow-lg sm:max-h-[calc(100dvh-2rem)] sm:rounded-lg',
                  widthStyles[resolvedWidth]
                )}
              >
                {title && (
                  <div className="px-4 py-4 border-b border-border sm:px-6">
                    <DialogTitle className="text-base font-semibold text-text">
                      {title}
                    </DialogTitle>
                  </div>
                )}

                <div className="overflow-y-auto px-4 py-4 sm:px-6">{children}</div>

                {footer && (
                  <div className="flex flex-col-reverse gap-2 border-t border-border px-4 py-4 sm:flex-row sm:justify-end sm:gap-3 sm:px-6">
                    {footer}
                  </div>
                )}
              </DialogPanel>
            </TransitionChild>
          </div>
        </div>
      </Dialog>
    </Transition>
  )
}
