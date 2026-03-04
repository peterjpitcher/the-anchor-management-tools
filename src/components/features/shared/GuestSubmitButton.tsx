'use client'

import { useState, type ReactNode } from 'react'

/**
 * A submit button for native HTML forms (method="post") that disables itself
 * after the first click to prevent double-submission. Shows a spinner while
 * the form is submitting.
 */
export function GuestSubmitButton({
  children,
  className,
  loadingText,
}: {
  children: ReactNode
  className: string
  loadingText?: string
}) {
  const [submitting, setSubmitting] = useState(false)

  return (
    <button
      type="submit"
      disabled={submitting}
      className={className}
      onClick={() => {
        // Allow the native form submission to proceed, then disable
        // Use requestAnimationFrame so the form submits before we disable
        requestAnimationFrame(() => setSubmitting(true))
      }}
    >
      {submitting ? (
        <span className="inline-flex items-center gap-2">
          <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          {loadingText || 'Processing...'}
        </span>
      ) : (
        children
      )}
    </button>
  )
}
