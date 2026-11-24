// A start or end reminder sent for the OLD dates must not block one for the new dates once a
// date change has cleared the flag (spec section 8.2).

import { describe, expect, it } from 'vitest'
import { hasParkingReminderBeenSent } from '@/lib/parking/reminder-history'

type Filters = Array<[string, unknown, unknown]>

function fakeClient(opts: { lastReset: string | null; sentAt: string[]; resetError?: unknown }) {
  return {
    from: () => {
      const filters: Filters = []
      const chain: Record<string, unknown> = {}
      const add = (op: string) => (a: unknown, b: unknown) => {
        filters.push([op, a, b])
        return chain
      }
      Object.assign(chain, {
        select: () => chain,
        eq: add('eq'),
        contains: add('contains'),
        gt: add('gt'),
        order: () => chain,
        limit: () => chain,
        maybeSingle: async () => ({
          data: opts.lastReset ? { created_at: opts.lastReset } : null,
          error: opts.resetError ?? null,
        }),
        then: (resolve: (value: unknown) => void) => {
          const after = filters.find(([op, col]) => op === 'gt' && col === 'created_at')?.[2] as string | undefined
          const rows = opts.sentAt.filter((at) => !after || at > after).map((at) => ({ id: at }))
          resolve({ data: rows, error: null })
        },
      })
      return chain
    },
  } as never
}

const input = { bookingId: 'booking-1', eventType: 'session_start' as const, templateKey: 'parking_start' }

describe('hasParkingReminderBeenSent after a date change', () => {
  it('counts a reminder sent with no date change since', async () => {
    expect(await hasParkingReminderBeenSent(fakeClient({ lastReset: null, sentAt: ['2026-11-01T09:00:00Z'] }), input)).toBe(true)
  })

  it('ignores a reminder sent before the change that moved the start', async () => {
    const client = fakeClient({ lastReset: '2026-11-10T09:00:00Z', sentAt: ['2026-11-01T09:00:00Z'] })
    expect(await hasParkingReminderBeenSent(client, input)).toBe(false)
  })

  it('still counts a reminder sent after that change', async () => {
    const client = fakeClient({ lastReset: '2026-11-10T09:00:00Z', sentAt: ['2026-11-12T09:00:00Z'] })
    expect(await hasParkingReminderBeenSent(client, input)).toBe(true)
  })

  it('fails safe (no send) when the change history cannot be read', async () => {
    const client = fakeClient({ lastReset: null, sentAt: [], resetError: { message: 'boom' } })
    expect(await hasParkingReminderBeenSent(client, input)).toBe(true)
  })
})
