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

interface DrawerProps {
  open: boolean
  onClose: () => void
  title?: string
  children: React.ReactNode
  side?: 'right' | 'left'
  width?: string
}

const CloseIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </svg>
)

export function Drawer({
  open,
  onClose,
  title,
  children,
  side = 'right',
  width = '380px',
}: DrawerProps) {
  const isRight = side === 'right'

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
            enterFrom={isRight ? 'translate-x-full' : '-translate-x-full'}
            enterTo="translate-x-0"
            leave="ease-in duration-200"
            leaveFrom="translate-x-0"
            leaveTo={isRight ? 'translate-x-full' : '-translate-x-full'}
          >
            <DialogPanel
              className={cn(
                'fixed top-0 h-full bg-surface shadow-lg flex flex-col',
                isRight ? 'right-0' : 'left-0'
              )}
              style={{ width }}
            >
              {title && (
                <div className="px-5 py-4 border-b border-border flex items-center justify-between">
                  <DialogTitle className="text-base font-semibold text-text-strong">
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
            </DialogPanel>
          </TransitionChild>
        </div>
      </Dialog>
    </Transition>
  )
}
