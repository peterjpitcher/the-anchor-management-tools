export interface GuestListBookingInput {
  seats: number | null
  attendeeNames: string[] | null
  customerFirstName: string | null
  customerLastName: string | null
  isReminderOnly?: boolean | null
}

export interface GuestLine {
  /** Empty string means "no known name" → a blank line for staff to hand-write. */
  name: string
  isBooker: boolean
}

export interface GuestGroup {
  bookerName: string
  lines: GuestLine[]
}

function toGroup(b: GuestListBookingInput): GuestGroup {
  const bookerName = `${(b.customerFirstName ?? '').trim()} ${(b.customerLastName ?? '').trim()}`.trim()
  const names = (b.attendeeNames ?? []).map(n => (n ?? '').trim()).filter(n => n.length > 0)
  const seats = Math.max(b.seats ?? 1, 1)
  const lineCount = Math.max(seats, names.length, 1)
  const display = bookerName || names[0] || ''
  const lines: GuestLine[] = [{ name: display, isBooker: true }]
  for (let i = 1; i < lineCount; i++) {
    lines.push({ name: names[i] ?? '', isBooker: false })
  }
  return { bookerName: display, lines }
}

/** Confirmed bookings only should be passed in; reminder-only / zero-seat rows are dropped here defensively. */
export function buildGuestListModel(bookings: GuestListBookingInput[]): GuestGroup[] {
  return bookings
    .filter(b => !b.isReminderOnly && (b.seats ?? 0) >= 1)
    .map(b => ({
      group: toGroup(b),
      sortKey: `${(b.customerLastName ?? '').trim()} ${(b.customerFirstName ?? '').trim()}`.toLowerCase(),
    }))
    .sort((a, z) => a.sortKey.localeCompare(z.sortKey, 'en-GB', { sensitivity: 'base' }))
    .map(x => x.group)
}
