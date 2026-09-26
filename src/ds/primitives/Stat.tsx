import { cn } from '@/lib/utils'

type StatTone = 'default' | 'success' | 'warning' | 'danger'
type DeltaDirection = 'up' | 'down' | 'flat'

interface StatProps {
  label: string
  value: string | number
  delta?: number
  deltaDirection?: DeltaDirection
  /**
   * Which way is good news. 'up' (the default) shows a rise in the success colour and a fall
   * in the danger colour; 'down' swaps them, for figures such as costs or no-shows.
   */
  deltaGood?: 'up' | 'down'
  /**
   * Replaces the displayed delta text, which is otherwise the unsigned percentage. Use it for a
   * change that is not a percentage: an absolute change when the previous figure was zero ("+2")
   * or a change in percentage points ("+5 pts"). The direction, its colour, the arrow and the
   * screen-reader direction word still come from `delta` (or `deltaDirection`).
   */
  deltaLabel?: string
  /** Colours the value: a figure that is itself good or bad news. */
  tone?: StatTone
  icon?: React.ReactNode
  hint?: string
  className?: string
}

const TONE_CLASSES: Record<StatTone, string> = {
  default: 'text-text',
  success: 'text-success-fg',
  warning: 'text-warning-fg',
  danger: 'text-danger-fg',
}

function inferDirection(delta: number): DeltaDirection {
  if (delta > 0) return 'up'
  if (delta < 0) return 'down'
  return 'flat'
}

// The arrow and colour carry direction visually; this is what a screen reader hears
// before the unsigned percentage (or the deltaLabel). It names the direction, never whether it is good.
const DELTA_DIRECTION_LABEL: Record<DeltaDirection, string> = {
  up: 'up',
  down: 'down',
  flat: 'no change',
}

function deltaColour(direction: DeltaDirection, deltaGood: 'up' | 'down'): string {
  if (direction === 'flat') return 'text-text-muted'
  return direction === deltaGood ? 'text-success-fg' : 'text-danger-fg'
}

// The arrow takes its colour from the delta text around it.
const DeltaArrow = ({ direction }: { direction: DeltaDirection }) => {
  if (direction === 'flat') return <span className="inline-block w-3 text-center" aria-hidden="true">-</span>

  return (
    <svg
      className="inline-block w-3 h-3"
      viewBox="0 0 12 12"
      fill="currentColor"
      aria-hidden="true"
    >
      {direction === 'up' ? (
        <path d="M6 2L10 8H2L6 2Z" />
      ) : (
        <path d="M6 10L2 4H10L6 10Z" />
      )}
    </svg>
  )
}

export function Stat({ label, value, delta, deltaDirection, deltaGood = 'up', deltaLabel, tone = 'default', icon, hint, className }: StatProps): React.JSX.Element {
  const direction = deltaDirection ?? (delta !== undefined ? inferDirection(delta) : undefined)

  return (
    <div className={cn('flex flex-col gap-1 relative', className)}>
      {icon && (
        <span className="absolute top-0 right-0 text-text-subtle [&>svg]:w-5 [&>svg]:h-5" aria-hidden="true">
          {icon}
        </span>
      )}

      <span className="text-xs font-medium text-text-muted uppercase tracking-wider">
        {label}
      </span>

      <span className={cn('text-2xl font-bold tabular-nums', TONE_CLASSES[tone])}>
        {value}
      </span>

      {(delta !== undefined || deltaLabel !== undefined) && direction && (
        <span className={cn('inline-flex items-center gap-1 text-xs font-medium', deltaColour(direction, deltaGood))}>
          <span className="sr-only">{`${DELTA_DIRECTION_LABEL[direction]} `}</span>
          <DeltaArrow direction={direction} />
          {deltaLabel ?? `${Math.abs(delta ?? 0)}%`}
        </span>
      )}

      {hint && (
        <span className="text-xs text-text-soft mt-0.5">{hint}</span>
      )}
    </div>
  )
}
