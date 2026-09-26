import { cn } from '@/lib/utils'
import { guestFontClassName } from '@/lib/fonts/guest'
import { GUEST_CONTACT } from '@/lib/guest-contact'

type GuestShellWidth = 'default' | 'wide'

type GuestShellProps = {
  children: React.ReactNode
  /**
   * The body column. `default` (560px) suits a task or a payment; `wide` (672px)
   * is for pages carrying a longer form or prose: table-manage, private feedback,
   * the interview booking, the legacy link check and the privacy policy.
   */
  width?: GuestShellWidth
  /** Centre the column and its text. The two short feedback pages use it. */
  centred?: boolean
}

/** One whole class per width (UI_UX rule 10). */
const WIDTH_CLASS: Record<GuestShellWidth, string> = {
  default: 'max-w-guest',
  wide: 'max-w-guest-wide',
}

/** Footer text on the dark green band. */
const FOOTER_LINK_CLASS =
  'font-anchor-body text-guest-small font-medium text-anchor-gold-bright no-underline hover:underline'
const FOOTER_MINOR_LINK_CLASS =
  'font-anchor-body text-guest-note text-guest-on-dark-soft no-underline hover:underline'

/**
 * Brand bar, cream body and footer: the shell every guest page sits in.
 *
 * This owns the ONLY `<main>` on the page, and it spaces its children one
 * rhythm apart (`gap-guest-lg`, 18px). Pass the page's blocks straight in:
 * no wrapper stack, no margins between blocks, no padding or width overrides.
 * Page roots that render inside it use `<section>`, `<form>` or `<div>`, never
 * a second `<main>`.
 *
 * It is also the single place that applies `guest-theme` and the three guest
 * font variables, so no guest styling and no guest webfont can reach a staff
 * screen.
 */
export function GuestShell({
  children,
  width = 'default',
  centred = false,
}: GuestShellProps): React.JSX.Element {
  return (
    <div
      className={cn(
        'guest-theme flex min-h-screen flex-col bg-guest-bg font-anchor-body text-guest-text',
        guestFontClassName
      )}
    >
      <header className="w-full border-b-3 border-anchor-gold bg-anchor-green px-5 py-guest-md">
        {/*
          Plain <img>: the wordmark is a fixed 116px on every breakpoint, so the
          responsive machinery in next/image buys nothing here. Intrinsic
          dimensions are the asset's own 934x421, which reserves the right box
          and keeps the aspect ratio exact. Never recolour or stretch it.
        */}
        <img
          src="/guest/anchor-logo-white.png"
          alt="The Anchor"
          width={934}
          height={421}
          className="mx-auto block h-auto w-guest-logo"
        />
      </header>

      <main
        className={cn(
          'mx-auto flex w-full flex-1 flex-col gap-guest-lg px-guest-lg pt-guest-2xl pb-guest-3xl sm:px-6 sm:pt-10 sm:pb-12',
          WIDTH_CLASS[width],
          centred && 'items-center text-center'
        )}
      >
        {children}
      </main>

      <footer className="w-full bg-anchor-green-deep px-5 py-guest-xl">
        <div className="mx-auto flex w-full max-w-guest flex-col gap-guest-sm">
          <p className="font-anchor-body text-guest-note text-guest-on-dark-muted">
            {GUEST_CONTACT.addressLine}
          </p>

          {/*
            Every link here sets referrerPolicy="no-referrer". next.config.mjs
            sends `Referrer-Policy: strict-origin-when-cross-origin`, which
            leaks the FULL path on same-origin navigation. These pages carry a
            bearer token in the URL, so /privacy would otherwise collect
            /g/<token>/... in its logs.
          */}
          <a href={GUEST_CONTACT.telHref} referrerPolicy="no-referrer" className={FOOTER_LINK_CLASS}>
            {GUEST_CONTACT.phoneDisplay}
          </a>

          <a href={GUEST_CONTACT.emailHref} referrerPolicy="no-referrer" className={FOOTER_LINK_CLASS}>
            {GUEST_CONTACT.email}
          </a>

          <div className="flex flex-wrap gap-4 border-t border-guest-on-dark-rule pt-guest-sm">
            <a href={GUEST_CONTACT.website} referrerPolicy="no-referrer" className={FOOTER_MINOR_LINK_CLASS}>
              The Anchor website
            </a>
            <a href="/privacy" referrerPolicy="no-referrer" className={FOOTER_MINOR_LINK_CLASS}>
              Privacy
            </a>
          </div>
        </div>
      </footer>
    </div>
  )
}
