'use client'

import { useId, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface CalendarEntryTooltipProps {
    /** Rich detail for the entry. When absent the wrapper renders its child unchanged. */
    content: ReactNode
    /**
     * Plain-text equivalent, used as the native `title`. Kept alongside the rich
     * popover deliberately: it is what a screen reader and a long-press get, and
     * it is the thing that was silently lost when a renderer was passed but never
     * rendered.
     */
    text: string
    children: ReactNode
    className?: string
}

/**
 * Hover-and-focus detail for a calendar entry.
 *
 * The previous code passed a 160-line tooltip renderer down two components and
 * then used it only as a boolean to suppress the native `title`, so neither the
 * rich tooltip nor the browser one ever appeared. This restores both, and adds
 * keyboard access: the popover opens on focus as well as hover, and Escape
 * dismisses it without disturbing the entry's own click behaviour.
 */
export function CalendarEntryTooltip({ content, text, children, className }: CalendarEntryTooltipProps) {
    const [open, setOpen] = useState(false)
    const id = useId()

    if (!content) return <>{children}</>

    return (
        <span
            className={cn('relative block', className)}
            onMouseEnter={() => setOpen(true)}
            onMouseLeave={() => setOpen(false)}
            onFocusCapture={() => setOpen(true)}
            onBlurCapture={() => setOpen(false)}
            onKeyDown={(event) => {
                if (event.key === 'Escape' && open) {
                    // Do not stop propagation: a parent dialog should still close
                    // if the user meant that instead.
                    setOpen(false)
                }
            }}
            title={text}
        >
            <span aria-describedby={open ? id : undefined} className="block">
                {children}
            </span>
            {open && (
                <span
                    id={id}
                    role="tooltip"
                    className="pointer-events-none absolute left-0 top-full z-30 mt-1 w-max max-w-[16rem] rounded-md border border-gray-300 bg-white p-2 text-left shadow-lg"
                >
                    {content}
                </span>
            )}
        </span>
    )
}
