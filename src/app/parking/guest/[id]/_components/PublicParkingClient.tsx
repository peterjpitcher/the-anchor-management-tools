import { Bell, Check, Clock, type LucideIcon } from 'lucide-react'
import {
  DetailGrid,
  GUEST_H1_CLASS,
  GUEST_INTRO_CLASS,
  GUEST_KICKER_CLASS,
  GUEST_LEAD_CLASS,
  GUEST_SUNK_BOX_CLASS,
  GuestAlert,
  GuestAmount,
  GuestBadge,
  GuestButton,
  GuestCard,
  GuestShell,
  TrustLine,
  guestBadgeToneForStatus,
} from '@/components/features/guest'
import { GUEST_CONTACT } from '@/lib/guest-contact'
import type { ParkingBooking } from '@/types/parking'
import { formatDateTime } from '@/lib/dateUtils'
import { cn } from '@/lib/utils'
import type { ParkingPaymentNotice, ParkingPaymentNoticeTone } from '../paymentNotice'
function formatCurrency(amount: number, currency = 'GBP', locale = 'en-GB'): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount)
}

// Deliberately narrower than ParkingBooking: this page is public, so it may only ever see the
// columns the guest projection selects. Staff-only fields such as `notes` are excluded here so
// that referencing one is a compile error rather than a silent data leak.
export type PublicParkingBooking = Pick<
  ParkingBooking,
  | 'id'
  | 'reference'
  | 'status'
  | 'payment_status'
  | 'start_at'
  | 'end_at'
  | 'calculated_price'
  | 'override_price'
  | 'vehicle_registration'
  | 'vehicle_make'
  | 'vehicle_model'
  | 'customer_first_name'
  | 'customer_last_name'
>

interface PublicParkingClientProps {
  booking: PublicParkingBooking
  paymentNotice: ParkingPaymentNotice | null
  canRetryPayment: boolean
  customerFirstName: string | null
}

/** Reassurance rows, rendered as one sunk box under the booking card. */
const ASSURANCES: Array<{ icon: LucideIcon; title: string; sub: string }> = [
  { icon: Check, title: 'Secure Booking', sub: 'Your details are stored securely' },
  { icon: Bell, title: 'Confirmation', sub: 'You will receive email confirmation' },
  { icon: Clock, title: 'Support', sub: 'Contact us anytime' },
]

function formatVehicle(booking: PublicParkingBooking): string {
  const parts = [booking.vehicle_make, booking.vehicle_model].filter(Boolean)
  return parts.length > 0 ? parts.join(' ') : '--'
}

function formatGuestGreeting(name: string | null, suffix: string): string {
  if (name) return `${name}, ${suffix}`
  return suffix.charAt(0).toUpperCase() + suffix.slice(1)
}

/**
 * The payment notice keeps its own four tones; the guest system has three.
 * Warning and info both read as "something needs your attention but nothing has
 * gone wrong", which is exactly `notice`.
 */
function noticeTone(tone: ParkingPaymentNoticeTone): 'success' | 'notice' | 'problem' {
  switch (tone) {
    case 'success':
      return 'success'
    case 'error':
      return 'problem'
    case 'warning':
    case 'info':
      return 'notice'
  }
}

export default function PublicParkingClient({ booking, paymentNotice, canRetryPayment, customerFirstName }: PublicParkingClientProps) {
  const amount = booking.override_price ?? booking.calculated_price ?? 0
  const paymentStatus = booking.payment_status
  const bookingStatus = booking.status
  const headingStatus = paymentStatus === 'paid' ? 'confirmed' : canRetryPayment ? 'awaiting payment' : 'received'

  // Same text as before, humanised the same way; only the wrapper is new.
  const bookingStatusLabel = bookingStatus.replace('_', ' ')
  const paymentStatusLabel = paymentStatus.replace('_', ' ')

  const retryAction = canRetryPayment ? (
    <form action="/api/parking/payment/retry" method="post" className="flex flex-col gap-2.5">
      <input type="hidden" name="booking_id" value={booking.id} />
      <GuestButton type="submit" variant="primary" size="md" fullWidth>
        {paymentStatus === 'failed' ? 'Try payment again' : 'Pay now'}
      </GuestButton>
      <TrustLine />
    </form>
  ) : null

  return (
    <GuestShell>
      <div className={GUEST_INTRO_CLASS}>
        <p className={GUEST_KICKER_CLASS}>Guest parking</p>
        <h1 className={GUEST_H1_CLASS}>Parking booking {headingStatus}</h1>
        <p className={GUEST_LEAD_CLASS}>
          {formatGuestGreeting(customerFirstName, 'your parking booking details are below.')}
        </p>
      </div>

      {paymentNotice && (
        // The role is passed explicitly rather than left to the tone default, so
        // the error case keeps `role="alert"` even if the tone map ever moves.
        <GuestAlert
          tone={noticeTone(paymentNotice.tone)}
          title={paymentNotice.title}
          role={paymentNotice.tone === 'error' ? 'alert' : 'status'}
          action={retryAction}
        >
          {paymentNotice.message}
        </GuestAlert>
      )}

      <GuestCard variant="accent" className="flex flex-col gap-5">
        <GuestAmount label="Amount" value={formatCurrency(amount)} />

        <DetailGrid
          items={[
            {
              label: 'Booking reference',
              value: <span className="font-mono">{booking.reference}</span>,
            },
            {
              label: 'Customer',
              value: `${booking.customer_first_name} ${booking.customer_last_name ?? ''}`,
            },
            {
              label: 'Vehicle registration',
              value: <span className="font-mono">{booking.vehicle_registration}</span>,
            },
            { label: 'Vehicle make/model', value: formatVehicle(booking) },
            { label: 'Start', value: formatDateTime(booking.start_at) },
            { label: 'End', value: formatDateTime(booking.end_at) },
            {
              label: 'Parking status',
              value: (
                <GuestBadge tone={guestBadgeToneForStatus(bookingStatusLabel)} dot>
                  {bookingStatusLabel}
                </GuestBadge>
              ),
            },
            {
              label: 'Payment status',
              value: (
                <GuestBadge tone={guestBadgeToneForStatus(paymentStatusLabel)} dot>
                  {paymentStatusLabel}
                </GuestBadge>
              ),
            },
          ]}
        />
      </GuestCard>

      <div className={cn(GUEST_SUNK_BOX_CLASS, 'flex flex-col gap-3')}>
        {ASSURANCES.map(({ icon: AssuranceIcon, title, sub }) => (
          <div key={title} className="flex items-start gap-2.5">
            <span
              aria-hidden="true"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-anchor-green/10 text-anchor-green"
            >
              <AssuranceIcon className="h-[15px] w-[15px]" />
            </span>
            <div className="flex min-w-0 flex-col">
              <p className="text-[13px] font-semibold leading-[1.4] text-guest-text">{title}</p>
              <p className="text-[12px] leading-[1.5] text-guest-text-muted">{sub}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2.5">
        <p className="font-anchor-body text-[13px] leading-[1.6] text-guest-text-muted">
          Need help? Call us on{' '}
          <span className="font-bold text-guest-text">{GUEST_CONTACT.phoneDisplay}</span>
        </p>

        {/*
          no-referrer: the URL of this page is the booking id, which is the only
          thing standing between a stranger and the booking, so it must not be
          handed to another origin in a Referer header.
        */}
        <a
          href={GUEST_CONTACT.website}
          referrerPolicy="no-referrer"
          className="font-anchor-body text-[13px] font-semibold leading-[1.6] text-guest-accent-text underline underline-offset-[3px] hover:no-underline"
        >
          Return to The Anchor website
        </a>
      </div>
    </GuestShell>
  )
}
