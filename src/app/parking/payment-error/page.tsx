import { CircleAlert } from 'lucide-react'
import {
  GUEST_H1_CLASS,
  GUEST_INTRO_CLASS,
  GUEST_KICKER_CLASS,
  GuestButton,
  GuestCard,
  GuestShell,
} from '@/components/features/guest'
import { GUEST_CONTACT } from '@/lib/guest-contact'

type ParkingPaymentErrorPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

const COPY: Record<string, { title: string; body: string }> = {
  missing_parameters: {
    title: 'Payment link incomplete',
    body: 'PayPal returned without the details needed to check this parking payment.',
  },
  not_found: {
    title: 'Payment could not be matched',
    body: 'We could not match that PayPal payment to a parking booking.',
  },
}

// Static and non-personal on purpose: no token, customer name or booking reference may reach
// a browser title or history entry. These routes are noindex via the X-Robots-Tag header.
export const metadata = { title: 'Parking payment - The Anchor' }

export const dynamic = 'force-dynamic'

export default async function ParkingPaymentErrorPage({ searchParams }: ParkingPaymentErrorPageProps) {
  const resolvedSearch = searchParams ? await searchParams : {}
  const reason = Array.isArray(resolvedSearch.reason) ? resolvedSearch.reason[0] : resolvedSearch.reason
  const bookingId = Array.isArray(resolvedSearch.booking_id) ? resolvedSearch.booking_id[0] : resolvedSearch.booking_id
  const copy = COPY[reason || ''] ?? {
    title: 'Parking payment issue',
    body: 'We could not confirm this parking payment.',
  }

  return (
    <GuestShell>
      <div className={GUEST_INTRO_CLASS}>
        <p className={GUEST_KICKER_CLASS}>Guest parking</p>
        <h1 className={GUEST_H1_CLASS}>{copy.title}</h1>
      </div>

      <GuestCard variant="accent" className="flex flex-col gap-4">
        <span
          aria-hidden="true"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-anchor-danger/10 text-anchor-danger"
        >
          <CircleAlert className="h-5 w-5" />
        </span>

        <p className="font-anchor-body text-[15px] leading-[1.65] text-guest-text">{copy.body}</p>

        {bookingId && (
          <p className="font-anchor-body text-[13px] leading-[1.6] text-guest-text-muted">
            Booking ID: <span className="font-mono font-semibold text-guest-text">{bookingId}</span>
          </p>
        )}

        <p className="border-t border-guest-border pt-4 font-anchor-body text-[14px] leading-[1.6] text-guest-text-muted">
          Please try the payment link again, or call{' '}
          <span className="font-bold text-guest-text">{GUEST_CONTACT.phoneDisplay}</span>.
        </p>
      </GuestCard>

      <GuestButton as="a" href={GUEST_CONTACT.website} variant="outline" size="md">
        Return to The Anchor website
      </GuestButton>
    </GuestShell>
  )
}
