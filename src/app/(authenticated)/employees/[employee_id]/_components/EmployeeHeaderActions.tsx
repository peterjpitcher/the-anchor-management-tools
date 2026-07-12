'use client'

import { useState } from 'react'

interface EmployeeHeaderActionsProps {
  /** The primary action shown inline on mobile (e.g. Edit). */
  primary?: React.ReactNode
  /** Secondary actions — inline on desktop, tucked into a "More" menu on mobile. */
  secondary: React.ReactNode[]
}

/**
 * Employee-detail header actions. Desktop shows every action in a wrapping row.
 * Mobile shows the primary action plus a "More" disclosure so the header is one
 * tidy row instead of a three-row block of full-size buttons.
 */
export function EmployeeHeaderActions({ primary, secondary }: EmployeeHeaderActionsProps) {
  const [open, setOpen] = useState(false)
  const hasSecondary = secondary.filter(Boolean).length > 0

  return (
    <>
      {/* Mobile: primary + More */}
      <div className="flex items-center gap-2 md:hidden">
        {primary}
        {hasSecondary && (
          <div className="relative">
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-haspopup="menu"
              className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700"
            >
              More
              <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M5.5 7.5 10 12l4.5-4.5" stroke="currentColor" strokeWidth="1.5" fill="none" /></svg>
            </button>
            {open && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} aria-hidden="true" />
                <div
                  role="menu"
                  className="absolute right-0 top-full z-40 mt-1 flex w-56 max-w-[calc(100vw-1.5rem)] flex-col gap-1 rounded-md border border-gray-200 bg-white p-2 shadow-lg"
                  onClick={() => setOpen(false)}
                >
                  {secondary.filter(Boolean).map((action, i) => (
                    <div key={i} className="[&_a]:w-full [&_button]:w-full [&>*]:w-full">
                      {action}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Desktop: full row */}
      <div className="hidden flex-wrap items-center justify-end gap-2 md:flex">
        {secondary}
        {primary}
      </div>
    </>
  )
}
