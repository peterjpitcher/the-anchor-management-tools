import { Icon } from '@/ds'

interface BookingConfirmationClientProps {
  reference: string
  guestName: string
  date: string
  time: string
  partySize: number
}

export default function BookingConfirmationClient({
  reference,
  guestName,
  date,
  time,
  partySize,
}: BookingConfirmationClientProps) {
  return (
    <div className="public">
      <div className="public__hero public__hero--slim">
        <div className="public__hero-bg" />
        <div className="public__hero-inner">
          <div className="public__brand-mini">The Anchor</div>
          <h1 className="public__hero-title">Booking Confirmed</h1>
        </div>
      </div>

      <div className="public__main">
        {/* Success icon */}
        <div className="public__check">
          <Icon name="check" size={32} />
        </div>

        <h2 className="public__h2 text-center">Booking Confirmed!</h2>
        <p className="text-sm text-text-muted text-center mb-6">
          Thank you, {guestName}. Your table has been reserved.
        </p>

        {/* Ticket stub */}
        <div className="public__ticket">
          <div className="public__ticket-stub">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-text-muted">Booking Reference</p>
              <p className="text-lg font-bold text-text-strong mt-1">{reference}</p>
            </div>
            <div className="public__ticket-qr">
              {/* QR code placeholder */}
              <div className="w-full h-full bg-surface-2 rounded flex items-center justify-center text-text-subtle text-xs">
                QR
              </div>
            </div>
          </div>

          <hr className="public__ticket-divider" />

          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-text-muted">Date</p>
              <p className="font-medium text-text-strong mt-0.5">{date}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-text-muted">Time</p>
              <p className="font-medium text-text-strong mt-0.5">{time}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-text-muted">Party Size</p>
              <p className="font-medium text-text-strong mt-0.5">{partySize} {partySize === 1 ? 'guest' : 'guests'}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-text-muted">Guest</p>
              <p className="font-medium text-text-strong mt-0.5">{guestName}</p>
            </div>
          </div>
        </div>

        {/* What happens next */}
        <div className="public__what-next">
          <h3 className="text-sm font-semibold text-text-strong mb-3">What happens next</h3>
          <ol className="text-sm text-text-muted space-y-2 list-decimal list-inside">
            <li>You will receive a confirmation email shortly</li>
            <li>A reminder will be sent 24 hours before your booking</li>
            <li>To cancel or amend, reply to the confirmation email or call us on 01753 682707</li>
          </ol>
        </div>

        <div className="mt-6 text-center">
          <a
            href="https://www.the-anchor.pub"
            className="text-sm font-medium text-primary hover:underline"
          >
            Back to The Anchor website
          </a>
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
