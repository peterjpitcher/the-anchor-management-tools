import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))

import { logger } from '@/lib/logger'
import { discardUnusedWalkInCustomer } from './walk-in-customer'

const WALK_IN = {
  customerId: '22222222-2222-4222-8222-222222222222',
  syntheticPhone: '+447000123456',
}
const CONTEXT = { route: 'POST /api/foh/bookings', userId: 'user-1' }

type Result = { data: unknown; error: unknown }
type Call = { table: string; method: string; args: unknown[] }

// A PostgREST stand-in. Every from(table) records its chain and resolves to the result given for
// that table, so each test can say exactly what the two booking tables and the delete return.
function createSupabaseMock(results: Partial<Record<string, Result>> = {}) {
  const calls: Call[] = []
  const from = vi.fn((table: string) => {
    const result = results[table] ?? { data: [], error: null }
    const builder: Record<string, unknown> = {}
    for (const method of ['select', 'delete', 'eq']) {
      builder[method] = vi.fn((...args: unknown[]) => {
        calls.push({ table, method, args })
        return builder
      })
    }
    builder.then = (resolve: (value: Result) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject)
    return builder
  })
  return { client: { from } as never, calls }
}

const deleteCalls = (calls: Call[]) => calls.filter((call) => call.table === 'customers')

describe('discardUnusedWalkInCustomer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('deletes the record when nothing refers to it, pinned to the dummy number it was given', async () => {
    const db = createSupabaseMock()

    await expect(discardUnusedWalkInCustomer(db.client, WALK_IN, CONTEXT)).resolves.toBe('deleted')

    expect(deleteCalls(db.calls)).toEqual([
      { table: 'customers', method: 'delete', args: [] },
      { table: 'customers', method: 'eq', args: ['id', WALK_IN.customerId] },
      { table: 'customers', method: 'eq', args: ['mobile_e164', WALK_IN.syntheticPhone] },
    ])
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('keeps a record that a table booking refers to', async () => {
    const db = createSupabaseMock({ table_bookings: { data: [{ id: 'tb-1' }], error: null } })

    await expect(discardUnusedWalkInCustomer(db.client, WALK_IN, CONTEXT)).resolves.toBe('kept')

    expect(deleteCalls(db.calls)).toEqual([])
  })

  it('keeps a record that an event booking refers to, because deleting it would cascade', async () => {
    // bookings.customer_id is ON DELETE CASCADE: removing the customer would silently erase
    // the event booking, even a cancelled one.
    const db = createSupabaseMock({ bookings: { data: [{ id: 'booking-1' }], error: null } })

    await expect(discardUnusedWalkInCustomer(db.client, WALK_IN, CONTEXT)).resolves.toBe('kept')

    expect(deleteCalls(db.calls)).toEqual([])
  })

  it('keeps the record, and says so, when it cannot tell whether a booking refers to it', async () => {
    const db = createSupabaseMock({
      table_bookings: {
        data: null,
        error: { code: '57014', message: 'canceling statement due to statement timeout', details: null, hint: null },
      },
    })

    await expect(discardUnusedWalkInCustomer(db.client, WALK_IN, CONTEXT)).resolves.toBe('failed')

    expect(deleteCalls(db.calls)).toEqual([])
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringMatching(/could not check/i),
      expect.objectContaining({
        metadata: expect.objectContaining({ customerId: WALK_IN.customerId, table: 'table_bookings', code: '57014' }),
      }),
    )
  })

  it('logs, rather than throws, when the delete itself fails', async () => {
    const db = createSupabaseMock({
      customers: {
        data: null,
        error: { code: '23503', message: 'violates foreign key constraint', details: 'Key is still referenced', hint: null },
      },
    })

    await expect(discardUnusedWalkInCustomer(db.client, WALK_IN, CONTEXT)).resolves.toBe('failed')

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringMatching(/failed to remove/i),
      expect.objectContaining({
        metadata: expect.objectContaining({
          customerId: WALK_IN.customerId,
          code: '23503',
          details: 'Key is still referenced',
        }),
      }),
    )
  })

  it('never throws, even when the client itself does', async () => {
    const client = {
      from: vi.fn(() => {
        throw new Error('fetch failed')
      }),
    } as never

    await expect(discardUnusedWalkInCustomer(client, WALK_IN, CONTEXT)).resolves.toBe('failed')
    expect(logger.error).toHaveBeenCalled()
  })
})
