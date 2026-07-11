import { Icon } from '@/ds'
import type { ParkingBooking } from '@/types/parking'
import { formatDateTime } from '@/lib/dateUtils'
import type { ParkingPaymentNotice, ParkingPaymentNoticeTone } from '../paymentNotice'
function formatCurrency(amount: number, currency = 'GBP', locale = 'en-GB'): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount)
}

interface PublicParkingClientProps {
  booking: ParkingBooking
  paymentNotice: ParkingPaymentNotice | null
  canRetryPayment: boolean
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

function noticeClasses(tone: ParkingPaymentNoticeTone): string {
  switch (tone) {
    case 'success':
      return 'border-green-200 bg-green-50 text-green-900'
    case 'warning':
      return 'border-amber-200 bg-amber-50 text-amber-950'
    case 'error':
      return 'border-red-200 bg-red-50 text-red-950'
    case 'info':
      return 'border-blue-200 bg-blue-50 text-blue-950'
  }
}

export default function PublicParkingClient({ booking, paymentNotice, canRetryPayment, customerFirstName }: PublicParkingClientProps) {
  const amount = booking.override_price ?? booking.calculated_price ?? 0
  const paymentStatus = booking.payment_status
  const bookingStatus = booking.status
  const headingStatus = paymentStatus === 'paid' ? 'confirmed' : canRetryPayment ? 'awaiting payment' : 'received'

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
                Parking booking {headingStatus}
              </h2>
            </div>
          </div>

          {paymentNotice && (
            <div
              role={paymentNotice.tone === 'error' ? 'alert' : 'status'}
              className={`mb-5 rounded-lg border p-4 text-sm ${noticeClasses(paymentNotice.tone)}`}
            >
              <p className="font-semibold">{paymentNotice.title}</p>
              <p className="mt-1">{paymentNotice.message}</p>
              {canRetryPayment && (
                <form action="/api/parking/payment/retry" method="post" className="mt-4">
                  <input type="hidden" name="booking_id" value={booking.id} />
                  <button
                    type="submit"
                    className="inline-flex min-h-10 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-fg hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
                  >
                    {paymentStatus === 'failed' ? 'Try payment again' : 'Pay now'}
                  </button>
                </form>
              )}
            </div>
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
              <p className="whitespace-pre-wrap break-words">{booking.notes}</p>
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
