import { cn } from '@/lib/utils'

type TrustLineProps = {
  children?: string
  className?: string
}

/**
 * The reassurance line under a payment control. Ships on by default wherever a
 * guest is about to pay: table-payment, event-payment, the booking-portal
 * deposit and parking.
 */
export function TrustLine({ children, className }: TrustLineProps): React.JSX.Element {
  return (
    <p
      className={cn(
        'flex items-center justify-center gap-[7px] font-anchor-body text-[12px] leading-[1.5] text-guest-text-muted',
        className
      )}
    >
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 shrink-0 rounded-full bg-anchor-green-light"
      />
      {children ?? 'Secure payment via PayPal'}
    </p>
  )
}
