'use client'

import { GuestErrorBoundary } from '@/components/features/guest/GuestErrorBoundary'

/** A crash on this public page shows the guest-branded error, not the staff one. */
export default function GuestSegmentError(props: {
  error: Error & { digest?: string }
  reset: () => void
}): React.JSX.Element {
  return <GuestErrorBoundary {...props} />
}
