import { Icon } from '@/ds'
import type { ParkingBooking } from '@/types/parking'
import { formatDateTime } from '@/lib/dateUtils'
import { formatCurrency } from '@/components/ui-v2/utils/format'

interface PublicParkingClientProps {
  booking: ParkingBooking
  paymentMessage: string | null
  customerFirstName: string | null
}

function formatVehicle(booking: ParkingBooking): string {
  const parts = [booking.vehicle_make, booking.vehicle_model].filter(Boolean)
  return parts.length > 0 ? parts.join(' ') : '--'
}

function formatGuestGreeting(name: string | null, suffix: string): string {
  if (name) return `${name}, ${suffix}`
  return suffix.charAt(0).toUpperCase() + suffix.slice(1)
}

export default function PublicParkingClient({ booking, paymentMessage, customerFirstName }: PublicParkingClientProps) {
  const amount = booking.override_price ?? booking.calculated_price ?? 0
  const paymentStatus = booking.payment_status
  const bookingStatus = booking.status

  return (
    <div className="public">
      <div className="public__hero public__hero--slim">
        <div className="public__hero-bg" />
        <div className="public__hero-inner">
          <div className="public__brand-mini">The Anchor</div>
          <h1 className="public__hero-title">Guest Parking</h1>
          <p className="public__hero-sub">
            {formatGuestGreeting(customerFirstName, 'your parking booking details are below.')}
          </p>
        </div>
      </div>

      <div className="public__main">
        <div className="public__card">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 rounded-full bg-primary-soft flex items-center justify-center">
              <Icon name="truck" size={20} className="text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-text-strong">
                Parking booking {paymentStatus === 'paid' ? 'confirmed' : 'received'}
              </h2>
            </div>
          </div>

          {paymentMessage && (
            <p className="text-sm text-text-muted mb-5">{paymentMessage}</p>
          )}

          <dl className="grid gap-4 sm:grid-cols-2">
            <Detail label="Booking reference" value={booking.reference} />
            <Detail label="Customer" value={`${booking.customer_first_name} ${booking.customer_last_name ?? ''}`} />
            <Detail label="Vehicle registration" value={booking.vehicle_registration} />
            <Detail label="Vehicle make/model" value={formatVehicle(booking)} />
            <Detail label="Start" value={formatDateTime(booking.start_at)} />
            <Detail label="End" value={formatDateTime(booking.end_at)} />
            <Detail label="Parking status" value={bookingStatus.replace('_', ' ')} />
            <Detail label="Payment status" value={paymentStatus.replace('_', ' ')} />
          </dl>

          {/* Pricing breakdown */}
          <div className="public__pricing">
            <div className="public__total">
              <span>Amount</span>
              <span>{formatCurrency(amount)}</span>
            </div>
          </div>

          {booking.notes && (
            <div className="mt-5 bg-surface-2 rounded-lg border border-border p-4 text-sm text-text">
              <p className="font-medium text-text-strong mb-1">Notes</p>
              <p className="whitespace-pre-wrap">{booking.notes}</p>
            </div>
          )}

          <div className="mt-6 flex flex-col sm:flex-row gap-3 justify-between items-center">
            <p className="text-sm text-text-muted">
              Need help? Call us on{' '}
              <span className="font-semibold text-text-strong">{process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || '01753 682707'}</span>
            </p>
            <a
              href="https://www.the-anchor.pub"
              className="text-sm font-medium text-primary hover:underline"
            >
              Return to The Anchor website
            </a>
          </div>
        </div>

        <div className="public__assurance">
          <div className="public__assure">
            <div className="public__assure-icon">
              <Icon name="check" size={16} />
            </div>
            <div>
              <p className="text-sm font-medium text-text-strong">Secure Booking</p>
              <p className="text-xs text-text-muted">Your details are stored securely</p>
            </div>
          </div>
          <div className="public__assure">
            <div className="public__assure-icon">
              <Icon name="bell" size={16} />
            </div>
            <div>
              <p className="text-sm font-medium text-text-strong">Confirmation</p>
              <p className="text-xs text-text-muted">You will receive email confirmation</p>
            </div>
          </div>
          <div className="public__assure">
            <div className="public__assure-icon">
              <Icon name="clock" size={16} />
            </div>
            <div>
              <p className="text-sm font-medium text-text-strong">Support</p>
              <p className="text-xs text-text-muted">Contact us anytime</p>
            </div>
          </div>
        </div>
      </div>

      <div className="public__footer">
        <span>&copy; {new Date().getFullYear()} The Anchor, Staines-upon-Thames</span>
        <div>
          <a href="/privacy" className="public__link">Privacy Policy</a>
        </div>
      </div>
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wider text-text-muted">{label}</dt>
      <dd className="mt-1 text-sm text-text-strong">{value}</dd>
    </div>
  )
}
