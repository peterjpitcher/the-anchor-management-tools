import { clsx } from 'clsx'
import { Icon, type IconName } from '@/ds/icons'
import {
  GUEST_ALERT_BODY_CLASS,
  GUEST_ALERT_TONE_CLASS,
  GUEST_TONE_ICON,
  type GuestTone,
} from './status-ui'

type GuestAlertProps = {
  /** For a control that points `aria-describedby` at this alert. */
  id?: string
  tone: GuestTone
  title?: string
  children: React.ReactNode
  /** Defaults to `alert` for `problem`, `status` for the other two tones. */
  role?: 'alert' | 'status'
  live?: 'polite' | 'assertive' | 'off'
  icon?: IconName
  /**
   * Rendered inside the alert, under the message: the parking retry submit, a
   * "Try again" or a call button. Actions belong here, never inline in the text.
   */
  action?: React.ReactNode
  /** Layout only. Alerts sit in the page or card rhythm, so this is rarely needed. */
  className?: string
}

/**
 * The one banner for these pages. Replaces every ad hoc green, amber, yellow,
 * blue and red panel in the guest code. Map existing tones as: green to
 * `success`, amber/yellow/blue to `notice`, red to `problem` (GUEST_BANNER_TONE).
 */
export function GuestAlert({
  id,
  tone,
  title,
  children,
  role,
  live,
  icon,
  action,
  className,
}: GuestAlertProps): React.JSX.Element {
  const resolvedRole = role ?? (tone === 'problem' ? 'alert' : 'status')

  return (
    <div
      id={id}
      role={resolvedRole}
      aria-live={live}
      className={clsx(
        'flex gap-2.5 rounded-guest-card border',
        action ? 'p-4' : 'px-guest-md py-3',
        GUEST_ALERT_TONE_CLASS[tone],
        className
      )}
    >
      <Icon name={icon ?? GUEST_TONE_ICON[tone]} size={16} className="mt-0.5 shrink-0" />

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {title ? <p className="text-guest-small font-bold leading-guest-snug">{title}</p> : null}
        <div className={clsx('text-guest-body', GUEST_ALERT_BODY_CLASS[tone])}>{children}</div>
        {action ? <div className="pt-1">{action}</div> : null}
      </div>
    </div>
  )
}
