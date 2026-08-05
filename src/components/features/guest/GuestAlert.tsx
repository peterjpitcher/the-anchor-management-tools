import { CircleAlert, CircleCheckBig, TriangleAlert, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

type GuestAlertTone = 'success' | 'notice' | 'problem'

type GuestAlertProps = {
  tone: GuestAlertTone
  title?: string
  children: React.ReactNode
  /** Defaults to `alert` for `problem`, `status` for the other two tones. */
  role?: 'alert' | 'status'
  live?: 'polite' | 'assertive' | 'off'
  icon?: LucideIcon
  /** Rendered inside the alert, e.g. the parking retry submit. */
  action?: React.ReactNode
  className?: string
}

const TONE_CLASS: Record<GuestAlertTone, string> = {
  success: 'border-anchor-success/[0.28] bg-anchor-success/[0.07] text-anchor-success',
  notice: 'border-anchor-gold/[0.35] bg-anchor-gold/[0.10] text-guest-accent-text',
  problem: 'border-anchor-danger/[0.30] bg-anchor-danger/[0.06] text-anchor-danger',
}

/**
 * Success keeps its green body text; the other two tones carry the icon and
 * title in the tone colour but drop the body back to charcoal for readability.
 */
const BODY_CLASS: Record<GuestAlertTone, string> = {
  success: 'text-anchor-success',
  notice: 'text-guest-text',
  problem: 'text-guest-text',
}

const DEFAULT_ICON: Record<GuestAlertTone, LucideIcon> = {
  success: CircleCheckBig,
  notice: TriangleAlert,
  problem: CircleAlert,
}

/**
 * The one banner for these pages. Replaces every ad hoc green, amber, yellow,
 * blue and red panel in the current guest code. Map existing tones as:
 * green to `success`, amber/yellow/blue to `notice`, red to `problem`.
 */
export function GuestAlert({
  tone,
  title,
  children,
  role,
  live,
  icon,
  action,
  className,
}: GuestAlertProps): React.JSX.Element {
  const Icon = icon ?? DEFAULT_ICON[tone]
  const resolvedRole = role ?? (tone === 'problem' ? 'alert' : 'status')

  return (
    <div
      role={resolvedRole}
      aria-live={live}
      className={cn(
        'flex gap-2.5 rounded-guest-card border',
        action ? 'p-4' : 'px-[15px] py-[13px]',
        TONE_CLASS[tone],
        className
      )}
    >
      <Icon aria-hidden="true" className="mt-[2px] h-4 w-4 shrink-0" />

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {title ? <p className="text-[13px] font-bold leading-[1.4]">{title}</p> : null}
        <div className={cn('text-[14px] leading-[1.6]', BODY_CLASS[tone])}>{children}</div>
        {action ? <div className="pt-1">{action}</div> : null}
      </div>
    </div>
  )
}
