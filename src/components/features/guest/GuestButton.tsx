import Link from 'next/link'
import { clsx } from 'clsx'

type GuestButtonVariant =
  | 'primary'
  | 'outline'
  | 'ghost'
  | 'danger'
  | 'destructive'
  | 'link'
  | 'choice'
type GuestButtonSize = 'sm' | 'md' | 'lg'

type GuestButtonBase = {
  variant?: GuestButtonVariant
  /** Pill variants only. `link` and `choice` have one size each. */
  size?: GuestButtonSize
  /**
   * Explicit rather than an implicit breakpoint rule (spec C3). `true` fills the
   * column at every width; `'mobile'` fills it on a phone and sizes to the label
   * from 640px up, which is how every form's submit sits.
   */
  fullWidth?: boolean | 'mobile'
  children: React.ReactNode
  /** Layout only (a margin, an alignment). The look comes from `variant` and `size`. */
  className?: string
}

export type GuestButtonProps =
  | (GuestButtonBase & {
      as?: 'button'
      type?: 'button' | 'submit'
      disabled?: boolean
      onClick?: () => void
      /** Submitted with the form, so one form can carry two answers (e.g. yes and no). */
      name?: string
      value?: string
      /** Disables the button and marks it busy while its action runs. */
      loading?: boolean
      /** Replaces the label while `loading`, e.g. `Saving...`. */
      loadingText?: string
      /** A `choice` tile that is the current answer. */
      pressed?: boolean
      'aria-expanded'?: boolean
      'aria-controls'?: string
    })
  | (GuestButtonBase & { as: 'a'; href: string; external?: boolean; referrerPolicy?: string })
  | (GuestButtonBase & { as: 'link'; href: string })

/**
 * `guest-btn` is the hook that exempts this button from the global mobile touch-target rule in
 * globals.css. That rule forces every button to 44px below 768px, which would flatten the `md`
 * (48px) and `lg` (56px) sizes on exactly the mobile widths these pages are designed for. Every
 * size below is at least 44px, so opting out does not weaken the touch-target guarantee.
 *
 * `guest-motion-lift` is the hook the reduced-motion block in globals.css uses to drop the hover
 * lift. Keep it on anything that translates on hover.
 *
 * Classes are joined with `clsx`, never `cn()`: tailwind-merge does not know the guest type sizes
 * yet and would drop them (see styles.ts). So no two strings below may set the same property; the
 * border colour, for one, lives only in the variant.
 */
const PILL_BASE_CLASS =
  'guest-btn guest-motion-lift inline-flex items-center justify-center rounded-full border-2 text-center font-anchor-body font-semibold no-underline transition duration-200 ease-out active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none'

const SIZE_CLASS: Record<GuestButtonSize, string> = {
  sm: 'min-h-guest-touch px-6 text-guest-body',
  md: 'min-h-guest-control px-8 text-guest-control',
  lg: 'min-h-guest-control-lg px-12 text-guest-large',
}

/**
 * Primary is `#8b6914` on white text, NOT the handoff's `#a57626` (spec C1).
 * `#a57626` against white is 4.02:1 and these labels are 14 to 18px semibold,
 * which is not WCAG large text, so it fails AA. `#8b6914` measures 5.09:1 and
 * is the design system's own designated AA-safe gold. The lighter gold is kept
 * everywhere it carries no text: the card accent rule, active stars, borders.
 *
 * `destructive` is the solid red that confirms something that cannot be undone
 * (cancelling a booking); `danger` is the outlined red that starts that journey.
 */
const PILL_VARIANT_CLASS: Record<Exclude<GuestButtonVariant, 'link' | 'choice'>, string> = {
  primary:
    'border-transparent bg-anchor-gold-dark text-guest-button-text hover:-translate-y-0.5 hover:bg-anchor-gold-deep hover:shadow-guest-gold',
  outline:
    'border-anchor-green bg-transparent text-anchor-green hover:-translate-y-0.5 hover:bg-anchor-green hover:text-anchor-cream',
  ghost: 'border-transparent bg-transparent text-guest-text hover:bg-guest-hover',
  danger: 'border-guest-danger-outline bg-transparent text-anchor-danger hover:bg-guest-danger-soft',
  destructive: 'border-transparent bg-anchor-danger text-guest-button-text hover:bg-guest-danger-hover',
}

/** An inline text action, such as a "show more" toggle. Reads as a link, behaves as a button. */
const LINK_VARIANT_CLASS =
  'self-start text-left font-anchor-body text-guest-body font-semibold text-guest-accent-text underline underline-offset-3 hover:no-underline disabled:cursor-not-allowed disabled:opacity-50'

/** A full-width answer tile: a label and an optional hint, left-aligned, one tap to choose. */
const CHOICE_BASE_CLASS =
  'guest-btn flex min-h-guest-control w-full flex-col items-start justify-center gap-0.5 rounded-guest-field border-[1.5px] px-4 py-2.5 text-left font-anchor-body transition duration-200 disabled:cursor-not-allowed disabled:opacity-50'

const CHOICE_STATE_CLASS = {
  pressed: 'border-anchor-gold-dark bg-anchor-cream',
  idle: 'border-guest-border-strong bg-guest-surface hover:border-anchor-gold-dark',
} as const

/**
 * `sm:self-start` makes `mobile` hold wherever the button sits: as a direct child of a
 * column form (manage-booking, private feedback, the feedback form) a flex column would
 * otherwise stretch it back to full width at every size. From 640px a form's submit is
 * label width and left-aligned (HANDOFF.md, "Full width on mobile; auto width,
 * left-aligned at >=640px").
 */
const FULL_WIDTH_CLASS = {
  always: 'w-full',
  mobile: 'w-full sm:w-auto sm:self-start',
} as const

function classesFor(props: GuestButtonProps): string {
  const { variant = 'primary', size = 'md', fullWidth = false, className } = props
  const width = fullWidth === 'mobile' ? FULL_WIDTH_CLASS.mobile : fullWidth ? FULL_WIDTH_CLASS.always : null

  if (variant === 'link') return clsx(LINK_VARIANT_CLASS, className)

  if (variant === 'choice') {
    const pressed = props.as === undefined || props.as === 'button' ? props.pressed : false
    return clsx(CHOICE_BASE_CLASS, pressed ? CHOICE_STATE_CLASS.pressed : CHOICE_STATE_CLASS.idle, className)
  }

  return clsx(PILL_BASE_CLASS, SIZE_CLASS[size], PILL_VARIANT_CLASS[variant], width, className)
}

/**
 * The action used across every guest page: the pill buttons, the inline `link`
 * action and the `choice` answer tile.
 *
 * A discriminated union over `as`, so a link is always an `<a>` or a
 * `next/link` and never an anchor nested inside a `<button>`.
 *
 * One `primary` per task card or form, not per page (spec C3): `table-manage`
 * legitimately has two independent forms.
 */
export function GuestButton(props: GuestButtonProps): React.JSX.Element {
  const { children } = props
  const classes = classesFor(props)

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

  const loading = props.loading ?? false

  return (
    <button
      type={props.type ?? 'button'}
      className={classes}
      disabled={props.disabled || loading}
      aria-busy={loading || undefined}
      aria-pressed={props.variant === 'choice' ? props.pressed : undefined}
      aria-expanded={props['aria-expanded']}
      aria-controls={props['aria-controls']}
      onClick={props.onClick}
      name={props.name}
      value={props.value}
    >
      {loading && props.loadingText ? props.loadingText : children}
    </button>
  )
}
