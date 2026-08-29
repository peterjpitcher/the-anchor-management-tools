import type { ComponentType, SVGProps } from 'react'
import {
    BanknotesIcon,
    CakeIcon,
    CalendarDaysIcon,
    ClockIcon,
    MapPinIcon,
    PencilSquareIcon,
    UsersIcon,
} from '@heroicons/react/20/solid'
import { cn } from '@/lib/utils'
import { kindShortLabel } from './appearance'
import type { CalendarEntryKind } from './types'

const KIND_ICONS: Record<CalendarEntryKind, ComponentType<SVGProps<SVGSVGElement>>> = {
    event: CalendarDaysIcon,
    private_booking: UsersIcon,
    balance_due: BanknotesIcon,
    birthday: CakeIcon,
    special_hours: ClockIcon,
    calendar_note: PencilSquareIcon,
    parking: MapPinIcon,
}

interface CalendarKindBadgeProps {
    kind: CalendarEntryKind
    lightText: boolean
    className?: string
}

export function CalendarKindBadge({ kind, lightText, className }: CalendarKindBadgeProps) {
    const KindIcon = KIND_ICONS[kind]

    return (
        <span
            className={cn(
                'inline-flex min-w-0 items-center gap-0.5 rounded-sm px-1 py-px text-[9px] font-bold uppercase leading-none tracking-wide',
                lightText ? 'bg-white/20 text-white' : 'bg-black/10 text-gray-950',
                className,
            )}
        >
            <KindIcon className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{kindShortLabel(kind)}</span>
        </span>
    )
}
