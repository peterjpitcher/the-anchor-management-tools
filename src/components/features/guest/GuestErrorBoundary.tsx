'use client'

import { useEffect } from 'react'
import {
  isChunkLoadFailure,
  recoverFromChunkFailure,
  retryPendingNavigation,
} from '@/components/features/shared/ChunkErrorReloader'
import { GUEST_CONTACT } from '@/lib/guest-contact'
import { GuestAlert } from './GuestAlert'
import { GuestButton } from './GuestButton'
import { GuestIntro } from './GuestIntro'
import { GuestShell } from './GuestShell'
import { GUEST_NOTE_CLASS } from './styles'

type GuestErrorBoundaryProps = {
  error: Error & { digest?: string }
  reset: () => void
}

/**
 * What a guest sees when a public page crashes, in the guest brand rather than
 * the staff palette of `global-error.tsx`. Every public segment's `error.tsx`
 * renders this, so the wording and the way out are the same everywhere.
 *
 * A chunk-load failure (a tab left open across a deploy) gets the same guarded
 * reload the staff error boundary uses, instead of a "try again" that would
 * fail the same way. Every other failure offers a retry and the phone number.
 *
 * This is a client component because Next.js requires one for an error
 * boundary, so it renders `GuestShell` (and its webfonts) on the client. That
 * only happens on a page that has already failed.
 */
export function GuestErrorBoundary({ error, reset }: GuestErrorBoundaryProps): React.JSX.Element {
  const chunkErrorMessage = `${error.name || ''}: ${error.message || ''}`
  const isChunkError = isChunkLoadFailure(chunkErrorMessage)

  useEffect(() => {
    if (isChunkError) {
      recoverFromChunkFailure(chunkErrorMessage)
    }
  }, [chunkErrorMessage, isChunkError])

  if (isChunkError) {
    return (
      <GuestShell>
        <GuestIntro
          kicker="The Anchor"
          title="This page has been updated"
          lead="We've just made some changes. Reload the page to pick them up."
        />
        <GuestButton variant="primary" fullWidth onClick={retryPendingNavigation}>
          Reload page
        </GuestButton>
      </GuestShell>
    )
  }

  return (
    <GuestShell>
      <GuestIntro
        kicker="The Anchor"
        title="Something went wrong"
        lead="That's on us, not you. Please try again in a moment."
      />

      <GuestAlert tone="problem">Please call {GUEST_CONTACT.phoneDisplay} if it keeps happening.</GuestAlert>

      <div className="flex flex-col gap-2.5">
        <GuestButton variant="primary" fullWidth onClick={reset}>
          Try again
        </GuestButton>
        <GuestButton as="a" href={GUEST_CONTACT.telHref} variant="ghost" fullWidth>
          Call {GUEST_CONTACT.phoneDisplay}
        </GuestButton>
      </div>

      {error.digest ? <p className={GUEST_NOTE_CLASS}>Reference: {error.digest}</p> : null}
    </GuestShell>
  )
}
