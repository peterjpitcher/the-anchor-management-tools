import { cn } from '@/lib/utils'

type AvatarSize = 'sm' | 'md' | 'lg' | 'xl'

interface AvatarProps {
  name: string
  size?: AvatarSize
  className?: string
}

const AVATAR_COLORS = [
  'bg-[#ef4444]',
  'bg-[#f97316]',
  'bg-[#eab308]',
  'bg-[#22c55e]',
  'bg-[#3b82f6]',
  'bg-[#8b5cf6]',
] as const

const sizeStyles: Record<AvatarSize, string> = {
  sm: 'w-6 h-6 text-[10px]',
  md: 'w-8 h-8 text-xs',
  lg: 'w-10 h-10 text-sm',
  xl: 'w-14 h-14 text-lg',
}

function pickColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  const first = parts[0]?.[0] ?? ''
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? '' : ''
  return (first + last).toUpperCase()
}

export function Avatar({ name, size = 'md', className }: AvatarProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center rounded-full font-semibold text-white shrink-0',
        sizeStyles[size],
        pickColor(name),
        className
      )}
      aria-label={name}
      role="img"
    >
      {getInitials(name)}
    </span>
  )
}

interface AvatarStackProps {
  names: string[]
  max?: number
  size?: AvatarSize
  className?: string
}

export function AvatarStack({ names, max = 4, size = 'md', className }: AvatarStackProps) {
  const visible = names.slice(0, max)
  const overflow = names.length - max

  return (
    <div className={cn('flex items-center', className)}>
      {visible.map((name, i) => (
        <Avatar
          key={`${name}-${i}`}
          name={name}
          size={size}
          className={cn(
            'ring-2 ring-surface',
            i > 0 && '-ml-2'
          )}
        />
      ))}
      {overflow > 0 && (
        <span
          className={cn(
            'inline-flex items-center justify-center rounded-full font-semibold bg-surface-2 text-text-muted border border-border shrink-0 -ml-2',
            sizeStyles[size]
          )}
        >
          +{overflow}
        </span>
      )}
    </div>
  )
}
