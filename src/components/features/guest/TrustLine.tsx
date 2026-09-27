type TrustLineProps = {
  children?: string
}

/**
 * The reassurance line under a payment control. Ships on by default wherever a
 * guest is about to pay: table-payment, event-payment, the booking-portal
 * deposit and parking.
 */
export function TrustLine({ children }: TrustLineProps): React.JSX.Element {
  return (
    <p className="flex items-center justify-center gap-guest-xs font-anchor-body text-guest-note text-guest-text-muted">
      <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-anchor-green-light" />
      {children ?? 'Secure payment via PayPal'}
    </p>
  )
}
