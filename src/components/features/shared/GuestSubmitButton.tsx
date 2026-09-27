'use client'

import { useState, type ReactNode } from 'react'
// Imported file by file rather than through the `guest` barrel: the barrel pulls in
// `GuestShell` and with it the guest webfont module, which a client module does not need.
import { GuestButton } from '@/components/features/guest/GuestButton'

type GuestSubmitButtonProps = {
  children: ReactNode
  /** Shown while the form is submitting. Defaults to `Processing...`. */
  loadingText?: string
  /** `'mobile'` (the default) fills the column on a phone and sizes to the label from 640px. */
  fullWidth?: boolean | 'mobile'
}

/**
 * The primary submit for a native HTML form (method="post"). It is a `GuestButton`
 * that disables itself after the first click, so a second tap on a slow signal
 * cannot post the form twice, and says what it is doing while the page loads.
 */
export function GuestSubmitButton({
  children,
  loadingText,
  fullWidth = 'mobile',
}: GuestSubmitButtonProps): React.JSX.Element {
  const [submitting, setSubmitting] = useState(false)

  return (
    <GuestButton
      type="submit"
      variant="primary"
      size="md"
      fullWidth={fullWidth}
      loading={submitting}
      loadingText={loadingText || 'Processing...'}
      onClick={() => {
        // Let the native form submission start first, then disable. Disabling
        // synchronously would cancel the submit this click is making.
        requestAnimationFrame(() => setSubmitting(true))
      }}
    >
      {children}
    </GuestButton>
  )
}
