import { Children, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface FormFooterProps {
  /** The buttons: secondary first (Cancel), primary last (Save). */
  children: ReactNode
  /** Optional text or a total shown on the left on desktop, above the buttons on phones. */
  start?: ReactNode
  className?: string
}

/**
 * The one Save/Cancel row for every form. Desktop: buttons right-aligned, primary on the right.
 * Phones: buttons full width and stacked with the primary on top, where the thumb is.
 */
export function FormFooter({ children, start, className }: FormFooterProps): React.JSX.Element {
  const buttons = Children.toArray(children)

  return (
    <div
      className={cn(
        'flex flex-col gap-3 sm:flex-row sm:items-center',
        start ? 'sm:justify-between' : 'sm:justify-end',
        className,
      )}
    >
      {start ? <div className="min-w-0 text-sm text-text-muted">{start}</div> : null}
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center [&>*]:w-full sm:[&>*]:w-auto">
        {buttons}
      </div>
    </div>
  )
}
