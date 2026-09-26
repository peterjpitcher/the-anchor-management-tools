import { clsx } from 'clsx'
import { GUEST_LABEL_CLASS } from './styles'

type DetailGridItem = {
  label: React.ReactNode
  value: React.ReactNode
}

type DetailGridProps = {
  items: DetailGridItem[]
  /** `single` keeps one column at every width, for free text that needs the room. */
  columns?: 'auto' | 'single'
}

const COLUMNS_CLASS: Record<NonNullable<DetailGridProps['columns']>, string> = {
  auto: 'grid-cols-1 guest-narrow:grid-cols-2',
  single: 'grid-cols-1',
}

/**
 * Two-column detail grid, dropping to one column below 380px so the smallest
 * phones still fit a registration or a reference on one line.
 *
 * Used where the pages render a `<dl>`-style grid: parking and the booking portal.
 */
export function DetailGrid({ items, columns = 'auto' }: DetailGridProps): React.JSX.Element {
  return (
    <div className={clsx('grid gap-guest-md', COLUMNS_CLASS[columns])}>
      {items.map((item, index) => (
        <div key={index} className="flex min-w-0 flex-col gap-guest-3xs">
          <span className={GUEST_LABEL_CLASS}>{item.label}</span>
          <span className="font-anchor-body text-guest-body font-semibold leading-guest-snug text-guest-text">
            {item.value}
          </span>
        </div>
      ))}
    </div>
  )
}
