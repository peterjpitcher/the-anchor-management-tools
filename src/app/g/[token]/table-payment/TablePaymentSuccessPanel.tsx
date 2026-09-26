import { GuestBadge } from '@/components/features/guest/GuestBadge'
import { GuestButton } from '@/components/features/guest/GuestButton'
import { GuestCard } from '@/components/features/guest/GuestCard'
import { GuestIntro } from '@/components/features/guest/GuestIntro'
import { GuestStatusMark } from '@/components/features/guest/GuestStatusMark'
import { GUEST_MESSAGE_CLASS, GUEST_MUTED_CLASS } from '@/components/features/guest/styles'
import { GUEST_CONTACT } from '@/lib/guest-contact'
import { formatGuestGreeting } from '@/lib/guest/names'

type TablePaymentSuccessPanelProps = {
  guestFirstName: string | null
}

/**
 * The one "deposit received" presentation, shared by both success paths.
 *
 * The server page renders it directly when `payment_status` is already
 * `completed`, and passes the very same element to `TablePaymentClient` as its
 * `success` prop, so a guest who pays in front of us sees exactly what a guest
 * returning to an already-paid link sees. Keeping one component is what makes
 * that guarantee testable (spec, "table-payment success-state boundary").
 *
 * Hook-free and free of server-only imports, so it renders on either side of
 * the boundary.
 */
export function TablePaymentSuccessPanel({
  guestFirstName,
}: TablePaymentSuccessPanelProps): React.JSX.Element {
  return (
    <>
      <GuestIntro
        kicker="Table booking"
        title="Deposit received"
        lead={formatGuestGreeting(guestFirstName, 'your deposit payment has been received.')}
      />

      <GuestCard variant="accent">
        <div className="flex flex-col gap-guest-md">
          <div className="flex items-center gap-3">
            <GuestStatusMark tone="success" />
            <GuestBadge tone="success">Paid</GuestBadge>
          </div>

          <p className={GUEST_MESSAGE_CLASS}>
            Thanks. We are confirming your booking now. You will receive a text confirmation
            shortly.
          </p>

          <p className={GUEST_MUTED_CLASS}>
            If you do not receive confirmation, call {GUEST_CONTACT.phoneDisplay}.
          </p>
        </div>
      </GuestCard>

      <GuestButton as="a" href={`${GUEST_CONTACT.website}/book-table`} variant="outline" fullWidth>
        Back to The Anchor
      </GuestButton>
    </>
  )
}
