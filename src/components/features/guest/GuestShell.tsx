import { guestFontClassName } from '@/lib/fonts/guest'
import { GUEST_CONTACT } from '@/lib/guest-contact'
import { cn } from '@/lib/utils'

type GuestShellProps = {
  children: React.ReactNode
  /** Body column width. `table-manage` and `private-feedback` pass `max-w-2xl`. */
  maxWidthClassName?: string
  /** Padding override, for the two short centred feedback pages. */
  bodyClassName?: string
  /** Centre the column and its text. */
  centred?: boolean
}

/**
 * Brand bar, cream body and footer: the shell every guest page sits in.
 *
 * This owns the ONLY `<main>` on the page. Page roots that render inside it
 * must use `<section>`, `<form>` or `<div>`, never a second `<main>`.
 *
 * It is also the single place that applies `guest-theme` and the three guest
 * font variables, so no guest styling and no guest webfont can reach a staff
 * screen.
 */
export function GuestShell({
  children,
  maxWidthClassName = 'max-w-[560px]',
  bodyClassName,
  centred = false,
}: GuestShellProps): React.JSX.Element {
  return (
    <div
      className={cn(
        'guest-theme flex min-h-screen flex-col bg-guest-bg font-anchor-body text-guest-text',
        guestFontClassName
      )}
    >
      <header className="w-full border-b-[3px] border-anchor-gold bg-anchor-green px-5 py-[15px]">
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
          className="mx-auto block h-auto w-[116px]"
        />
      </header>

      <main
        className={cn(
          'mx-auto flex w-full flex-1 flex-col gap-[18px] px-[18px] pt-[26px] pb-[30px] sm:px-6 sm:pt-10 sm:pb-12',
          maxWidthClassName,
          centred && 'items-center text-center',
          bodyClassName
        )}
      >
        {children}
      </main>

      <footer className="w-full bg-anchor-green-deep px-5 py-[22px]">
        <div className="mx-auto flex w-full max-w-[560px] flex-col gap-[11px]">
          <p className="text-[12px] leading-[1.6] text-anchor-cream-text/70">
            {GUEST_CONTACT.addressLine}
          </p>

          {/*
            Every link here sets referrerPolicy="no-referrer". next.config.mjs
            sends `Referrer-Policy: strict-origin-when-cross-origin`, which
            leaks the FULL path on same-origin navigation. These pages carry a
            bearer token in the URL, so /privacy would otherwise collect
            /g/<token>/... in its logs.
          */}
          <a
            href={GUEST_CONTACT.telHref}
            referrerPolicy="no-referrer"
            className="text-[13px] font-medium text-anchor-gold-bright no-underline hover:underline"
          >
            {GUEST_CONTACT.phoneDisplay}
          </a>

          <a
            href={GUEST_CONTACT.emailHref}
            referrerPolicy="no-referrer"
            className="text-[13px] font-medium text-anchor-gold-bright no-underline hover:underline"
          >
            {GUEST_CONTACT.email}
          </a>

          <div className="flex flex-wrap gap-4 border-t border-anchor-gold-bright/25 pt-[11px]">
            <a
              href={GUEST_CONTACT.website}
              referrerPolicy="no-referrer"
              className="text-[12px] text-anchor-cream-text/[0.82] no-underline hover:underline"
            >
              The Anchor website
            </a>
            <a
              href="/privacy"
              referrerPolicy="no-referrer"
              className="text-[12px] text-anchor-cream-text/[0.82] no-underline hover:underline"
            >
              Privacy
            </a>
          </div>
        </div>
      </footer>
    </div>
  )
}
