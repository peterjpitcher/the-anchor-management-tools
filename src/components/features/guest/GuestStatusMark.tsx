import { cn } from '@/lib/utils'
import { Icon, type IconName } from '@/ds/icons'
import { GUEST_MARK_ICON, GUEST_MARK_TONE_CLASS, type GuestMarkTone } from './status-ui'

type GuestStatusMarkSize = 'sm' | 'md' | 'lg'

type GuestStatusMarkProps = {
  tone: GuestMarkTone
  /** Defaults to the tone's own glyph; `brand` has none, so pass one. */
  icon?: IconName
  /**
   * `md` heads a result card (paid, confirmed, received). `lg` is the hero of a
   * centred thank-you page. `sm` sits beside an assurance row.
   */
  size?: GuestStatusMarkSize
}

const SIZE: Record<GuestStatusMarkSize, { box: string; icon: number }> = {
  sm: { box: 'size-7', icon: 15 },
  md: { box: 'size-8', icon: 16 },
  lg: { box: 'size-13', icon: 28 },
}

/**
 * The round tinted icon disc. Decorative: the text beside it carries the
 * meaning, so it is hidden from assistive tech.
 */
export function GuestStatusMark({ tone, icon, size = 'md' }: GuestStatusMarkProps): React.JSX.Element {
  const glyph = icon ?? (tone === 'brand' ? 'check' : GUEST_MARK_ICON[tone])

  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full',
        SIZE[size].box,
        GUEST_MARK_TONE_CLASS[tone]
      )}
    >
      <Icon name={glyph} size={SIZE[size].icon} />
    </span>
  )
}
