import { cn } from '@/lib/utils'

type SkeletonRounded = 'sm' | 'md' | 'lg' | 'full'

interface SkeletonProps {
  className?: string
  width?: string
  height?: string
  rounded?: SkeletonRounded
}

const roundedStyles: Record<SkeletonRounded, string> = {
  sm: 'rounded-sm',
  md: 'rounded-default',
  lg: 'rounded-lg',
  full: 'rounded-full',
}

export function Skeleton({ className, width, height, rounded = 'md' }: SkeletonProps) {
  return (
    <div
      className={cn(
        'bg-surface-2 animate-pulse',
        roundedStyles[rounded],
        className
      )}
      style={{ width, height }}
      aria-hidden="true"
    />
  )
}
