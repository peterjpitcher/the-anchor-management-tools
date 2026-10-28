import { describe, expect, it, vi } from 'vitest'
import {
  CONFIRMATION_CALL_OPERATION,
  listAwaitingConfirmation,
  markConfirmationCallMade,
} from '@/lib/table-bookings/awaiting-confirmation'

function builder(result: { data: unknown; error: unknown }, record?: (method: string, args: unknown[]) => void) {
  const b: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'in', 'gte', 'lte', 'order']) {
    b[method] = (...args: unknown[]) => {
      record?.(method, args)
      return b
    }
  }
  b.then = (resolve: (v: unknown) => unknown) => resolve(result)
  return b
}

describe('listAwaitingConfirmation (BK-094)', () => {
  it("lists today's and tomorrow's silent guests with their number and whether they were rung", async () => {
    const viewCalls: Array<[string, unknown[]]> = []
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'table_bookings_awaiting_confirmation') {
          return builder(
            {
              data: [
                { id: 'b1', booking_reference: 'TB-1', booking_date: '2026-10-28', booking_time: '19:00:00', party_size: 4, customer_id: 'c1', reminder_sent_at: '2026-10-27T10:00:00Z' },
                { id: 'b2', booking_reference: 'TB-2', booking_date: '2026-10-28', booking_time: '20:00:00', party_size: 2, customer_id: null, reminder_sent_at: null },
              ],
              error: null,
            },
            (method, args) => viewCalls.push([method, args])
          )
        }
        if (table === 'customers') {
          return builder({ data: [{ id: 'c1', first_name: 'Ada', last_name: 'Lovelace', mobile_e164: '+447700900123', mobile_number: '07700 900123' }], error: null })
        }
        return builder({ data: [{ resource_id: 'b1', created_at: '2026-10-28T09:30:00Z' }], error: null })
      }),
    }

    const items = await listAwaitingConfirmation(supabase as never, { today: '2026-10-27' })

    expect(viewCalls).toContainEqual(['gte', ['booking_date', '2026-10-27']])
    expect(viewCalls).toContainEqual(['lte', ['booking_date', '2026-10-28']])
    expect(items).toEqual([
      expect.objectContaining({ bookingId: 'b1', guestName: 'Ada Lovelace', phone: '07700 900123', calledAt: '2026-10-28T09:30:00Z' }),
      expect.objectContaining({ bookingId: 'b2', guestName: null, phone: null, calledAt: null }),
    ])
  })

  it('throws when the list cannot be read, so the screen can say so', async () => {
    const supabase = { from: () => builder({ data: null, error: { message: 'timeout' } }) }
    await expect(listAwaitingConfirmation(supabase as never, { today: '2026-10-27' })).rejects.toThrow('timeout')
  })
})

describe('markConfirmationCallMade', () => {
  it('records who rang, ids only', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null })
    await markConfirmationCallMade({ from: () => ({ insert }) } as never, { bookingId: 'b1', userId: 'u1' })
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 'u1',
      operation_type: CONFIRMATION_CALL_OPERATION,
      resource_type: 'table_booking',
      resource_id: 'b1',
    }))
  })

  it('throws when the call could not be saved', async () => {
    const insert = vi.fn().mockResolvedValue({ error: { message: 'denied' } })
    await expect(markConfirmationCallMade({ from: () => ({ insert }) } as never, { bookingId: 'b1', userId: 'u1' })).rejects.toThrow('denied')
  })
})
