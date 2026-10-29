import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The payment message's delivery row names the customer and the event even when the caller only
 * knows the booking (the PayPal webhook, the guest capture route, the reconciliation cron), so an
 * undelivered message links to the booking instead of "Unknown customer". A failed read never
 * stops the message.
 */

const db = vi.hoisted(() => ({ result: { data: null as unknown, error: null as unknown }, reads: 0 }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => { db.reads += 1; return db.result } }) }),
    }),
  }),
}))
const ledger = vi.hoisted(() => ({
  createNotificationDelivery: vi.fn().mockResolvedValue('delivery-1'),
  recordNotificationAttempt: vi.fn(),
  updateNotificationDelivery: vi.fn(),
}))
vi.mock('@/lib/notifications/delivery-ledger', () => ledger)
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/email/event-ticket-emails', () => ({
  sendEventPaymentConfirmationEmail: vi.fn().mockResolvedValue({ success: false, skipped: true }),
  sendEventPaymentManualReviewEmail: vi.fn().mockResolvedValue({ success: false, skipped: true }),
}))
vi.mock('@/lib/events/event-payments', () => ({
  sendEventPaymentConfirmationSms: vi.fn().mockResolvedValue({ success: false, code: null, logFailure: false }),
  sendEventPaymentManualReviewSms: vi.fn().mockResolvedValue({ success: false, code: null, logFailure: false }),
}))

import { notifyEventPaymentOutcome } from '@/lib/events/event-payment-notify'
import { sendEventPaymentConfirmationEmail } from '@/lib/email/event-ticket-emails'

beforeEach(() => {
  vi.clearAllMocks()
  db.reads = 0
  db.result = { data: { customer_id: 'customer-1', event_id: 'event-1' }, error: null }
})

describe('notifyEventPaymentOutcome', () => {
  it('reads the customer and event from the booking when the caller knows only the booking', async () => {
    await notifyEventPaymentOutcome({} as never, { bookingId: 'booking-1', outcome: 'confirmed', amount: 30, currency: 'GBP' })

    expect(ledger.createNotificationDelivery).toHaveBeenCalledWith(expect.objectContaining({
      customerId: 'customer-1',
      metadata: expect.objectContaining({ event_booking_id: 'booking-1', event_id: 'event-1' }),
    }))
  })

  it('does not read the booking when the caller passed both', async () => {
    await notifyEventPaymentOutcome({} as never, { bookingId: 'booking-1', outcome: 'manual_review', customerId: 'customer-9', eventId: 'event-9' })

    expect(db.reads).toBe(0)
    expect(ledger.createNotificationDelivery).toHaveBeenCalledWith(expect.objectContaining({
      customerId: 'customer-9',
      metadata: expect.objectContaining({ event_id: 'event-9' }),
    }))
  })

  it('still sends and records the message when the read fails', async () => {
    db.result = { data: null, error: { message: 'statement timeout' } }

    await notifyEventPaymentOutcome({} as never, { bookingId: 'booking-1', outcome: 'confirmed' })

    expect(sendEventPaymentConfirmationEmail).toHaveBeenCalledTimes(1)
    expect(ledger.createNotificationDelivery).toHaveBeenCalledWith(expect.objectContaining({
      customerId: null,
      metadata: expect.objectContaining({ event_booking_id: 'booking-1', event_id: null }),
    }))
  })
})
