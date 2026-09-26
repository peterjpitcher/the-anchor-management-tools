import { Children, isValidElement, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Card, CardBody } from './Card'

export interface StatGridProps {
  /** `Stat` elements. Each one is framed in its own card. */
  children: ReactNode
  /** Columns from the large breakpoint up. Phones show one column, small screens two. */
  columns?: 2 | 3 | 4 | 5 | 6
  className?: string
}

const columnClasses: Record<NonNullable<StatGridProps['columns']>, string> = {
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-2 lg:grid-cols-3',
  4: 'sm:grid-cols-2 lg:grid-cols-4',
  5: 'sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5',
  6: 'sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6',
}

/**
 * The one way to show a row of figures: each `Stat` in a card, in a 16px grid.
 *
 * ```tsx
 * <StatGrid columns={3}>
 *   <Stat label="Bookings" value={12} />
 *   <Stat label="Covers" value={48} />
 *   <Stat label="Revenue" value="£1,240" />
 * </StatGrid>
 * ```
 */
export function StatGrid({ children, columns = 4, className }: StatGridProps): React.JSX.Element {
  return (
    <div className={cn('grid grid-cols-1 gap-4', columnClasses[columns], className)}>
      {Children.toArray(children).map((child, index) => (
        <Card key={isValidElement(child) && child.key != null ? child.key : index}>
          <CardBody>{child}</CardBody>
        </Card>
      ))}
    </div>
  )
}
