import { cn } from '@/lib/utils'
import {
  GuestButton,
  GuestCard,
  GuestIntro,
  GuestPhoneLink,
  GuestShell,
  GuestStatusMark,
  GUEST_MESSAGE_CLASS,
  GUEST_MUTED_CLASS,
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
      <GuestIntro kicker="Guest parking" title={copy.title} />

      <GuestCard variant="accent">
        <div className="flex flex-col gap-guest-md">
          <GuestStatusMark tone="problem" />

          <p className={GUEST_MESSAGE_CLASS}>{copy.body}</p>

          {bookingId && (
            <p className={GUEST_MUTED_CLASS}>
              Booking ID: <span className="font-mono font-semibold text-guest-text">{bookingId}</span>
            </p>
          )}

          {/* The number is a tap-to-call link, as on the parking booking page and every other guest page. */}
          <p className={cn('border-t border-guest-border pt-4', GUEST_MUTED_CLASS)}>
            Please try the payment link again, or call <GuestPhoneLink />.
          </p>
        </div>
      </GuestCard>

      <GuestButton as="a" href={GUEST_CONTACT.website} variant="outline" fullWidth>
        Return to The Anchor website
      </GuestButton>
    </GuestShell>
  )
}
