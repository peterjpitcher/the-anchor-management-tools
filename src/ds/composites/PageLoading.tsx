import { Spinner } from '@/ds/primitives/Spinner'
import { cn } from '@/lib/utils'

export interface PageLoadingProps {
  /** Accessible label announced to screen readers */
  label?: string
  /**
   * Loading inside a page or a card, under a header that stays put. Without it the indicator
   * fills half the viewport, which is what a route `loading.tsx` wants.
   */
  inline?: boolean
  className?: string
}

/**
 * The one loading indicator. Route `loading.tsx` files render `<PageLoading />`; a page or a
 * block that is still fetching renders `<PageLoading inline />` (PageLayout's `loading` prop
 * does this for you).
 */
export function PageLoading({ label = 'Loading…', inline = false, className }: PageLoadingProps): React.JSX.Element {
  return (
    <div
      role="status"
      className={cn(
        'flex w-full items-center justify-center',
        inline ? 'py-12' : 'min-h-[50vh]',
        className,
      )}
    >
      <Spinner size="lg" />
      <span className="sr-only">{label}</span>
    </div>
  )
}
