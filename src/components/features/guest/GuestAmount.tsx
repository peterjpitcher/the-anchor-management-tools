import { clsx } from 'clsx'
import { GUEST_LABEL_CLASS } from './styles'

type GuestAmountSize = 'page' | 'title' | 'inline'

type GuestAmountProps = {
  label: string
  value: React.ReactNode
  /** Optional line under the figure, e.g. what the amount covers. */
  sub?: React.ReactNode
  /**
   * `page` is the large statement (48px, 60px from 640px): the money due, or the
   * seats being held, the page's primary trust signal. `title` names the record
   * a card is about (a booking reference, an event). `inline` is the booking
   * portal's right-aligned row figure.
   */
  size?: GuestAmountSize
}

const VALUE_CLASS: Record<GuestAmountSize, string> = {
  page: 'text-guest-amount sm:text-guest-amount-wide',
  title: 'break-words text-guest-figure',
  inline: 'text-guest-h2 leading-guest-flat',
}

/**
 * A labelled statement figure. DM Serif Display is weight 400 only: never
 * embolden it.
 */
export function GuestAmount({ label, value, sub, size = 'page' }: GuestAmountProps): React.JSX.Element {
  const inline = size === 'inline'

  return (
    <div className={clsx('flex min-w-0 flex-col gap-guest-2xs', inline && 'items-end text-right')}>
      <span className={GUEST_LABEL_CLASS}>{label}</span>

      <span className={clsx('font-anchor-display font-normal text-guest-text-strong', VALUE_CLASS[size])}>
        {value}
      </span>

      {sub ? <span className="font-anchor-body text-guest-lead text-guest-text-muted">{sub}</span> : null}
    </div>
  )
}
