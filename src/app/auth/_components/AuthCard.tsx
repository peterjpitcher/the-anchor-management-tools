import Image from 'next/image'
import Link from 'next/link'
import { Icon, type IconName } from '@/ds'
import { cn } from '@/lib/utils'

type AuthIconTone = 'danger' | 'warning' | 'success'

/** The status circle above the title on the error, access and invite-link screens. */
const AUTH_ICON_TONE: Record<AuthIconTone, string> = {
  danger: 'bg-danger-soft text-danger',
  warning: 'bg-warning-soft text-warning',
  success: 'bg-success-soft text-success',
}

type AuthCardProps = {
  title: string
  lead?: React.ReactNode
  /** A status icon above the title. The title and lead centre under it. */
  icon?: { name: IconName; tone: AuthIconTone }
  /** Small print under the card body: a support link, the copyright line. */
  footer?: React.ReactNode
  children?: React.ReactNode
}

/**
 * The card every standalone sign-in screen shares: sign in, forgotten password, set a new
 * password, the /error and /unauthorized screens and the employee invite-link states. One look,
 * with the Orange Jelly logo, so the journey from forgetting a password to choosing a new one (or
 * landing on an error) stays in one visual system.
 *
 * Phones get the card full width without its frame; from the shell breakpoint up it is a framed
 * 384px card centred on the page.
 */
export function AuthCard({ title, lead, icon, footer, children }: AuthCardProps): React.JSX.Element {
  const centred = Boolean(icon)

  return (
    <div className="flex min-h-dvh w-full flex-col items-center bg-bg px-4 py-6 shell:justify-center shell:p-10">
      <div className="w-full rounded-lg bg-surface p-6 shell:max-w-sm shell:border shell:border-border shell:p-9 shell:shadow-lg">
        <div className="mb-6">
          <Image
            src="/orange-jelly/logo-horizontal.png"
            alt="Orange Jelly"
            width={1200}
            height={257}
            className="h-auto w-60"
            priority
          />
          <p className="text-xs text-text-muted">Management Tools</p>
        </div>

        {icon ? (
          <div className="mb-4 flex justify-center">
            <span
              className={cn('flex h-14 w-14 items-center justify-center rounded-full', AUTH_ICON_TONE[icon.tone])}
              aria-hidden="true"
            >
              <Icon name={icon.name} size={28} />
            </span>
          </div>
        ) : null}

        <h1 className={cn('mb-1 text-xl font-bold tracking-tight text-text-strong', centred && 'text-center')}>
          {title}
        </h1>
        {lead ? (
          <p className={cn('text-ui text-text-muted', children ? 'mb-5' : undefined, centred && 'text-center')}>{lead}</p>
        ) : null}

        {children}

        {footer ? <div className="mt-7 text-center text-xs text-text-soft">{footer}</div> : null}
      </div>
    </div>
  )
}

/** A text link on the sign-in screens ("Forgot password?", "Back to Sign In"). */
export function AuthLink({
  href,
  children,
  className,
}: {
  href: string
  children: React.ReactNode
  className?: string
}): React.JSX.Element {
  const classes = cn(
    'inline-flex items-center gap-1 rounded-sm text-xs font-medium text-primary hover:underline',
    'focus-visible:outline-hidden focus-visible:shadow-ring',
    className,
  )

  // A mailto: address is not a route, so it stays a plain anchor.
  if (href.startsWith('mailto:')) {
    return (
      <a href={href} className={classes}>
        {children}
      </a>
    )
  }

  return (
    <Link href={href} className={classes}>
      {children}
    </Link>
  )
}

/** The "or" rule between password sign-in and single sign-on. */
export function AuthDivider({ children = 'or' }: { children?: React.ReactNode }): React.JSX.Element {
  return (
    <div className="my-4 flex items-center gap-3 text-meta text-text-muted">
      <span className="h-px flex-1 bg-border" aria-hidden="true" />
      {children}
      <span className="h-px flex-1 bg-border" aria-hidden="true" />
    </div>
  )
}
