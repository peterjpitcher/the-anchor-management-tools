import { SHIFT_TEMPLATE_COLOURS } from '@/lib/rota/shift-template-colours'
import type { CalendarEntryKind } from './types'

/**
 * The colours staff can pick for a calendar note: the same list as shift templates, so notes
 * and shifts look alike and there is one palette to change (design decision A11, 18 Sep 2026).
 */
export const CALENDAR_COLOUR_OPTIONS = SHIFT_TEMPLATE_COLOURS

/**
 * The colour for a calendar note with none stored: the first option, light blue. Defined next to
 * the palette so server actions share it; every screen and loader that fills a missing note
 * colour uses this one value.
 */
export { DEFAULT_CALENDAR_NOTE_COLOUR } from '@/lib/rota/shift-template-colours'

/**
 * White and black from the same palette. Items are drawn in their own (data) colour, so their
 * ink is white on the darkest colours and black on the rest, and a cancelled item is white
 * with a black border.
 */
export const CALENDAR_WHITE = '#FFFFFF'
export const CALENDAR_BLACK = '#111827'

export const CALENDAR_KIND_APPEARANCE: Record<
    CalendarEntryKind,
    { color: string; label: string; shortLabel: string }
> = {
    event: { color: '#1E3A8A', label: 'Events', shortLabel: 'Event' },
    private_booking: { color: '#9333EA', label: 'Private bookings', shortLabel: 'Private' },
    balance_due: { color: '#F97316', label: 'Balance due', shortLabel: 'Due' },
    birthday: { color: '#FACC15', label: 'Birthdays', shortLabel: 'Birthday' },
    special_hours: { color: '#111827', label: 'Special hours', shortLabel: 'Hours' },
    calendar_note: { color: '#7DD3FC', label: 'Calendar notes', shortLabel: 'Note' },
    parking: { color: '#16A34A', label: 'Parking', shortLabel: 'Parking' },
    marketing_email: { color: '#BE185D', label: 'Marketing emails', shortLabel: 'Email' },
}

export function kindColor(kind: CalendarEntryKind): string {
    return CALENDAR_KIND_APPEARANCE[kind].color
}

export function kindLabel(kind: CalendarEntryKind): string {
    return CALENDAR_KIND_APPEARANCE[kind].label
}

export function kindShortLabel(kind: CalendarEntryKind): string {
    return CALENDAR_KIND_APPEARANCE[kind].shortLabel
}

export function calendarColourNeedsLightText(colour: string): boolean {
    return ['#1E3A8A', '#9333EA', '#111827', '#BE185D'].includes(colour.toUpperCase())
}
