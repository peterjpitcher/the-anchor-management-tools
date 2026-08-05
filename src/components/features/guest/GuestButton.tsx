import Link from 'next/link'
import { cn } from '@/lib/utils'

type GuestButtonVariant = 'primary' | 'outline' | 'ghost' | 'danger'
type GuestButtonSize = 'sm' | 'md' | 'lg'

type GuestButtonBase = {
  variant?: GuestButtonVariant
  size?: GuestButtonSize
  /**
   * Explicit rather than an implicit breakpoint rule (spec C3). `/feedback` and
   * the blocked states pass this at all widths.
   */
  fullWidth?: boolean
  children: React.ReactNode
  className?: string
}

export type GuestButtonProps =
  | (GuestButtonBase & {
      as?: 'button'
      type?: 'button' | 'submit'
      disabled?: boolean
      onClick?: () => void
    })
  | (GuestButtonBase & { as: 'a'; href: string; external?: boolean; referrerPolicy?: string })
  | (GuestButtonBase & { as: 'link'; href: string })

/**
 * `guest-motion-lift` is the hook the reduced-motion block in globals.css uses
 * to drop the hover lift. Keep it on anything that translates on hover.
 */
// `guest-btn` is the hook that exempts this button from the global mobile touch-target rule in
// globals.css. That rule forces every button to 44px below 768px, which would flatten the `md`
// (48px) and `lg` (56px) sizes on exactly the mobile widths these pages are designed for. Every
// size below is at least 44px, so opting out does not weaken the touch-target guarantee.
const BASE_CLASS =
  'guest-btn guest-motion-lift inline-flex items-center justify-center rounded-full border-2 border-transparent text-center font-anchor-body font-semibold no-underline transition-[transform,translate,background-color,box-shadow,color] duration-200 ease-out active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none'

const SIZE_CLASS: Record<GuestButtonSize, string> = {
  sm: 'min-h-[44px] px-6 text-[14px]',
  md: 'min-h-[48px] px-8 text-[16px]',
  lg: 'min-h-[56px] px-12 text-[18px]',
}

/**
 * Primary is `#8b6914` on white text, NOT the handoff's `#a57626` (spec C1).
 * `#a57626` against white is 4.02:1 and these labels are 14 to 18px semibold,
 * which is not WCAG large text, so it fails AA. `#8b6914` measures 5.09:1 and
 * is the design system's own designated AA-safe gold. The lighter gold is kept
 * everywhere it carries no text: the card accent rule, active stars, borders.
 */
const VARIANT_CLASS: Record<GuestButtonVariant, string> = {
  primary:
    'bg-anchor-gold-dark text-white hover:-translate-y-0.5 hover:bg-anchor-gold-deep hover:shadow-guest-gold',
  outline:
    'border-anchor-green bg-transparent text-anchor-green hover:-translate-y-0.5 hover:bg-anchor-green hover:text-anchor-cream',
  ghost: 'bg-transparent text-guest-text hover:bg-anchor-charcoal/[0.06]',
  danger:
    'border-anchor-danger/[0.45] bg-transparent text-anchor-danger hover:bg-anchor-danger/[0.06]',
}

/**
 * The pill action used across every guest page.
 *
 * A discriminated union over `as`, so a link is always an `<a>` or a
 * `next/link` and never an anchor nested inside a `<button>`.
 *
 * One `primary` per task card or form, not per page (spec C3): `table-manage`
 * legitimately has two independent forms.
 */
export function GuestButton(props: GuestButtonProps): React.JSX.Element {
  const { variant = 'primary', size = 'md', fullWidth = false, children, className } = props

  const classes = cn(
    BASE_CLASS,
    SIZE_CLASS[size],
    VARIANT_CLASS[variant],
    fullWidth && 'w-full',
    className
  )

  if (props.as === 'a') {
    // no-referrer by default: these pages carry bearer tokens in the URL and
    // the app's Referrer-Policy would otherwise send the full path onward.
    const externalAttributes = props.external
      ? { target: '_blank', rel: 'noopener noreferrer' }
      : {}

    return (
      <a
        href={props.href}
        className={classes}
        // The prop is `string` per the component contract, while React narrows
        // the attribute to its own union. Browsers ignore an unrecognised
        // policy, so a widened value can only ever fall back to the header.
        referrerPolicy={
          (props.referrerPolicy ?? 'no-referrer') as React.HTMLAttributeReferrerPolicy
        }
        {...externalAttributes}
      >
        {children}
      </a>
    )
  }

  if (props.as === 'link') {
    return (
      <Link href={props.href} className={classes} referrerPolicy="no-referrer">
        {children}
      </Link>
    )
  }

  return (
    <button
      type={props.type ?? 'button'}
      className={classes}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {children}
    </button>
  )
}
