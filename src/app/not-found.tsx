import { GuestBlockedState, GuestShell } from '@/components/features/guest'
import { GUEST_CONTACT } from '@/lib/guest-contact'

export const metadata = { title: 'Page not found - The Anchor' }

/**
 * The site-wide 404, in the guest brand.
 *
 * It answers any URL that matches no route: nearly always a guest's old or
 * mistyped link from a text or an email. Next 15 treats an unmatched URL as
 * belonging to no route group, so a typo under a staff path (/dashboard/typo)
 * lands here too. It also catches `notFound()` from a page outside
 * `(authenticated)` with no boundary of its own, such as the event check-in
 * kiosk. A staff page that calls `notFound()` does not come here: it gets
 * `src/app/(authenticated)/not-found.tsx`, inside the app shell. The words work
 * for anyone, and the way out is the pub's website. `/parking` and
 * `/invoice-portal` keep their own, more specific, not-found pages.
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
