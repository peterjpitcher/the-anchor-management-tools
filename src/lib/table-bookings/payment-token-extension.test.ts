import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * R11 (spec tasks/christmas-food-link/spec.md): when a deposit hold moves later, the payment links
 * already sent must last as long as the hold, or the guest is told "this link has expired" while
 * the table is still held for them. Only unused payment links for that booking are lengthened, and
 * never shortened.
 */

vi.mock('@/lib/messaging/flags', () => ({ isMessagingFlagOn: vi.fn() }))
vi.mock('@/lib/email/emailService', () => ({ sendEmail: vi.fn() }))
vi.mock('@/lib/email/logging', () => ({ isEmailSuppressed: vi.fn() }))
vi.mock('@/lib/twilio', () => ({
  sendSMS: vi.fn(),
  sendWhatsApp: vi.fn(),
  isCustomerSmsSendAllowed: vi.fn(),
  isCustomerWhatsAppSendAllowed: vi.fn(),
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/services/audit', () => ({ AuditService: { logAuditEvent: vi.fn() } }))
vi.mock('@/lib/cron/alerting', () => ({ reportCronFailure: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

import { logger } from '@/lib/logger'
import { alignTablePaymentHoldToScheduledSend } from './bookings'
import { extendTablePaymentTokensToHold } from './payment-link'
import { argsOf, called, createRecordingSupabase } from '../../../tests/mocks/recordingSupabase'

const HOLD = '2026-12-04T19:00:00.000Z'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('extendTablePaymentTokensToHold', () => {
  it('lengthens only the unused payment links for that booking, and never shortens one', async () => {
    const db = createRecordingSupabase({ tables: { guest_tokens: () => ({ data: null, error: null }) } })

    await expect(
      extendTablePaymentTokensToHold(db.client as never, { tableBookingId: 'tb-1', holdExpiresAtIso: HOLD })
    ).resolves.toBe(true)

    const update = db.queries.find((query) => query.table === 'guest_tokens')!
    expect(argsOf(update, 'update')).toEqual([[{ expires_at: HOLD }]])
    expect(argsOf(update, 'eq')).toEqual([['table_booking_id', 'tb-1'], ['action_type', 'payment']])
    expect(argsOf(update, 'is')).toEqual([['consumed_at', null]])
    expect(argsOf(update, 'lt')).toEqual([['expires_at', HOLD]])
  })

  it('logs an error and carries on when the update fails, so the hold change still stands', async () => {
    const db = createRecordingSupabase({
      tables: { guest_tokens: () => ({ data: null, error: { message: 'timeout' } }) },
    })

    await expect(
      extendTablePaymentTokensToHold(db.client as never, { tableBookingId: 'tb-1', holdExpiresAtIso: HOLD })
    ).resolves.toBe(false)
    expect(logger.error).toHaveBeenCalledWith(
      'A deposit hold moved later but its payment links could not follow',
      expect.objectContaining({ metadata: { tableBookingId: 'tb-1' } })
    )
  })
})

describe('alignTablePaymentHoldToScheduledSend', () => {
  it('moves the payment links with the hold when the booking hold moved', async () => {
    const db = createRecordingSupabase({
      tables: {
        table_bookings: () => ({ data: { id: 'tb-1' }, error: null }),
        booking_holds: () => ({ data: [{ id: 'hold-1' }], error: null }),
        guest_tokens: () => ({ data: null, error: null }),
      },
    })

    const expiresAt = await alignTablePaymentHoldToScheduledSend(db.client as never, {
      tableBookingId: 'tb-1',
      scheduledSendIso: '2026-12-03T19:00:00.000Z',
      bookingStartIso: '2026-12-12T19:00:00.000Z',
    })

    expect(expiresAt).toBe(HOLD)
    const tokens = db.queries.find((query) => query.table === 'guest_tokens')!
    expect(argsOf(tokens, 'update')).toEqual([[{ expires_at: HOLD }]])
  })

  it('leaves the links alone when the booking is no longer waiting for payment', async () => {
    const db = createRecordingSupabase({
      tables: {
        table_bookings: () => ({ data: null, error: null }),
        booking_holds: () => ({ data: [], error: null }),
        guest_tokens: () => ({ data: null, error: null }),
      },
    })

    await expect(
      alignTablePaymentHoldToScheduledSend(db.client as never, {
        tableBookingId: 'tb-1',
        scheduledSendIso: '2026-12-03T19:00:00.000Z',
      })
    ).rejects.toThrow(/table_bookings_update_no_rows/)
    expect(db.queries.some((query) => query.table === 'guest_tokens' && called(query, 'update'))).toBe(false)
  })
})
