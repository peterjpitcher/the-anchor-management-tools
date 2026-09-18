import { cn } from '@/lib/utils'

type StatusTone = 'success' | 'notice' | 'problem'

const TONE_CLASS: Record<StatusTone, string> = {
  success: 'border-success-border bg-success-soft text-success-fg',
  notice: 'border-warning-border bg-warning-soft text-warning-fg',
  problem: 'border-danger-border bg-danger-soft text-danger-fg',
}

type StatusNoteProps = {
  tone: StatusTone
  /** `status` for news the reader can take in their own time, `alert` for a failure. */
  role?: 'status' | 'alert'
  live?: 'polite' | 'assertive'
  className?: string
  children: React.ReactNode
}

/** A status message on the invoice payment page, in the neutral staff tokens. */
export function StatusNote({ tone, role = 'status', live, className, children }: StatusNoteProps): React.JSX.Element {
  return (
    <div
      role={role}
      aria-live={live}
      className={cn('rounded-default border px-4 py-3 text-sm leading-relaxed', TONE_CLASS[tone], className)}
    >
      {children}
    </div>
  )
}
