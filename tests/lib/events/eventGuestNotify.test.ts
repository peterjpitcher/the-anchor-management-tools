import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * BK-167, owner decision D14: event messages go by email first, with a text only when no email
 * goes. Exactly one channel for a guest with a usable email, a text for one without, nothing more
 * while the email log cannot be checked, and a record of every message that reached nobody.
 */

const ledger = vi.hoisted(() => ({
  createNotificationDelivery: vi.fn(),
  recordNotificationAttempt: vi.fn(),
  updateNotificationDelivery: vi.fn(),
}))
vi.mock('@/lib/notifications/delivery-ledger', () => ledger)
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { sendEventMessageEmailFirst } from '@/lib/events/event-guest-notify'
import { logger } from '@/lib/logger'

const base = { templateKey: 'event_payment_confirmed', bookingId: 'booking-1', eventId: 'event-1', customerId: 'customer-1' }

beforeEach(() => {
  vi.clearAllMocks()
  ledger.createNotificationDelivery.mockResolvedValue('delivery-1')
  ledger.updateNotificationDelivery.mockResolvedValue(true)
})

describe('sendEventMessageEmailFirst', () => {
  it('emails a guest with a usable address and sends no text', async () => {
    const email = vi.fn().mockResolvedValue({ success: true, messageId: 'email-1' })
    const text = vi.fn().mockResolvedValue({ success: true, code: null, logFailure: false })

    const outcome = await sendEventMessageEmailFirst({ ...base, email, text })

    expect(outcome).toMatchObject({ status: 'sent', channel: 'email', emailed: true, texted: false, fallbackUsed: false })
    expect(text).not.toHaveBeenCalled()
    expect(ledger.createNotificationDelivery).toHaveBeenCalledWith(expect.objectContaining({
      templateKey: 'event_payment_confirmed',
      policy: 'email_first',
      delayedFallbackAllowed: false,
      metadata: expect.objectContaining({ event_booking_id: 'booking-1', event_id: 'event-1' }),
    }))
    expect(ledger.recordNotificationAttempt).toHaveBeenCalledTimes(1)
    expect(ledger.updateNotificationDelivery).toHaveBeenCalledWith(expect.objectContaining({ finalStatus: 'sent', selectedChannel: 'email' }))
  })

  it('texts a guest with no usable email', async () => {
    const email = vi.fn().mockResolvedValue({ success: false, skipped: true })
    const text = vi.fn().mockResolvedValue({ success: true, code: null, logFailure: false, sid: 'SM1' })

    const outcome = await sendEventMessageEmailFirst({ ...base, email, text })

    expect(outcome).toMatchObject({ status: 'sent', channel: 'sms', emailed: false, texted: true, fallbackUsed: false })
    expect(ledger.recordNotificationAttempt).toHaveBeenCalledWith(expect.objectContaining({ channel: 'sms', success: true, messageId: 'SM1' }))
  })

  it('texts when the email fails, and says a fallback was used', async () => {
    const email = vi.fn().mockResolvedValue({ success: false, error: 'provider down' })
    const text = vi.fn().mockResolvedValue({ success: true, code: null, logFailure: false })

    const outcome = await sendEventMessageEmailFirst({ ...base, email, text })

    expect(outcome).toMatchObject({ status: 'sent', channel: 'sms', fallbackUsed: true })
    expect(ledger.recordNotificationAttempt).toHaveBeenCalledTimes(2)
  })

  it('treats an email the provider accepted but our log missed as sent', async () => {
    const email = vi.fn().mockResolvedValue({ success: false, messageId: 'email-1', error: 'log write failed' })
    const text = vi.fn()

    const outcome = await sendEventMessageEmailFirst({ ...base, email, text })

    expect(outcome.status).toBe('sent')
    expect(text).not.toHaveBeenCalled()
  })

  it('sends nothing more when the email already went', async () => {
    const email = vi.fn().mockResolvedValue({ success: true, skipped: true })
    const text = vi.fn()

    const outcome = await sendEventMessageEmailFirst({ ...base, email, text })

    expect(outcome.status).toBe('already_sent')
    expect(text).not.toHaveBeenCalled()
    expect(ledger.createNotificationDelivery).not.toHaveBeenCalled()
  })

  it('sends no text when the email duplicate check could not run, and records it for staff', async () => {
    const email = vi.fn().mockResolvedValue({ success: false, skipped: true, deferred: true })
    const text = vi.fn()

    const outcome = await sendEventMessageEmailFirst({ ...base, email, text })

    expect(outcome.status).toBe('deferred')
    expect(text).not.toHaveBeenCalled()
    expect(ledger.createNotificationDelivery).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ undelivered_reason: 'duplicate_check_unavailable' }),
    }))
    expect(ledger.updateNotificationDelivery).toHaveBeenCalledWith(expect.objectContaining({ finalStatus: 'failed' }))
    expect(logger.error).toHaveBeenCalled()
  })

  it('leaves a deferred message to a caller that comes back to it', async () => {
    const email = vi.fn().mockResolvedValue({ success: false, skipped: true, deferred: true })

    const outcome = await sendEventMessageEmailFirst({ ...base, email, text: vi.fn(), retriesLater: true })

    expect(outcome.status).toBe('deferred')
    expect(ledger.createNotificationDelivery).not.toHaveBeenCalled()
  })

  it('records a guest nobody could reach', async () => {
    const email = vi.fn().mockResolvedValue({ success: false, skipped: true })
    // No textable number: the sender tried nothing.
    const text = vi.fn().mockResolvedValue({ success: false, code: null, logFailure: false })

    const outcome = await sendEventMessageEmailFirst({ ...base, email, text })

    expect(outcome.status).toBe('no_channel')
    expect(ledger.createNotificationDelivery).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ undelivered_reason: 'no_channel' }),
    }))
    expect(ledger.updateNotificationDelivery).toHaveBeenCalledWith(expect.objectContaining({ finalStatus: 'failed' }))
  })

  it('records a message that failed on every channel', async () => {
    const email = vi.fn().mockResolvedValue({ success: false, error: 'provider down' })
    const text = vi.fn().mockResolvedValue({ success: false, code: 'quiet_hours_blocked', logFailure: false })

    const outcome = await sendEventMessageEmailFirst({ ...base, email, text })

    expect(outcome.status).toBe('failed')
    expect(logger.error).toHaveBeenCalled()
  })

  it('sends both on a same-day cancellation', async () => {
    const email = vi.fn().mockResolvedValue({ success: true, messageId: 'email-1' })
    const text = vi.fn().mockResolvedValue({ success: true, code: null, logFailure: false })

    const outcome = await sendEventMessageEmailFirst({ ...base, templateKey: 'event_booking_cancelled_admin', email, text, both: true })

    expect(outcome).toMatchObject({ status: 'sent', emailed: true, texted: true })
    expect(ledger.createNotificationDelivery).toHaveBeenCalledWith(expect.objectContaining({ policy: 'both' }))
  })

  it('texts first for a guest mid-conversation by text, and emails only if the text did not go', async () => {
    const email = vi.fn().mockResolvedValue({ success: true, messageId: 'email-1' })
    const text = vi.fn().mockResolvedValue({ success: true, code: null, logFailure: false })

    const sentByText = await sendEventMessageEmailFirst({ ...base, email, text, textFirst: true })
    expect(sentByText).toMatchObject({ channel: 'sms', texted: true })
    expect(email).not.toHaveBeenCalled()

    text.mockResolvedValueOnce({ success: false, code: 'opted_out', logFailure: false })
    const sentByEmail = await sendEventMessageEmailFirst({ ...base, email, text, textFirst: true })
    expect(sentByEmail).toMatchObject({ channel: 'email', emailed: true })
  })

  it('never throws when a sender throws', async () => {
    const email = vi.fn().mockRejectedValue(new Error('boom'))
    const text = vi.fn().mockRejectedValue(new Error('boom'))

    const outcome = await sendEventMessageEmailFirst({ ...base, email, text })

    expect(outcome.status).toBe('failed')
  })
})
