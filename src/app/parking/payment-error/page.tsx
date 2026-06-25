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

export const dynamic = 'force-dynamic'

export default async function ParkingPaymentErrorPage({ searchParams }: ParkingPaymentErrorPageProps) {
  const resolvedSearch = searchParams ? await searchParams : {}
  const reason = Array.isArray(resolvedSearch.reason) ? resolvedSearch.reason[0] : resolvedSearch.reason
  const bookingId = Array.isArray(resolvedSearch.booking_id) ? resolvedSearch.booking_id[0] : resolvedSearch.booking_id
  const copy = COPY[reason || ''] ?? {
    title: 'Parking payment issue',
    body: 'We could not confirm this parking payment.',
  }
  const phone = process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || '01753 682707'

  return (
    <div className="public">
      <div className="public__hero public__hero--slim">
        <div className="public__hero-bg" />
        <div className="public__hero-inner">
          <div className="public__brand-mini">The Anchor</div>
          <h1 className="public__hero-title">Guest Parking</h1>
          <p className="public__hero-sub">{copy.title}</p>
        </div>
      </div>

      <div className="public__main public__main--prose">
        <div className="public__card">
          <h2 className="text-lg font-semibold text-text-strong">{copy.title}</h2>
          <p className="mt-2 text-sm text-text">{copy.body}</p>
          {bookingId && (
            <p className="mt-3 text-sm text-text-muted">
              Booking ID: <span className="font-mono text-text-strong">{bookingId}</span>
            </p>
          )}
          <p className="mt-4 text-sm text-text-muted">
            Please try the payment link again, or call <span className="font-semibold text-text-strong">{phone}</span>.
          </p>
          <a href="https://www.the-anchor.pub" className="mt-5 inline-flex text-sm font-medium text-primary hover:underline">
            Return to The Anchor website
          </a>
        </div>
      </div>
    </div>
  )
}
