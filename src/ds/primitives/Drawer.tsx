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

export interface DrawerProps {
  open: boolean
  onClose: () => void
  title?: string
  /** @deprecated Accepted for backward compatibility */
  description?: string
  children: React.ReactNode
  /** @deprecated Accepted for backward compatibility */
  footer?: React.ReactNode
  side?: 'right' | 'left' | 'bottom'
  /** @deprecated Use `side` instead */
  position?: string
  width?: string
  /** @deprecated Use `width` instead */
  size?: string
  /** @deprecated Accepted for backward compatibility */
  mobileFullscreen?: boolean
}

const CloseIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </svg>
)

const sizeWidths: Record<string, string> = {
  sm: 'min(380px, 100vw)',
  md: 'min(480px, 100vw)',
  lg: 'min(640px, 100vw)',
  xl: 'min(960px, 100vw)',
  full: '100vw',
}

export function Drawer({
  open,
  onClose,
  title,
  description: _description,
  children,
  footer,
  side,
  position,
  width,
  size,
  mobileFullscreen: _mfs,
}: DrawerProps) {
  const resolvedSide = side ?? (position === 'left' || position === 'bottom' ? position : 'right')
  const isRight = resolvedSide === 'right'
  const isBottom = resolvedSide === 'bottom'
  const resolvedWidth = width ?? (size ? sizeWidths[size] ?? size : sizeWidths.sm)

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
          <DialogBackdrop className="fixed inset-0 bg-black/30" />
        </TransitionChild>

        <div className="fixed inset-0 overflow-hidden">
          <TransitionChild
            as={Fragment}
            enter="ease-out duration-300"
            enterFrom={isBottom ? 'translate-y-full' : isRight ? 'translate-x-full' : '-translate-x-full'}
            enterTo={isBottom ? 'translate-y-0' : 'translate-x-0'}
            leave="ease-in duration-200"
            leaveFrom={isBottom ? 'translate-y-0' : 'translate-x-0'}
            leaveTo={isBottom ? 'translate-y-full' : isRight ? 'translate-x-full' : '-translate-x-full'}
          >
            <DialogPanel
              className={cn(
                'fixed bg-surface shadow-lg flex flex-col',
                isBottom
                  ? 'inset-x-0 bottom-0 max-h-[90dvh] rounded-t-xl'
                  : 'top-0 h-full',
                !isBottom && (isRight ? 'right-0' : 'left-0')
              )}
              style={isBottom ? undefined : { width: resolvedWidth, maxWidth: '100vw' }}
            >
              {title && (
                <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-3">
                  <DialogTitle className="min-w-0 truncate text-base font-semibold text-text-strong">
                    {title}
                  </DialogTitle>
                  <button
                    type="button"
                    onClick={onClose}
                    className="p-1 rounded-md text-text-muted hover:text-text hover:bg-surface-hover transition-colors"
                    aria-label="Close drawer"
                  >
                    <CloseIcon />
                  </button>
                </div>
              )}

              <div className="flex-1 overflow-y-auto p-5">
                {children}
              </div>

              {footer && (
                <div className="shrink-0 px-5 py-4 border-t border-border flex justify-end gap-3">
                  {footer}
                </div>
              )}
            </DialogPanel>
          </TransitionChild>
        </div>
      </Dialog>
    </Transition>
  )
}
