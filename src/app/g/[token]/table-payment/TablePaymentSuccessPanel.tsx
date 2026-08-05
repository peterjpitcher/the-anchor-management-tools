import { Check } from 'lucide-react'
import { GuestBadge } from '@/components/features/guest/GuestBadge'
import { GuestButton } from '@/components/features/guest/GuestButton'
import { GuestCard } from '@/components/features/guest/GuestCard'
import {
  GUEST_H1_CLASS,
  GUEST_INTRO_CLASS,
  GUEST_KICKER_CLASS,
  GUEST_LEAD_CLASS,
} from '@/components/features/guest/styles'
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
      <div className={GUEST_INTRO_CLASS}>
        <p className={GUEST_KICKER_CLASS}>Table booking</p>
        <h1 className={GUEST_H1_CLASS}>Deposit received</h1>
        <p className={GUEST_LEAD_CLASS}>
          {formatGuestGreeting(guestFirstName, 'your deposit payment has been received.')}
        </p>
      </div>

      <GuestCard variant="accent">
        <div className="flex flex-col gap-[15px]">
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-anchor-success/[0.12] text-anchor-success"
            >
              <Check className="h-[18px] w-[18px]" />
            </span>
            <GuestBadge tone="success">Paid</GuestBadge>
          </div>

          <p className="font-anchor-body text-[15px] leading-[1.65] text-guest-text">
            Thanks. We are confirming your booking now. You will receive a text confirmation
            shortly.
          </p>

          <p className="font-anchor-body text-[14px] leading-[1.6] text-guest-text-muted">
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
