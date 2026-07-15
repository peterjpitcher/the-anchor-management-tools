import { cn } from '@/lib/utils'

export interface DescriptionListItem {
  key: string
  label: React.ReactNode
  value: React.ReactNode
  span?: 1 | 2 | 3
}

export interface DescriptionListProps {
  items: DescriptionListItem[]
  columns?: 1 | 2 | 3
  className?: string
}

const columnClasses = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 sm:grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
}

const spanClasses = {
  1: '',
  2: 'sm:col-span-2',
  3: 'sm:col-span-2 lg:col-span-3',
}

/** A responsive, semantic replacement for repeated DetailItem helpers. */
export function DescriptionList({
  items,
  columns = 2,
  className,
}: DescriptionListProps) {
  return (
    <dl className={cn('grid gap-x-6 gap-y-4', columnClasses[columns], className)}>
      {items.map((item) => (
        <div key={item.key} className={cn('min-w-0', spanClasses[item.span ?? 1])}>
          <dt className="text-xs font-medium uppercase tracking-wide text-text-muted">
            {item.label}
          </dt>
          <dd className="mt-1 break-words text-sm text-text">{item.value || '—'}</dd>
        </div>
      ))}
    </dl>
  )
}
