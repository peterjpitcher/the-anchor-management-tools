import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ loggerError: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { error: mocks.loggerError, warn: vi.fn(), info: vi.fn() } }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => {
    throw new Error('Missing service role key')
  },
}))

import { loadSeatAllergyBookingIds } from '@/lib/table-bookings/seat-allergies'
import { bookingNoteMarker } from '@/lib/table-bookings/allergy-words'

function db(result: { data: unknown; error: unknown }) {
  const calls: Array<[string, unknown]> = []
  const chain = {
    select: () => chain,
    in: (column: string, value: unknown) => {
      calls.push([column, value])
      return chain
    },
    eq: (column: string, value: unknown) => {
      calls.push([column, value])
      return Promise.resolve(result)
    },
  }
  return { client: { from: vi.fn(() => chain) }, calls }
}

beforeEach(() => vi.clearAllMocks())

describe('loadSeatAllergyBookingIds', () => {
  it('returns the bookings with a guest whose seat records an allergy', async () => {
    const { client, calls } = db({ data: [{ table_booking_id: 'b2' }, { table_booking_id: 'b2' }], error: null })

    const flagged = await loadSeatAllergyBookingIds(['b1', 'b2', 'b1'], client as never)

    expect([...flagged]).toEqual(['b2'])
    expect(client.from).toHaveBeenCalledWith('booking_preorder_covers')
    expect(calls).toEqual([
      ['table_booking_id', ['b1', 'b2']],
      ['has_allergies', true],
    ])
  })

  it('reads nothing for no bookings', async () => {
    const { client } = db({ data: [], error: null })
    expect((await loadSeatAllergyBookingIds([], client as never)).size).toBe(0)
    expect(client.from).not.toHaveBeenCalled()
  })

  it('logs and answers none known when the read fails, so the screen still loads', async () => {
    const { client } = db({ data: null, error: { message: 'timeout' } })

    expect((await loadSeatAllergyBookingIds(['b1'], client as never)).size).toBe(0)
    expect(mocks.loggerError).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(mocks.loggerError.mock.calls[0][1])).not.toContain('b1')
  })

  it('logs and answers none known when the admin client cannot be made', async () => {
    expect((await loadSeatAllergyBookingIds(['b1'])).size).toBe(0)
    expect(mocks.loggerError).toHaveBeenCalledTimes(1)
  })
})

// Spec section 3.5: a guest's allergy raises the booking's flag on the FOH timeline and BOH list.
describe('bookingNoteMarker with a guest allergy', () => {
  it('marks the booking Allergy when only a guest seat records one', () => {
    expect(bookingNoteMarker({ allergies: [], notes: null, guestAllergies: true })).toBe('allergy')
    expect(bookingNoteMarker({ allergies: [], notes: 'Birthday', guestAllergies: true })).toBe('allergy')
  })

  it('is unchanged when no guest records one', () => {
    expect(bookingNoteMarker({ allergies: [], notes: 'Birthday', guestAllergies: false })).toBe('note')
    expect(bookingNoteMarker({ allergies: [], notes: null })).toBeNull()
  })
})
