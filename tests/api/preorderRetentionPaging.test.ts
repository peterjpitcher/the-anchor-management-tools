import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/cron-auth', () => ({ authorizeCronRequest: vi.fn(() => ({ authorized: true })) }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
vi.mock('@/lib/cron/alerting', () => ({ reportCronFailure: vi.fn() }))
vi.mock('@/services/gdpr', () => ({
  GdprService: { runCommunicationRetentionCleanup: vi.fn(async () => ({ messages: 0 })) },
}))
vi.mock('@/lib/events/guest-details-retention', () => ({
  resolveGuestDetailsRetentionMode: vi.fn(() => 'dry_run'),
  runEventGuestDetailsRetention: vi.fn(async () => ({ bookingsFailed: 0 })),
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { GET } from '@/app/api/cron/communications-retention/route'

const SERVER_ROW_CAP = 1000

type Row = { id: string; table_booking_id: string }

/**
 * A fake that behaves like PostgREST on the one point that matters here: a read returns at most
 * 1,000 rows and says nothing about the rest.
 */
function fakeDb(covers: Row[], reminders: Row[], expiredBookingIds: Set<string>) {
  const tables: Record<string, Row[]> = { booking_preorder_covers: covers, booking_preorder_reminders: reminders }
  const deleted: Record<string, string[]> = { booking_preorder_covers: [], booking_preorder_reminders: [] }

  const client = {
    from(table: string) {
      if (table === 'table_bookings') {
        let ids: string[] = []
        const query = {
          select: () => query,
          in: (_column: string, values: string[]) => {
            ids = values
            return query
          },
          lt: () => Promise.resolve({ data: ids.filter((id) => expiredBookingIds.has(id)).map((id) => ({ id })), error: null }),
        }
        return query
      }

      const rows = tables[table]
      let from = 0
      let to = Number.POSITIVE_INFINITY
      let deleting = false
      const query = {
        select: () => query,
        order: () => query,
        range: (start: number, end: number) => {
          from = start
          to = end
          return query
        },
        delete: () => {
          deleting = true
          return query
        },
        in: (_column: string, values: string[]) => {
          const matching = rows.filter((row) => values.includes(row.table_booking_id))
          deleted[table].push(...matching.map((row) => row.id))
          return Promise.resolve({ count: matching.length, error: null })
        },
        then(resolve: (value: unknown) => unknown) {
          if (deleting) return resolve({ count: 0, error: null })
          const end = Math.min(to + 1, from + SERVER_ROW_CAP)
          return resolve({ data: rows.slice(from, end), error: null })
        },
      }
      return query
    },
  }

  return { client, deleted }
}

describe('pre-order retention purge (BK-151)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('purges expired seats beyond the first 1,000 rows', async () => {
    // 1,500 seats over 375 bookings of 4; every booking is past the two-year cutoff.
    const covers: Row[] = Array.from({ length: 1500 }, (_, index) => ({
      id: `cover-${String(index).padStart(5, '0')}`,
      table_booking_id: `tb-${Math.floor(index / 4)}`,
    }))
    const reminders: Row[] = Array.from({ length: 1200 }, (_, index) => ({
      id: `rem-${String(index).padStart(5, '0')}`,
      table_booking_id: `tb-${index % 375}`,
    }))
    const expired = new Set(covers.map((row) => row.table_booking_id))
    const db = fakeDb(covers, reminders, expired)
    vi.mocked(createAdminClient).mockReturnValue(db.client as never)

    const response = await GET(new Request('http://localhost/api/cron/communications-retention'))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.preorders).toEqual(expect.objectContaining({ bookingsPurged: 375, covers: 1500, reminders: 1200 }))
    // The last seat, well past the first page, is gone too.
    expect(db.deleted.booking_preorder_covers).toContain('cover-01499')
  })
})
