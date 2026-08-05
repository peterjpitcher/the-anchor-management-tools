import { createAdminClient } from '@/lib/supabase/admin'
import { verifyBookingToken } from '@/lib/private-bookings/booking-token'
import { formatDateFull, formatTime12Hour } from '@/lib/dateUtils'
import { formatCurrency } from '@/lib/format'
import { GUEST_CONTACT } from '@/lib/guest-contact'
import { cn } from '@/lib/utils'
import {
  DetailGrid,
  GuestAlert,
  GuestBadge,
  GuestBlockedState,
  GuestCard,
  GuestShell,
  GUEST_H1_CLASS,
  GUEST_INTRO_CLASS,
  GUEST_KICKER_CLASS,
  GUEST_SUNK_BOX_CLASS,
  guestBadgeToneForStatus,
  TrustLine,
  type GuestBadgeTone,
} from '@/components/features/guest'
import { PayPalCaptureClient } from './PayPalCaptureClient'
import { FreshPayPalLinkClient } from './FreshPayPalLinkClient'
import type { BookingStatus } from '@/types/private-bookings'

// Static and non-personal on purpose: no token, customer name or booking reference may reach
// a browser title or history entry. These routes are noindex via the X-Robots-Tag header.
export const metadata = { title: 'Your booking - The Anchor' }

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ token: string }>
  searchParams: Promise<{ fresh_payment_link?: string; payment_pending?: string }>
}

// Status badge labels: customer-friendly language only.
const statusLabels: Record<BookingStatus, string> = {
  draft: 'Pending Confirmation',
  confirmed: 'Confirmed',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

/**
 * Card headings on this page are labels, not headings, so they use Outfit at
 * 12px rather than the display serif. Kept local: the other guest routes lead
 * with the page `h1` and have no equivalent.
 */
const CARD_LABEL_CLASS =
  'font-anchor-body text-[12px] font-semibold uppercase leading-none tracking-[0.16em] text-guest-text-muted'

interface BookingRow {
  id: string
  customer_first_name: string | null
  customer_last_name: string | null
  customer_name: string
  customer_full_name: string | null
  event_date: string
  start_time: string
  end_time: string | null
  end_time_next_day: boolean | null
  guest_count: number | null
  event_type: string | null
  status: BookingStatus
  deposit_amount: number
  deposit_paid_date: string | null
  total_amount: number
  calculated_total: number | null
  vat_amount: number | null
  gross_total: number | null
  balance_remaining: number | null
  balance_due_date: string | null
  final_payment_date: string | null
  contact_email: string | null
  customer_requests: string | null
}

function InvalidToken(): React.JSX.Element {
  return (
    <GuestShell bodyClassName="gap-4">
      <GuestBlockedState
        kicker="Private hire"
        heading="Link not valid"
        lead="This booking link is invalid or has been used incorrectly. Please check the link in your email and try again."
        reason="Need help?"
        primaryAction={{ label: `Call ${GUEST_CONTACT.phoneDisplay}`, href: GUEST_CONTACT.telHref }}
        secondaryAction={{ label: 'Back to The Anchor', href: GUEST_CONTACT.website }}
      />
    </GuestShell>
  )
}

function BookingNotFound(): React.JSX.Element {
  return (
    <GuestShell bodyClassName="gap-4">
      <GuestBlockedState
        kicker="Private hire"
        heading="Booking not found"
        lead="We couldn't find the booking associated with this link. It may have been removed."
        reason="Need help?"
        primaryAction={{ label: `Call ${GUEST_CONTACT.phoneDisplay}`, href: GUEST_CONTACT.telHref }}
        secondaryAction={{ label: 'Back to The Anchor', href: GUEST_CONTACT.website }}
      />
    </GuestShell>
  )
}

type DetailEntry = { label: string; value: string | null | undefined }

/**
 * Keeps the old `DescriptionItem` behaviour: an entry with no value is dropped
 * rather than rendered as an empty cell.
 */
function presentDetails(entries: DetailEntry[]): Array<{ label: string; value: string }> {
  return entries.filter((entry): entry is { label: string; value: string } => Boolean(entry.value))
}

interface PaymentRowProps {
  name: string
  sub?: string | null
  amount: string
  badge?: { tone: GuestBadgeTone; label: string }
}

/** One money line: name and sub on the left, the figure and its badge on the right. */
function PaymentRow({ name, sub, amount, badge }: PaymentRowProps): React.JSX.Element {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="flex min-w-0 flex-col gap-[3px]">
        <p className="font-anchor-body text-[14px] font-semibold leading-[1.4] text-guest-text">
          {name}
        </p>
        {sub ? (
          <p className="font-anchor-body text-[12px] leading-[1.5] text-guest-text-muted">{sub}</p>
        ) : null}
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1.5">
        {/* DM Serif Display is weight 400 only: never embolden the figure. */}
        <p className="font-anchor-display text-[22px] font-normal leading-none tracking-[-0.02em] text-guest-text-strong">
          {amount}
        </p>
        {badge ? <GuestBadge tone={badge.tone}>{badge.label}</GuestBadge> : null}
      </div>
    </div>
  )
}

export default async function BookingPortalPage({
  params,
  searchParams,
}: PageProps): Promise<React.JSX.Element> {
  const { token } = await params
  const { fresh_payment_link } = await searchParams

  // Verify the HMAC-signed token: this is the access control mechanism
  const bookingId = verifyBookingToken(token)
  if (!bookingId) {
    return <InvalidToken />
  }

  // Use admin client: the signed token IS the authorisation
  const supabase = createAdminClient()
  const { data: booking, error } = await supabase
    .from('private_bookings_with_details')
    .select(
      'id, customer_first_name, customer_last_name, customer_name, customer_full_name, event_date, start_time, end_time, end_time_next_day, guest_count, event_type, status, deposit_amount, deposit_paid_date, total_amount, calculated_total, vat_amount, gross_total, balance_remaining, balance_due_date, final_payment_date, contact_email, customer_requests'
    )
    .eq('id', bookingId)
    .single()

  if (error || !booking) {
    return <BookingNotFound />
  }

  const b = booking as BookingRow

  const { data: balancePaymentRows } = await supabase
    .from('private_booking_payments')
    .select('amount')
    .eq('booking_id', bookingId)

  const balancePaymentsTotal = (balancePaymentRows ?? []).reduce(
    (sum, row) => sum + Number(row.amount ?? 0),
    0,
  )

  const customerName = b.customer_full_name
    || (b.customer_first_name
      ? [b.customer_first_name, b.customer_last_name].filter(Boolean).join(' ')
      : b.customer_name)

  const depositPaid = !!b.deposit_paid_date
  const balancePaid = !!b.final_payment_date
  const depositRequired = b.deposit_amount > 0
  // Booking and damage deposit, separate from the event balance and not
  // deducted from the event cost. Stored prices are net: show the customer the
  // VAT-inclusive gross total from the view, falling back to legacy net figures
  // for old rows
  const effectiveTotal = b.gross_total ?? b.calculated_total ?? b.total_amount
  const balanceRemaining = balancePaid
    ? 0
    : Math.max(0, b.balance_remaining ?? (effectiveTotal - balancePaymentsTotal))

  // Format end time, accounting for next-day events
  let endTimeDisplay: string | null = null
  if (b.end_time) {
    endTimeDisplay = formatTime12Hour(b.end_time)
    if (b.end_time_next_day) {
      endTimeDisplay += ' (next day)'
    }
  }

  const statusLabel = statusLabels[b.status] ?? b.status
  const statusTone = guestBadgeToneForStatus(statusLabel)

  const depositDue =
    depositRequired && !depositPaid && b.status !== 'cancelled' && b.status !== 'completed'

  const eventDetails = presentDetails([
    { label: 'Date', value: formatDateFull(b.event_date) },
    {
      label: 'Time',
      value: endTimeDisplay
        ? `${formatTime12Hour(b.start_time)} – ${endTimeDisplay}`
        : formatTime12Hour(b.start_time),
    },
    { label: 'Guests', value: b.guest_count != null ? `${b.guest_count} guests` : null },
    { label: 'Event type', value: b.event_type },
  ])

  return (
    <GuestShell bodyClassName="gap-4">
      {/* Intro */}
      <div className={GUEST_INTRO_CLASS}>
        <p className={GUEST_KICKER_CLASS}>Private hire</p>
        <h1 className={GUEST_H1_CLASS}>
          {b.event_type ? b.event_type : 'Private Event'} - {customerName}
        </h1>
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
          <GuestBadge tone={statusTone}>{statusLabel}</GuestBadge>
          <span className="font-anchor-body text-[14px] leading-[1.6] text-guest-text-muted">
            Your booking summary
          </span>
        </div>
      </div>

      {/* PayPal capture: active capture on return from PayPal */}
      <PayPalCaptureClient portalToken={token} depositPaid={depositPaid} />

      {/* Cancelled notice */}
      {b.status === 'cancelled' && (
        <GuestAlert tone="problem">
          This booking has been cancelled. If you believe this is an error, please contact us.
        </GuestAlert>
      )}

      {/* Event details */}
      <GuestCard>
        <h2 className={CARD_LABEL_CLASS}>Event Details</h2>
        <DetailGrid className="mt-4" items={eventDetails} />
      </GuestCard>

      {/* Payment status */}
      <GuestCard variant="accent">
        <h2 className={CARD_LABEL_CLASS}>Payment Status</h2>

        <div className="mt-4 divide-y divide-guest-border">
          {/* Deposit row */}
          <PaymentRow
            name="Deposit"
            sub={
              !depositRequired
                ? 'No deposit required'
                : depositPaid
                  ? `Paid on ${formatDateFull(b.deposit_paid_date!)}`
                  : 'Not yet received'
            }
            amount={depositRequired ? formatCurrency(b.deposit_amount) : 'None'}
            badge={{
              tone: !depositRequired || depositPaid ? 'success' : 'outstanding',
              label: !depositRequired ? 'Not required' : depositPaid ? 'Paid' : 'Outstanding',
            }}
          />

          {/* Pay now, between the deposit and total rows */}
          {depositDue && (
            <div className="flex flex-col gap-2.5 py-3">
              <FreshPayPalLinkClient portalToken={token} autoStart={fresh_payment_link === '1'} />
              <TrustLine />
              <p className="font-anchor-body text-[12px] leading-[1.6] text-guest-text-muted">
                Paying the deposit confirms that you accept the booking terms and conditions in the
                contract we&apos;ve sent to your email address. If you haven&apos;t received it,
                please contact us on {GUEST_CONTACT.phoneDisplay} or{' '}
                <a
                  href={GUEST_CONTACT.emailHref}
                  referrerPolicy="no-referrer"
                  className="text-guest-accent-text underline"
                >
                  {GUEST_CONTACT.email}
                </a>{' '}
                before paying. How we use your data:{' '}
                <a
                  href="https://www.the-anchor.pub/privacy-policy"
                  className="text-guest-accent-text underline"
                  rel="noopener noreferrer"
                  target="_blank"
                  referrerPolicy="no-referrer"
                >
                  privacy notice
                </a>
                .
              </p>
            </div>
          )}

          {/* Total row */}
          <PaymentRow
            name="Total"
            sub="Full event cost, includes VAT"
            amount={formatCurrency(effectiveTotal)}
          />

          {/* Balance remaining row: only shown if not fully paid */}
          {!balancePaid && balanceRemaining > 0 && (
            <PaymentRow
              name="Balance remaining"
              sub={b.balance_due_date ? `Due by ${formatDateFull(b.balance_due_date)}` : null}
              amount={formatCurrency(balanceRemaining)}
              badge={{ tone: 'outstanding', label: 'Outstanding' }}
            />
          )}
        </div>

        {/* Fully paid banner */}
        {balancePaid && (
          <GuestAlert tone="success" className="mt-4">
            Paid in full, thank you!
          </GuestAlert>
        )}
      </GuestCard>

      {/* Special requests: only if present */}
      {b.customer_requests && (
        <GuestCard>
          <h2 className={CARD_LABEL_CLASS}>Your Requests</h2>
          {/* One column: free text needs the full width, unlike the paired event facts. */}
          <DetailGrid
            className="mt-4 min-[380px]:grid-cols-1"
            items={[
              {
                label: 'Special requests',
                value: <span className="break-words">{b.customer_requests}</span>,
              },
            ]}
          />
        </GuestCard>
      )}

      {/* Contact block */}
      <div className={cn(GUEST_SUNK_BOX_CLASS, 'p-[18px] text-center')}>
        <p className="text-[14px] font-bold leading-[1.4] text-guest-text-strong">
          Questions about your booking?
        </p>
        <p className="mt-1.5 text-[14px] leading-[1.6] text-guest-text">
          Call us on{' '}
          <a
            href={GUEST_CONTACT.telHref}
            referrerPolicy="no-referrer"
            className="font-medium text-guest-accent-text underline"
          >
            {GUEST_CONTACT.phoneDisplay}
          </a>{' '}
          or email{' '}
          <a
            href={GUEST_CONTACT.emailHref}
            referrerPolicy="no-referrer"
            className="font-medium text-guest-accent-text underline"
          >
            {GUEST_CONTACT.email}
          </a>
        </p>
      </div>
    </GuestShell>
  )
}
