import Image from 'next/image'
import { cn } from '@/lib/utils'

type KioskWidth = 'narrow' | 'wide'

const KIOSK_WIDTH: Record<KioskWidth, string> = {
  narrow: 'max-w-xl',
  wide: 'max-w-6xl',
}

export interface KioskShellProps {
  /** The screen's name: the page's one heading, in the dark band. */
  title: string
  /** A small line above the title, such as the event's date and time. */
  eyebrow?: React.ReactNode
  /** A line under the title. */
  subtitle?: React.ReactNode
  /** The right of the header on a wide screen (under the title on a phone), such as a live clock. */
  aside?: React.ReactNode
  /** `wide` for a grid of tiles (the timeclock), `narrow` for one card (event check-in). */
  width?: KioskWidth
  /** Small print at the foot of the screen. */
  footer?: React.ReactNode
  children: React.ReactNode
}

/**
 * The frame for the shared iPad kiosks that sit outside the app shell: the staff timeclock and
 * event check-in. A dark Anchor band carries the logo, the title and an optional clock; the body
 * below is the ordinary light staff surface, so everything in it is plain DS (cards, figures,
 * fields, buttons).
 *
 * `data-touch-targets` lifts every control inside to the 44px touch floor on a touch screen,
 * whatever the width, because these screens live on an iPad in landscape.
 *
 * This is the kiosk's page chrome, like AppShell for staff pages, so it owns the page's only
 * <main> and its heading. The band is the same brand colour PageLayout's dark FOH header uses.
 */
export function KioskShell({
  title,
  eyebrow,
  subtitle,
  aside,
  width = 'wide',
  footer,
  children,
}: KioskShellProps): React.JSX.Element {
  const inner = cn('mx-auto w-full px-4 shell:px-8', KIOSK_WIDTH[width])

  return (
    <div data-touch-targets="" className="flex min-h-dvh flex-col bg-bg text-text">
      <header className="bg-brand-700 text-on-dark">
        <div className={cn(inner, 'flex flex-col gap-4 py-6 shell:flex-row shell:items-end shell:justify-between shell:py-8')}>
          <div className="min-w-0">
            <Image src="/logo.png" alt="The Anchor" width={400} height={180} priority className="h-auto w-28" />
            {eyebrow ? (
              <p className="mt-5 text-xs font-semibold uppercase tracking-wider text-on-dark-muted">{eyebrow}</p>
            ) : null}
            <h1 className={cn('text-2xl font-bold leading-tight tracking-tight shell:text-3xl', eyebrow ? 'mt-1' : 'mt-5')}>
              {title}
            </h1>
            {subtitle ? <p className="mt-1 text-sm text-on-dark-muted">{subtitle}</p> : null}
          </div>
          {aside ? <div className="shrink-0 shell:text-right">{aside}</div> : null}
        </div>
      </header>

      <main className={cn(inner, 'flex-1 space-y-6 py-6 shell:py-8')}>{children}</main>

      {footer ? (
        <footer className={cn(inner, 'pb-6 text-center text-xs text-text-soft')}>{footer}</footer>
      ) : null}
    </div>
  )
}
