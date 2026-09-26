import { GuestBlockedState, GuestShell } from '@/components/features/guest'
import { GUEST_CONTACT } from '@/lib/guest-contact'

export const metadata = { title: 'Page not found - The Anchor' }

/**
 * The site-wide 404, in the guest brand.
 *
 * Nearly every URL that reaches this is a guest's: an old or mistyped link from
 * a text or an email, or a `notFound()` on a public page such as the invoice
 * portal. Staff pages call `notFound()` too, and with no `not-found.tsx` of
 * their own inside `(authenticated)` they land here as well, outside the app
 * shell. The words work for both, and the way out is the pub's website.
 * `/parking` keeps its own, more specific, not-found page.
 */
export default function NotFound(): React.JSX.Element {
  return (
    <GuestShell>
      <GuestBlockedState
        kicker="The Anchor"
        heading="We can't find that page"
        lead="The link may be old, or the page may have moved."
        reason="There's nothing at this address."
        primaryAction={{ label: 'Go to The Anchor website', href: GUEST_CONTACT.website }}
        secondaryAction={{ label: `Call ${GUEST_CONTACT.phoneDisplay}`, href: GUEST_CONTACT.telHref }}
      />
    </GuestShell>
  )
}
