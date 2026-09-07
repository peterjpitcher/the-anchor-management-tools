import { format } from 'date-fns'
import type { CalendarEntry } from './types'

/**
 * Plain-text detail for a calendar entry, used as the native `title`.
 *
 * The rich tooltip is a popover and needs hover or focus. This is the fallback
 * that works on a long-press and is announced by assistive technology, so the
 * detail the calendar already holds (guest counts, balance amounts, vehicle
 * registrations) is never write-only.
 */
export function entryTooltipText(entry: CalendarEntry): string {
    const lines: string[] = []
    const when = entry.allDay
        ? format(entry.start, 'EEE d MMM yyyy')
        : `${format(entry.start, 'EEE d MMM yyyy')} at ${format(entry.start, 'HH:mm')}`

    const td = entry.tooltipData

    switch (td.kind) {
        case 'event':
            lines.push(`Event: ${td.name}`, when, `${td.bookedSeats} booked`)
            if (td.category) lines.push(`Category: ${td.category}`)
            break
        case 'private_booking':
            lines.push(`Private booking: ${td.customerName}`)
            lines.push(td.timeRange ? `${format(entry.start, 'EEE d MMM yyyy')}, ${td.timeRange}` : when)
            if (td.guestCount !== null) lines.push(`${td.guestCount} guests`)
            if (td.endsNextDay) lines.push('Ends next day')
            break
        case 'balance_due':
            lines.push(`Balance due: ${td.customerName}`, when)
            if (td.amount !== null) {
                lines.push(
                    new Intl.NumberFormat('en-GB', {
                        style: 'currency',
                        currency: 'GBP',
                        maximumFractionDigits: 0,
                    }).format(td.amount),
                )
            }
            break
        case 'birthday':
            lines.push(`Birthday: ${td.employeeName}`, when)
            if (td.turningAge !== null) lines.push(`Turning ${td.turningAge}`)
            if (td.jobTitle) lines.push(td.jobTitle)
            break
        case 'special_hours':
            lines.push(`Special hours: ${td.title}`, td.date)
            if (td.timeRange) lines.push(td.timeRange)
            if (td.isClosed) lines.push('Venue closed')
            else if (td.isKitchenClosed) lines.push('Kitchen closed')
            break
        case 'calendar_note':
            lines.push(`Note: ${td.title}`, td.dateRange)
            if (td.notes) lines.push(td.notes)
            lines.push(td.source === 'ai' ? 'AI generated' : 'Manual note')
            break
        case 'parking':
            lines.push(`Parking: ${td.customerName}`)
            if (td.reference) lines.push(`Ref ${td.reference}`)
            if (td.vehicleReg) lines.push(td.vehicleReg)
            lines.push(`${format(entry.start, 'EEE d MMM yyyy')}, ${td.timeRange}`)
            break
    }

    if (entry.statusLabel) lines.push(entry.statusLabel)

    return lines.filter(Boolean).join('\n')
}
