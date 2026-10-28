import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A booking text held by quiet hours is read against its booking before it goes (BK-084). The
 * website's "seats held, pay here" text written at 21:30 used to arrive at 09:00 after the guest
 * had paid or the 15-minute hold had gone.
 */

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/api/idempotency', () => ({
  claimIdempotencyKey: vi.fn().mockResolvedValue({ state: 'claimed' }),
  releaseIdempotencyClaim: vi.fn(),
}))
vi.mock('@/lib/sms/bulk', () => ({ sendBulkSms: vi.fn() }))
const twilio = vi.hoisted(() => ({ sendSMS: vi.fn() }))
vi.mock('@/lib/twilio', () => ({ sendSMS: twilio.sendSMS }))
vi.mock('@/lib/sms/promo-context', () => ({ backfillSmsPromoContextMessageId: vi.fn() }))

import { createAdminClient } from '@/lib/supabase/admin'
import { findStaleEventBookingSmsReason } from '@/lib/sms/held-booking-text'
import { UnifiedJobQueue } from '@/lib/unified-job-queue'

function bookingClient(answer: { data: unknown; error: { message: string } | null }) {
  const maybeSingle = vi.fn().mockResolvedValue(answer)
  const eq = vi.fn().mockReturnValue({ maybeSingle })
  const select = vi.fn().mockReturnValue({ eq })
  const from = vi.fn().mockReturnValue({ select })
  vi.mocked(createAdminClient).mockReturnValue({ from } as never)
  return { from, eq }
}

const NOW = new Date('2026-07-04T08:00:00Z')
const heldText = {
  event_booking_id: 'booking-1',
  template_key: 'event_booking_pending_payment',
  expected_booking_status: 'pending_payment',
  hold_expires_at: '2026-07-03T20:45:00Z',
}

describe('findStaleEventBookingSmsReason', () => {
  beforeEach(() => vi.clearAllMocks())

  it('leaves a text without booking fields alone, and reads nothing', async () => {
    const { from } = bookingClient({ data: null, error: null })
    expect(await findStaleEventBookingSmsReason({ template_key: 'job_queue_sms' }, NOW)).toBeNull()
    expect(await findStaleEventBookingSmsReason(undefined, NOW)).toBeNull()
    expect(from).not.toHaveBeenCalled()
  })

  it('drops a pay-here text once the guest has paid', async () => {
    bookingClient({ data: { id: 'booking-1', status: 'confirmed', hold_expires_at: null }, error: null })
    expect(await findStaleEventBookingSmsReason(heldText, NOW)).toBe('booking_now_confirmed')
  })

  it('drops a pay-here text once the hold has lapsed', async () => {
    bookingClient({ data: { id: 'booking-1', status: 'expired', hold_expires_at: heldText.hold_expires_at }, error: null })
    expect(await findStaleEventBookingSmsReason(heldText, NOW)).toBe('booking_now_expired')
  })

  it('drops it when the booking still waits but its hold time has passed', async () => {
    bookingClient({ data: { id: 'booking-1', status: 'pending_payment', hold_expires_at: heldText.hold_expires_at }, error: null })
    expect(await findStaleEventBookingSmsReason(heldText, NOW)).toBe('hold_expired')
  })

  it('sends it when the booking still waits and the hold runs on (a 24-hour staff link)', async () => {
    bookingClient({ data: { id: 'booking-1', status: 'pending_payment', hold_expires_at: '2026-07-04T20:00:00Z' }, error: null })
    expect(await findStaleEventBookingSmsReason(heldText, NOW)).toBeNull()
  })

  it('drops a confirmation once the booking was cancelled', async () => {
    bookingClient({ data: { id: 'booking-1', status: 'cancelled', hold_expires_at: null }, error: null })
    expect(await findStaleEventBookingSmsReason({ ...heldText, expected_booking_status: 'confirmed' }, NOW)).toBe('booking_now_cancelled')
  })

  it('throws on a failed read, so the job retries instead of guessing', async () => {
    bookingClient({ data: null, error: { message: 'timeout' } })
    await expect(findStaleEventBookingSmsReason(heldText, NOW)).rejects.toThrow('timeout')
  })
})

describe('send_sms job with a held booking text', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    twilio.sendSMS.mockResolvedValue({ success: true, sid: 'SM1', status: 'sent', messageId: 'm1' })
  })

  it('does not send a text whose booking has moved on', async () => {
    bookingClient({ data: { id: 'booking-1', status: 'confirmed', hold_expires_at: null }, error: null })
    const queue = UnifiedJobQueue.getInstance()

    const result = await (queue as any).executeJob('send_sms', {
      to: '+447700900123',
      message: 'The Anchor: Hi Pat, 2 seats held. Pay here: https://l.the-anchor.pub/x.',
      customerId: 'customer-1',
      metadata: heldText,
    })

    expect(result).toEqual({ skipped: true, reason: 'booking_now_confirmed' })
    expect(twilio.sendSMS).not.toHaveBeenCalled()
  })

  it('sends a held text whose booking still matches', async () => {
    bookingClient({ data: { id: 'booking-1', status: 'confirmed', hold_expires_at: null }, error: null })
    const queue = UnifiedJobQueue.getInstance()

    await (queue as any).executeJob('send_sms', {
      to: '+447700900123',
      message: 'The Anchor: Hi Pat, you are in.',
      customerId: 'customer-1',
      metadata: { ...heldText, expected_booking_status: 'confirmed' },
    })

    expect(twilio.sendSMS).toHaveBeenCalledOnce()
  })
})
