'use client'

import { useEffect, useRef, useState, type ReactNode, type Ref } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

type PortalMenuRenderTrigger = (props: {
  ref: Ref<HTMLButtonElement>
  open: boolean
  onClick: () => void
  'aria-expanded': boolean
}) => ReactNode

export type PortalMenuEntry =
  | { type: 'section'; key: string; label: string }
  | {
      type?: 'item'
      key: string
      label: ReactNode
      icon?: ReactNode
      danger?: boolean
      disabled?: boolean
      /** Keep the menu open after this entry is clicked (e.g. expandable sub-lists) */
      keepOpen?: boolean
      onClick?: () => void | Promise<void>
    }

interface PortalMenuProps {
  trigger: PortalMenuRenderTrigger
  entries: PortalMenuEntry[]
  width?: number
  maxHeight?: number
  disabled?: boolean
  onOpenChange?: (open: boolean) => void
}

export function PortalMenu({ trigger, entries, width = 224, maxHeight = 420, disabled, onOpenChange }: PortalMenuProps) {
  const [open, setOpen] = useState(false)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [mounted, setMounted] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const setOpenState = (next: boolean) => {
    setOpen(next)
    onOpenChange?.(next)
  }

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!open) return

    const close = () => setOpenState(false)
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (menuRef.current?.contains(target) || buttonRef.current?.contains(target)) return
      close()
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    // Capture phase so scrolls inside nested overflow wrappers (e.g. the
    // horizontally scrolling table) also close the menu — but ignore the
    // menu's own internal scrolling.
    const handleScroll = (event: Event) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return
      close()
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    window.addEventListener('scroll', handleScroll, { capture: true, passive: true })
    window.addEventListener('resize', close)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('scroll', handleScroll, { capture: true })
      window.removeEventListener('resize', close)
    }
  }, [open])

  const toggle = () => {
    if (disabled || !buttonRef.current) return
    setRect(buttonRef.current.getBoundingClientRect())
    setOpenState(!open)
  }

  const position = open && rect && mounted && typeof window !== 'undefined'
    ? (() => {
        const margin = 8
        const boundedMaxHeight = Math.min(maxHeight, window.innerHeight - margin * 2)
        const maxLeft = Math.max(margin, window.innerWidth - width - margin)
        const left = Math.min(Math.max(margin, rect.right - width), maxLeft)
        const opensDown = rect.bottom + 6 + boundedMaxHeight <= window.innerHeight
        const top = opensDown ? rect.bottom + 6 : Math.max(margin, rect.top - boundedMaxHeight - 6)

        return { left, top, width, maxHeight: boundedMaxHeight }
      })()
    : null

  const menu = position
    ? createPortal(
        <div
          ref={menuRef}
          className="fixed z-[9999] overflow-y-auto rounded-lg border border-border bg-surface py-1 shadow-lg"
          style={position}
        >
          {entries.map((entry) => {
            if (entry.type === 'section') {
              return (
                <div key={entry.key} className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                  {entry.label}
                </div>
              )
            }

            return (
              <button
                key={entry.key}
                type="button"
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-surface-hover',
                  entry.danger ? 'text-danger' : 'text-text',
                  entry.disabled && 'opacity-50'
                )}
                disabled={entry.disabled}
                onClick={() => {
                  if (!entry.keepOpen) setOpenState(false)
                  void entry.onClick?.()
                }}
              >
                {entry.icon && <span className="flex-shrink-0 [&>svg]:h-4 [&>svg]:w-4">{entry.icon}</span>}
                <span className="min-w-0 truncate">{entry.label}</span>
              </button>
            )
          })}
        </div>,
        document.body
      )
    : null

  return (
    <>
      {trigger({ ref: buttonRef, open, onClick: toggle, 'aria-expanded': open })}
      {menu}
    </>
  )
}
