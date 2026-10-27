import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  GUEST_DETAILS_RETENTION_DAYS,
  resolveGuestDetailsRetentionMode,
  runEventGuestDetailsRetention,
  stripGuestDetails,
} from '@/lib/events/guest-details-retention'

/*
 * BK-017 and owner decision D6: each ticket's guest answers and phone numbers are deleted 90
 * days after the event, names are kept, and the job ships switched off (a dry run) until the
 * owner has seen what it would clear.
 */

const QUESTION = '55555555-5555-4555-8555-555555555555'
const guest = (name: string, value: string, extra: Record<string, unknown> = {}) => ({
  id: `id-${name}`,
  name,
  ticket_type_id: null,
  answers: [{ question_id: QUESTION, label: 'Any allergies?', type: 'text', required: true, value }],
  ...extra,
})

type Update = { id: string; attendees: unknown }

function fakeClient(input: { events: Array<{ id: string; date: string }>; bookings: Array<{ id: string; event_id: string; attendees: unknown }> }) {
  const updates: Update[] = []
  const eventDateFilters: string[] = []
  return {
    updates,
    eventDateFilters,
    from(table: string) {
      let lte: string | null = null
      let eventIds: string[] = []
      let pendingUpdate: Record<string, unknown> | null = null
      const builder = {
        select: () => builder,
        lte: (_column: string, value: string) => { lte = value; eventDateFilters.push(value); return builder },
        in: (_column: string, values: string[]) => { eventIds = values; return builder },
        eq: (column: string, value: unknown) => {
          if (pendingUpdate && column === 'id') {
            updates.push({ id: String(value), attendees: pendingUpdate.attendees })
            return Promise.resolve({ error: null })
          }
          return builder
        },
        order: () => builder,
        update: (values: Record<string, unknown>) => { pendingUpdate = values; return builder },
        range: (from: number, to: number) => {
          const rows = table === 'events'
            ? input.events.filter((event) => lte === null || event.date <= lte)
            : input.bookings.filter((booking) => eventIds.includes(booking.event_id))
          return Promise.resolve({ data: rows.slice(from, to + 1), error: null })
        },
      }
      return builder
    },
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('stripGuestDetails', () => {
  it('blanks every answer and removes phones, and keeps names, ids and the questions asked', () => {
    const result = stripGuestDetails([
      guest('Jo Guest', 'Peanuts', { phone: '+447700900123' }),
      guest('Sam Friend', ''),
    ], '2027-02-18T03:30:00.000Z')

    expect(result.answersCleared).toBe(1)
    expect(result.phonesCleared).toBe(1)
    expect(result.attendees[0]).toEqual({
      id: 'id-Jo Guest',
      name: 'Jo Guest',
      ticket_type_id: null,
      answers: [{ question_id: QUESTION, label: 'Any allergies?', type: 'text', required: true, value: '' }],
      details_removed_at: '2027-02-18T03:30:00.000Z',
    })
    // Nothing to clear on the second guest, so it is left exactly as it was.
    expect(result.attendees[1]).toEqual(guest('Sam Friend', ''))
  })

  it('finds nothing to do on a booking with no guest details', () => {
    expect(stripGuestDetails([], 'x')).toEqual({ attendees: [], answersCleared: 0, phonesCleared: 0 })
    expect(stripGuestDetails(null, 'x')).toEqual({ attendees: [], answersCleared: 0, phonesCleared: 0 })
  })
})

describe('resolveGuestDetailsRetentionMode', () => {
  it('is a dry run unless the owner sets it to delete', () => {
    expect(resolveGuestDetailsRetentionMode(undefined)).toBe('dry_run')
    expect(resolveGuestDetailsRetentionMode('')).toBe('dry_run')
    expect(resolveGuestDetailsRetentionMode('true')).toBe('dry_run')
    expect(resolveGuestDetailsRetentionMode('yes')).toBe('dry_run')
    expect(resolveGuestDetailsRetentionMode('dry_run')).toBe('dry_run')
    expect(resolveGuestDetailsRetentionMode('delete')).toBe('delete')
    expect(resolveGuestDetailsRetentionMode(' DELETE ')).toBe('delete')
    expect(resolveGuestDetailsRetentionMode('off')).toBe('off')
  })
})

describe('runEventGuestDetailsRetention', () => {
  const data = () => ({
    events: [
      { id: 'tasting', date: '2026-11-20' },
      { id: 'quiz', date: '2026-11-21' },
    ],
    bookings: [
      { id: 'b-tasting', event_id: 'tasting', attendees: [guest('Jo Guest', 'Peanuts'), guest('Sam Friend', 'None')] },
      { id: 'b-tasting-empty', event_id: 'tasting', attendees: [] },
      { id: 'b-quiz', event_id: 'quiz', attendees: [guest('Ali Other', 'Shellfish')] },
    ],
  })

  it('keeps 90 days by the London calendar: the 20 November night is due on 18 February, not before', async () => {
    expect(GUEST_DETAILS_RETENTION_DAYS).toBe(90)
    vi.useFakeTimers()
    // 23:30 UTC on 17 February is still 17 February in London.
    vi.setSystemTime(new Date('2027-02-17T23:30:00Z'))
    const early = fakeClient(data())
    const before = await runEventGuestDetailsRetention(early as never, { mode: 'delete' })
    expect(before.cutoffDate).toBe('2026-11-19')
    expect(before.bookingsDue).toBe(0)
    expect(early.updates).toEqual([])

    vi.setSystemTime(new Date('2027-02-18T00:30:00Z'))
    const due = fakeClient(data())
    const after = await runEventGuestDetailsRetention(due as never, { mode: 'delete' })
    expect(after.cutoffDate).toBe('2026-11-20')
    expect(after.bookingsDue).toBe(1)
    expect(due.updates.map((update) => update.id)).toEqual(['b-tasting'])
  })

  it('in a dry run reports what it would clear and changes nothing', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2027-06-01T12:00:00Z'))
    const client = fakeClient(data())
    const result = await runEventGuestDetailsRetention(client as never, { mode: 'dry_run' })

    expect(result).toMatchObject({ mode: 'dry_run', bookingsDue: 2, answersDue: 3, phonesDue: 0, bookingsCleared: 0 })
    expect(client.updates).toEqual([])
    // Counts only: nothing in the report names a guest or repeats an answer.
    expect(JSON.stringify(result)).not.toMatch(/Jo Guest|Peanuts|Shellfish/)
  })

  it('in delete mode saves each due booking with the answers blanked and the names kept', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2027-06-01T12:00:00Z'))
    const client = fakeClient(data())
    const result = await runEventGuestDetailsRetention(client as never, { mode: 'delete' })

    expect(result).toMatchObject({ mode: 'delete', bookingsDue: 2, bookingsCleared: 2, bookingsFailed: 0 })
    const saved = client.updates.find((update) => update.id === 'b-tasting')!.attendees as Array<{ name: string; answers: Array<{ value: string }> }>
    expect(saved.map((entry) => entry.name)).toEqual(['Jo Guest', 'Sam Friend'])
    expect(saved.flatMap((entry) => entry.answers.map((answer) => answer.value))).toEqual(['', ''])
  })

  it('does not run at all when switched off', async () => {
    const client = fakeClient(data())
    const result = await runEventGuestDetailsRetention(client as never, { mode: 'off' })
    expect(result.eventsChecked).toBe(0)
    expect(client.eventDateFilters).toEqual([])
  })
})
