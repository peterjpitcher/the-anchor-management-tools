import { GuestBadge } from '@/components/features/guest/GuestBadge'
import { GuestButton } from '@/components/features/guest/GuestButton'
import { GuestCard } from '@/components/features/guest/GuestCard'
import { GuestIntro } from '@/components/features/guest/GuestIntro'
import { GuestStatusMark } from '@/components/features/guest/GuestStatusMark'
import { GUEST_H2_CLASS, GUEST_MESSAGE_CLASS, GUEST_MUTED_CLASS } from '@/components/features/guest/styles'
import { GUEST_CONTACT } from '@/lib/guest-contact'
import { formatGuestGreeting } from '@/lib/guest/names'

/**
 * How the deposit confirmation reached the guest, so the panel names the channel it actually went
 * by and never says "text" for an email (R11):
 *  - 'email' or 'sms': this capture sent it, by that channel;
 *  - 'not_sent': this capture could not send it, so the guest is asked to call;
 *  - 'earlier': the deposit was already recorded (a returning guest, or a webhook got there
 *    first), so no channel is claimed.
 */
export type TablePaymentConfirmation = 'email' | 'sms' | 'not_sent' | 'earlier'

/** The serialisable half of the panel, computed on the server and handed to the client. */
export type TablePaymentSuccessDetails = {
  guestFirstName: string | null
  /**
   * Set for a Christmas booking (spec section 2 step 2, D3): the screen leads with choosing
   * everyone's food and shows the deadline, already worded in London time on the server.
   */
  christmas?: { foodDeadlineLabel: string | null } | null
}

type TablePaymentSuccessPanelProps = TablePaymentSuccessDetails & {
  confirmation?: TablePaymentConfirmation
}

function confirmationSentence(confirmation: TablePaymentConfirmation): string {
  switch (confirmation) {
    case 'email':
      return "Thanks. Your booking is confirmed, and we've emailed your confirmation."
    case 'sms':
      return "Thanks. Your booking is confirmed, and we've texted your confirmation."
    case 'not_sent':
      return `Thanks. Your booking is confirmed, but we couldn't send your confirmation just now. Call us on ${GUEST_CONTACT.phoneDisplay} and we'll go through it with you.`
    case 'earlier':
    default:
      return 'Thanks. Your deposit is paid and your booking is confirmed.'
  }
}

function foodLinkSentence(confirmation: TablePaymentConfirmation): string {
  switch (confirmation) {
    case 'email':
      return "Your link to choose everyone's food is in the email we've just sent."
    case 'sms':
      return "Your link to choose everyone's food is in the text we've just sent."
    case 'not_sent':
      return `Call us on ${GUEST_CONTACT.phoneDisplay} and we'll send your link to choose everyone's food.`
    case 'earlier':
    default:
      return "Your link to choose everyone's food is in your booking confirmation."
  }
}

/**
 * The one "deposit received" presentation, shared by both success paths.
 *
 * The server page renders it directly when `payment_status` is already
 * `completed`, and `TablePaymentClient` renders the very same component once
 * a capture succeeds in the browser, with the channel the capture reported,
 * so a guest who pays in front of us sees what a guest returning to an
 * already-paid link sees, apart from the one line about their message.
 * Keeping one component is what makes that guarantee testable (spec,
 * "table-payment success-state boundary").
 *
 * Hook-free and free of server-only imports, so it renders on either side of
 * the boundary.
 */
export function TablePaymentSuccessPanel({
  guestFirstName,
  christmas = null,
  confirmation = 'earlier',
}: TablePaymentSuccessPanelProps): React.JSX.Element {
  return (
    <>
      <GuestIntro
        kicker={christmas ? 'Christmas booking' : 'Table booking'}
        title="Deposit received"
        lead={formatGuestGreeting(guestFirstName, 'your deposit payment has been received.')}
      />

      <GuestCard variant="accent">
        <div className="flex flex-col gap-guest-md">
          <div className="flex items-center gap-3">
            <GuestStatusMark tone="success" />
            <GuestBadge tone="success">Paid</GuestBadge>
          </div>

          <p className={GUEST_MESSAGE_CLASS}>{confirmationSentence(confirmation)}</p>

          {christmas && (
            <>
              <h2 className={GUEST_H2_CLASS}>Choose everyone&apos;s food</h2>
              <p className={GUEST_MESSAGE_CLASS}>
                Thanks for booking Christmas with us. {foodLinkSentence(confirmation)}
              </p>
              {christmas.foodDeadlineLabel && (
                <p className={GUEST_MESSAGE_CLASS}>
                  Everyone&apos;s choices need to be in by {christmas.foodDeadlineLabel}.
                </p>
              )}
            </>
          )}

          {confirmation !== 'not_sent' && (
            <p className={GUEST_MUTED_CLASS}>
              If you can&apos;t find your confirmation, call {GUEST_CONTACT.phoneDisplay}.
            </p>
          )}
        </div>
      </GuestCard>

      <GuestButton as="a" href={`${GUEST_CONTACT.website}/book-table`} variant="outline" fullWidth>
        Back to The Anchor
      </GuestButton>
    </>
  )
}
