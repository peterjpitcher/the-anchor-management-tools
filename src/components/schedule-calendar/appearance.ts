import type { CalendarEntryKind } from './types'

export const CALENDAR_COLOUR_OPTIONS = [
    { label: 'Light blue', value: '#7DD3FC' },
    { label: 'Dark blue', value: '#1E3A8A' },
    { label: 'Yellow', value: '#FACC15' },
    { label: 'Orange', value: '#F97316' },
    { label: 'Purple', value: '#9333EA' },
    { label: 'Green', value: '#16A34A' },
    { label: 'Black', value: '#111827' },
    { label: 'White', value: '#FFFFFF' },
] as const

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
    return ['#1E3A8A', '#9333EA', '#111827'].includes(colour.toUpperCase())
}
