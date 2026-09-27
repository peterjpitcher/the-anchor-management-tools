import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface SubHeadingProps {
  /** h4 (the default) under a card title (h3); h3 when the card has no CardHeader. */
  as?: 'h3' | 'h4'
  children: ReactNode
  className?: string
}

/**
 * A heading inside a card body, such as "Contact Details" above a group of fields. It keeps
 * a real heading element so screen reader users can jump between the parts of a long card.
 */
export function SubHeading({ as: Tag = 'h4', children, className }: SubHeadingProps): React.JSX.Element {
  return <Tag className={cn('text-sm font-semibold text-text-strong', className)}>{children}</Tag>
}
