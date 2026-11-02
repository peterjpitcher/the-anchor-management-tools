import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { recordTableBookingMarketingConversion } from '@/lib/email/marketing/table-booking-conversion'
import { logger } from '@/lib/logger'

const RECIPIENT_ID = '22222222-2222-4222-8222-222222222222'
const CAMPAIGN_ID = '11111111-1111-4111-8111-111111111111'

function fakeDb(options: { recipient?: unknown; insertError?: { code?: string; message: string } | null } = {}) {
  const inserts: unknown[] = []
  const db = {
    from: (table: string) => {
      if (table === 'marketing_campaign_recipients') {
        const chain = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: async () => ({
            data: options.recipient === undefined ? { id: RECIPIENT_ID, campaign_id: CAMPAIGN_ID, customer_id: 'cust-1' } : options.recipient,
            error: null,
          }),
        }
        return chain
      }
      return {
        insert: async (row: unknown) => {
          inserts.push(row)
          return { error: options.insertError ?? null }
        },
      }
    },
  }
  return { db, inserts }
}

const BASE = {
  tableBookingId: 'tb-1',
  customerId: 'cust-1',
  partySize: 4,
  attribution: {
    utm_source: 'marketing_email',
    utm_medium: 'email',
    utm_campaign: 'return-visit-touch-1',
    utm_content: RECIPIENT_ID,
    booking_source: 'return_visit_email',
  },
}

describe('recordTableBookingMarketingConversion', () => {
  it('records the booking against the email that drove it', async () => {
    const { db, inserts } = fakeDb()
    expect(await recordTableBookingMarketingConversion(db as never, BASE)).toBe('recorded')
    expect(inserts[0]).toMatchObject({
      conversion_type: 'table_booking',
      campaign_id: CAMPAIGN_ID,
      recipient_id: RECIPIENT_ID,
      party_size: 4,
      utm_content: RECIPIENT_ID,
      metadata: { table_booking_id: 'tb-1', same_customer: true, booking_source: 'return_visit_email' },
    })
  })

  it('treats a second write for the same booking as already done', async () => {
    const { db } = fakeDb({ insertError: { code: '23505', message: 'duplicate key' } })
    expect(await recordTableBookingMarketingConversion(db as never, BASE)).toBe('duplicate')
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('ignores bookings that did not come from a marketing email', async () => {
    const { db, inserts } = fakeDb()
    expect(
      await recordTableBookingMarketingConversion(db as never, { ...BASE, attribution: { utm_source: 'google' } }),
    ).toBe('not_marketing')
    expect(await recordTableBookingMarketingConversion(db as never, { ...BASE, attribution: null })).toBe('not_marketing')
    expect(
      await recordTableBookingMarketingConversion(db as never, {
        ...BASE,
        attribution: { ...BASE.attribution, utm_content: 'not-a-uuid' },
      }),
    ).toBe('not_marketing')
    expect(inserts).toHaveLength(0)
  })

  it('writes nothing for an id that matches no email', async () => {
    const { db, inserts } = fakeDb({ recipient: null })
    expect(await recordTableBookingMarketingConversion(db as never, BASE)).toBe('unknown_recipient')
    expect(inserts).toHaveLength(0)
  })

  it('logs and carries on when the write fails, so the booking still stands', async () => {
    const { db } = fakeDb({ insertError: { code: '42501', message: 'permission denied' } })
    expect(await recordTableBookingMarketingConversion(db as never, BASE)).toBe('failed')
    expect(logger.error).toHaveBeenCalled()
  })
})
