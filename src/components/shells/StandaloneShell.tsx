import Image from 'next/image'
import { Icon, LinkButton } from '@/ds'
import { cn } from '@/lib/utils'
import { StandaloneShellNav, type StandaloneNavItem } from './StandaloneShellNav'

type StandaloneWidth = 'default' | 'wide'

const STANDALONE_WIDTH: Record<StandaloneWidth, string> = {
  default: 'max-w-2xl',
  wide: 'max-w-5xl',
}

export interface StandaloneShellProps {
  /** Which tool this is, shown under the logo ("Staff Portal", "Employee Onboarding"). */
  label: string
  /** Tabs under the header. The current one is lit from the path. */
  navItems?: StandaloneNavItem[]
  /** Controls at the right of the header, such as Sign Out. */
  actions?: React.ReactNode
  /** `wide` for a two-column page such as the onboarding wizard and its step rail. */
  width?: StandaloneWidth
  children: React.ReactNode
}

/**
 * The frame for staff screens that sit outside the app shell: the staff portal (a staff member's
 * own shifts and holiday) and employee onboarding (a new starter's invite link). An Orange Jelly
 * header on the surface colour, a centred column on the page background, and the same spacing
 * between blocks as a staff page (24px).
 *
 * This is the page chrome for those routes, like AppShell for staff pages, so it owns the only
 * <main>. Each page puts its own StandalonePageHeader first.
 */
export function StandaloneShell({
  label,
  navItems,
  actions,
  width = 'default',
  children,
}: StandaloneShellProps): React.JSX.Element {
  const column = cn('mx-auto w-full px-4', STANDALONE_WIDTH[width])

  return (
    <div className="flex min-h-dvh flex-col bg-bg text-text">
      <header className="sticky top-0 z-10 border-b border-border bg-surface">
        <div className={cn(column, 'flex items-center justify-between gap-3 py-3')}>
          <div className="min-w-0">
            <Image
              src="/orange-jelly/logo-horizontal.png"
              alt="Orange Jelly"
              width={1200}
              height={260}
              className="h-6 w-auto"
              priority
            />
            <p className="mt-0.5 text-xs text-text-muted">{label}</p>
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>
        {navItems && navItems.length > 0 ? (
          <div className={column}>
            <StandaloneShellNav items={navItems} label={label} />
          </div>
        ) : null}
      </header>

      <main className={cn(column, 'flex-1 space-y-6 py-6')}>{children}</main>
    </div>
  )
}

export interface StandalonePageHeaderProps {
  title: string
  /** One short line, sentence case, no full stop. */
  subtitle?: React.ReactNode
  /** Page-level buttons, `size="sm"`, primary last. */
  actions?: React.ReactNode
  /** On a page below the top level: "Back to <Parent>", pointing at the direct parent. */
  backButton?: { label: string; href: string }
}

/** The title row at the top of a standalone page, sized and laid out like PageLayout's. */
export function StandalonePageHeader({ title, subtitle, actions, backButton }: StandalonePageHeaderProps): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <h1 className="text-lg font-bold tracking-tight text-text-strong shell:text-2xl">{title}</h1>
        {subtitle ? <p className="text-xs text-text-muted shell:mt-1 shell:text-sm">{subtitle}</p> : null}
      </div>
      {actions || backButton ? (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {actions}
          {/* The same ghost button, size and chevron as PageLayout's back button. */}
          {backButton ? (
            <LinkButton href={backButton.href} variant="ghost" icon={<Icon name="chevronLeft" size={16} />}>
              {backButton.label}
            </LinkButton>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
