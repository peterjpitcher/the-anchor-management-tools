import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The guest manage link changing party size (BK-053).
 *
 * Three faults on this path: a Christmas booking's box went to a database that refuses a size that
 * does not match its course list (and skipped the 4-guest minimum when there was none), a table
 * move made for a bigger party stayed behind when the size then failed to save, and the deposit
 * transition's "a person must check this seasonal deposit" message was thrown away.
 */

const mocks = vi.hoisted(() => ({
  applyPartySizeDepositTransition: vi.fn(),
  recordGuestPartySizeChange: vi.fn(),
}))

vi.mock('@/lib/guest/tokens', () => ({
  hashGuestToken: (token: string) => `hash-${token}`,
  createGuestToken: vi.fn(),
}))
vi.mock('@/lib/env', () => ({ getAppUrl: () => 'https://management.example' }))
vi.mock('@/lib/analytics/events', () => ({ recordAnalyticsEvent: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }))
vi.mock('@/lib/table-bookings/staff-deposit-transitions', () => ({
  applyPartySizeDepositTransition: mocks.applyPartySizeDepositTransition,
}))
vi.mock('@/lib/table-bookings/party-size-alerts', () => ({
  recordGuestPartySizeChange: mocks.recordGuestPartySizeChange,
}))

import { updateTableBookingByRawToken } from '@/lib/table-bookings/manage-booking'

type Booking = {
  id: string
  customer_id: string
  booking_reference: string
  status: string
  party_size: number
  committed_party_size: number
  special_requirements: string | null
  booking_type: string
  booking_purpose: string
  start_datetime: string
  end_datetime: string
  is_outside_seating: boolean
  booking_date: string
  booking_period_id: string | null
}

type Write = { table: string; op: 'update' | 'insert' | 'delete'; payload?: Record<string, unknown> }

/**
 * Just enough of the query builder for this path. Every chain resolves through `answer`, which
 * sees the table, the operation and the payload; writes are recorded in order.
 */
function createStub(options: {
  booking: Booking
  tableCapacity: number
  freeTable?: { id: string; capacity: number }
  bookingUpdateError?: { message: string } | null
}) {
  const writes: Write[] = []
  const answer = (table: string, op: string, payload?: Record<string, unknown>) => {
    if (table === 'guest_tokens') {
      return {
        data: {
          customer_id: options.booking.customer_id,
          table_booking_id: options.booking.id,
          expires_at: '2099-01-01T00:00:00.000Z',
          consumed_at: null,
        },
        error: null,
      }
    }
    if (table === 'table_bookings' && op === 'select') return { data: options.booking, error: null }
    if (table === 'table_bookings' && op === 'update') {
      return options.bookingUpdateError
        ? { data: null, error: options.bookingUpdateError }
        : { data: { id: options.booking.id, ...payload }, error: null }
    }
    if (table === 'booking_table_assignments' && op === 'select') {
      return {
        data: [{ table_id: 'table-old', table: { id: 'table-old', name: 'Table 1', capacity: options.tableCapacity } }],
        error: null,
      }
    }
    if (table === 'booking_table_assignments') return { data: { table_booking_id: options.booking.id }, error: null }
    if (table === 'tables') {
      return { data: options.freeTable ? [{ ...options.freeTable, is_bookable: true }] : [], error: null }
    }
    return { data: null, error: null }
  }

  function chain(table: string, op: string, payload?: Record<string, unknown>) {
    const result = () => {
      const value = answer(table, op, payload)
      // The overlap check for a free table finds nothing booked on it.
      if (table === 'booking_table_assignments' && op === 'select' && filters.some((filter) => filter === 'neq')) {
        return { data: [], error: null }
      }
      return value
    }
    const filters: string[] = []
    const query: Record<string, unknown> = {}
    for (const method of ['eq', 'neq', 'in', 'lt', 'gt', 'gte', 'order', 'select']) {
      query[method] = () => {
        filters.push(method)
        return query
      }
    }
    query.maybeSingle = async () => {
      const value = result()
      return { data: Array.isArray(value.data) ? value.data[0] ?? null : value.data, error: value.error }
    }
    query.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(result()).then(resolve, reject)
    return query
  }

  const client = {
    from: (table: string) => ({
      select: () => chain(table, 'select'),
      update: (payload: Record<string, unknown>) => {
        writes.push({ table, op: 'update', payload })
        return chain(table, 'update', payload)
      },
      insert: (payload: Record<string, unknown>) => {
        writes.push({ table, op: 'insert', payload })
        return chain(table, 'insert', payload)
      },
      delete: () => {
        writes.push({ table, op: 'delete' })
        return chain(table, 'delete')
      },
    }),
  }
  return { client: client as never, writes }
}

const BASE: Booking = {
  id: 'booking-1',
  customer_id: 'customer-1',
  booking_reference: 'TB-0001',
  status: 'confirmed',
  party_size: 4,
  committed_party_size: 4,
  special_requirements: null,
  booking_type: 'regular',
  booking_purpose: 'food',
  start_datetime: '2099-12-05T18:00:00.000Z',
  end_datetime: '2099-12-05T20:00:00.000Z',
  is_outside_seating: false,
  booking_date: '2099-12-05',
  booking_period_id: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.applyPartySizeDepositTransition.mockResolvedValue({ state: 'unchanged' })
})

describe('guest party-size change on the manage link', () => {
  it('refuses the plain box on a Christmas booking before any table move or write', async () => {
    const { client, writes } = createStub({
      booking: { ...BASE, booking_type: 'christmas' },
      tableCapacity: 4,
      freeTable: { id: 'table-big', capacity: 8 },
    })

    const result = await updateTableBookingByRawToken(client, { rawToken: 'raw', action: 'update', newPartySize: 6 })

    expect(result).toEqual({ state: 'blocked', reason: 'christmas_party_form' })
    expect(writes).toEqual([])
  })

  it('still saves a Christmas booking\'s notes when the size is unchanged', async () => {
    const { client, writes } = createStub({ booking: { ...BASE, booking_type: 'christmas' }, tableCapacity: 4 })

    const result = await updateTableBookingByRawToken(client, {
      rawToken: 'raw', action: 'update', newPartySize: 4, notes: 'One vegetarian',
    })

    expect(result.state).toBe('updated')
    expect(writes).toEqual([
      expect.objectContaining({ table: 'table_bookings', op: 'update', payload: expect.objectContaining({ special_requirements: 'One vegetarian', party_size: 4 }) }),
    ])
  })

  it('puts the booking back on its table when the size fails to save after a move', async () => {
    const { client, writes } = createStub({
      booking: BASE,
      tableCapacity: 4,
      freeTable: { id: 'table-big', capacity: 8 },
      bookingUpdateError: { message: 'update failed' },
    })

    await expect(
      updateTableBookingByRawToken(client, { rawToken: 'raw', action: 'update', newPartySize: 6 }),
    ).rejects.toMatchObject({ message: 'update failed' })

    const assignmentWrites = writes.filter((write) => write.table === 'booking_table_assignments')
    expect(assignmentWrites).toEqual([
      expect.objectContaining({ op: 'update', payload: expect.objectContaining({ table_id: 'table-big' }) }),
      expect.objectContaining({ op: 'update', payload: { table_id: 'table-old' } }),
    ])
  })

  it('tells the manager when a seasonal deposit is left for a person to check', async () => {
    mocks.applyPartySizeDepositTransition.mockResolvedValue({
      state: 'manual_review',
      depositAmount: 40,
      message: 'The party size changed on a Sunday lunch booking, so the deposit has been left as it is.',
    })
    const { client } = createStub({ booking: { ...BASE, booking_period_id: 'period-1' }, tableCapacity: 6 })

    const result = await updateTableBookingByRawToken(client, { rawToken: 'raw', action: 'update', newPartySize: 5 })

    expect(result.state).toBe('updated')
    expect(mocks.recordGuestPartySizeChange).toHaveBeenCalledWith(
      expect.objectContaining({
        tableBookingId: 'booking-1',
        previousPartySize: 4,
        newPartySize: 5,
        depositReview: 'The party size changed on a Sunday lunch booking, so the deposit has been left as it is.',
      }),
    )
  })

  it('audits an ordinary change with no deposit review', async () => {
    const { client } = createStub({ booking: BASE, tableCapacity: 6 })

    await updateTableBookingByRawToken(client, { rawToken: 'raw', action: 'update', newPartySize: 5 })

    expect(mocks.recordGuestPartySizeChange).toHaveBeenCalledWith(
      expect.objectContaining({ previousPartySize: 4, newPartySize: 5, depositReview: null }),
    )
  })
})
