import { Spinner } from '@/ds/primitives/Spinner'
import { cn } from '@/lib/utils'

export interface PageLoadingProps {
  /** Accessible label announced to screen readers */
  label?: string
  className?: string
}

/**
 * Minimal centred loading indicator.
 *
 * Used by route-level `loading.tsx` files (full-height by default) and
 * in-component loading regions (override sizing via `className`,
 * e.g. `className="min-h-0 py-12"`).
 */
export function PageLoading({ label = 'Loading…', className }: PageLoadingProps): React.JSX.Element {
  return (
    <div
      role="status"
      className={cn('flex min-h-[50vh] w-full items-center justify-center', className)}
    >
      <Spinner size="lg" />
      <span className="sr-only">{label}</span>
    </div>
  )
}
