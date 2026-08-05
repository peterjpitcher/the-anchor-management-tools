import { cn } from '@/lib/utils'

type DetailGridItem = {
  label: React.ReactNode
  value: React.ReactNode
}

type DetailGridProps = {
  items: DetailGridItem[]
  className?: string
}

/**
 * Two-column detail grid, dropping to one column below 380px so the smallest
 * phones still fit a registration or a reference on one line.
 *
 * Used where the pages currently render a `<dl>` grid: parking and the booking
 * portal.
 */
export function DetailGrid({ items, className }: DetailGridProps): React.JSX.Element {
  return (
    <div className={cn('grid grid-cols-1 gap-[15px] min-[380px]:grid-cols-2', className)}>
      {items.map((item, index) => (
        <div key={index} className="flex min-w-0 flex-col gap-[3px]">
          <span className="font-anchor-body text-[11px] font-semibold uppercase leading-none tracking-[0.1em] text-guest-text-muted">
            {item.label}
          </span>
          <span className="font-anchor-body text-[14px] font-semibold leading-[1.4] text-guest-text">
            {item.value}
          </span>
        </div>
      ))}
    </div>
  )
}
