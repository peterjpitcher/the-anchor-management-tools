export default function ParkingNotFound() {
  const phone = process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || '01753 682707'

  return (
    <div className="public">
      <div className="public__hero public__hero--slim">
        <div className="public__hero-bg" />
        <div className="public__hero-inner">
          <div className="public__brand-mini">The Anchor</div>
          <h1 className="public__hero-title">Guest Parking</h1>
          <p className="public__hero-sub">We could not find that parking booking.</p>
        </div>
      </div>

      <div className="public__main public__main--prose">
        <div className="public__card">
          <h2 className="text-lg font-semibold text-text-strong">Booking link not found</h2>
          <p className="mt-2 text-sm text-text">
            Please check the link, or contact the team and quote your parking reference if you have one.
          </p>
          <p className="mt-4 text-sm text-text-muted">
            Need help? Call <span className="font-semibold text-text-strong">{phone}</span>.
          </p>
          <a href="https://www.the-anchor.pub" className="mt-5 inline-flex text-sm font-medium text-primary hover:underline">
            Return to The Anchor website
          </a>
        </div>
      </div>
    </div>
  )
}
