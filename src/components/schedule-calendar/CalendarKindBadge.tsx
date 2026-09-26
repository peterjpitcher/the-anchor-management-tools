import { Icon, type IconName } from '@/ds'
import { cn } from '@/lib/utils'
import { kindShortLabel } from './appearance'
import type { CalendarEntryKind } from './types'

const KIND_ICONS: Record<CalendarEntryKind, IconName> = {
    event: 'calendar',
    private_booking: 'users',
    balance_due: 'cash',
    birthday: 'cake',
    special_hours: 'clock',
    calendar_note: 'edit',
    parking: 'mapPin',
    marketing_email: 'mail',
}

interface CalendarKindBadgeProps {
    kind: CalendarEntryKind
    lightText: boolean
    className?: string
}

export function CalendarKindBadge({ kind, lightText, className }: CalendarKindBadgeProps) {
    return (
        <span
            className={cn(
                'inline-flex min-w-0 items-center gap-0.5 rounded-sm px-1 py-px text-2xs font-bold uppercase leading-none tracking-wide',
                lightText ? 'bg-on-dark-active text-on-dark' : 'bg-text-strong/10 text-text-strong',
                className,
            )}
        >
            <Icon name={KIND_ICONS[kind]} size={10} />
            <span className="truncate">{kindShortLabel(kind)}</span>
        </span>
    )
}
