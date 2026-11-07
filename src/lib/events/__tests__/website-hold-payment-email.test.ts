import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Event checkout spec, Piece 4.1: a website event hold is emailed its payment link at once, email
 * only, once per booking, and a failure never escapes. The real email-first messenger runs here,
 * with the email sender, the delivery ledger and the flag read stubbed.
 */

const log = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: log }))

const flags = vi.hoisted(() => ({ isMessagingFlagOn: vi.fn(async () => false) }))
vi.mock('@/lib/messaging/flags', () => flags)

const emails = vi.hoisted(() => ({ sendEventPaymentLinkEmail: vi.fn() }))
vi.mock('@/lib/email/event-ticket-emails', () => emails)

const ledger = vi.hoisted(() => ({
  createNotificationDelivery: vi.fn(async () => 'delivery-1'),
  recordNotificationAttempt: vi.fn(async () => undefined),
  updateNotificationDelivery: vi.fn(async () => undefined),
}))
vi.mock('@/lib/notifications/delivery-ledger', () => ledger)

const twilio = vi.hoisted(() => ({ sendSMS: vi.fn() }))
vi.mock('@/lib/twilio', () => twilio)

import {
  sendWebsiteHoldPaymentLinkEmail,
  websiteHoldPaymentEmailClaimKey,
} from '../website-hold-payment-email'

const BOOKING = 'booking-1'

/**
 * A stand-in database: `idempotency_keys` refuses a second insert of the same key with 23505, as
 * the real primary key does, and `customers` answers with the given email.
 */
function fakeDb(options: { customerEmail?: string | null; claimError?: { code?: string; message: string } } = {}) {
  const claimed = new Set<string>()
  const inserts: Array<Record<string, unknown>> = []
  const client = {
    from(table: string) {
      if (table === 'idempotency_keys') {
        return {
          insert: async (row: Record<string, unknown>) => {
            inserts.push(row)
            if (options.claimError) return { error: options.claimError }
            const key = String(row.key)
            if (claimed.has(key)) return { error: { code: '23505', message: 'duplicate key' } }
            claimed.add(key)
            return { error: null }
          },
        }
      }
      if (table === 'customers') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { email: options.customerEmail ?? null }, error: null }),
            }),
          }),
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }
  return { client: client as any, inserts }
}

const INPUT = {
  bookingId: BOOKING,
  eventId: 'event-1',
  customerId: 'customer-1',
  paymentLink: 'https://management.orangejelly.co.uk/g/pay-token/event-payment',
  holdExpiresAt: '2026-11-07T20:42:00.000Z',
  contactEmail: 'guest@example.com',
}

beforeEach(() => {
  vi.clearAllMocks()
  flags.isMessagingFlagOn.mockResolvedValue(false)
  emails.sendEventPaymentLinkEmail.mockResolvedValue({ success: true, messageId: 'email-1' })
})

describe('sendWebsiteHoldPaymentLinkEmail', () => {
  it('claims the booking, then sends the payment link by email only', async () => {
    const db = fakeDb()

    const status = await sendWebsiteHoldPaymentLinkEmail(db.client, INPUT)

    expect(status).toBe('sent')
    expect(db.inserts).toHaveLength(1)
    expect(db.inserts[0]).toMatchObject({ key: websiteHoldPaymentEmailClaimKey(BOOKING) })
    expect(emails.sendEventPaymentLinkEmail).toHaveBeenCalledOnce()
    expect(emails.sendEventPaymentLinkEmail).toHaveBeenCalledWith(db.client, {
      bookingId: BOOKING,
      paymentLink: INPUT.paymentLink,
      holdExpiresAt: INPUT.holdExpiresAt,
    })
    expect(twilio.sendSMS).not.toHaveBeenCalled()
    expect(ledger.createNotificationDelivery).toHaveBeenCalledWith(expect.objectContaining({
      templateKey: 'event_booking_pending_payment',
      customerId: 'customer-1',
    }))
    expect(flags.isMessagingFlagOn).toHaveBeenCalledWith('event_hold_payment_link_email_paused')
  })

  it('uses the customer record email when the booking has no contact email', async () => {
    const db = fakeDb({ customerEmail: 'record@example.com' })

    expect(await sendWebsiteHoldPaymentLinkEmail(db.client, { ...INPUT, contactEmail: null })).toBe('sent')
    expect(emails.sendEventPaymentLinkEmail).toHaveBeenCalledOnce()
  })

  it('sends nothing, and claims nothing, when the guest has no email', async () => {
    const db = fakeDb({ customerEmail: null })

    expect(await sendWebsiteHoldPaymentLinkEmail(db.client, { ...INPUT, contactEmail: '  ' })).toBe('no_email')
    expect(db.inserts).toHaveLength(0)
    expect(emails.sendEventPaymentLinkEmail).not.toHaveBeenCalled()
    expect(twilio.sendSMS).not.toHaveBeenCalled()
    expect(ledger.createNotificationDelivery).not.toHaveBeenCalled()
  })

  it('does not send again for the same booking', async () => {
    const db = fakeDb()

    expect(await sendWebsiteHoldPaymentLinkEmail(db.client, INPUT)).toBe('sent')
    expect(await sendWebsiteHoldPaymentLinkEmail(db.client, INPUT)).toBe('already_claimed')

    expect(emails.sendEventPaymentLinkEmail).toHaveBeenCalledOnce()
  })

  it('sends nothing while the pause flag is on', async () => {
    flags.isMessagingFlagOn.mockResolvedValue(true)
    const db = fakeDb()

    expect(await sendWebsiteHoldPaymentLinkEmail(db.client, INPUT)).toBe('paused')
    expect(db.inserts).toHaveLength(0)
    expect(emails.sendEventPaymentLinkEmail).not.toHaveBeenCalled()
  })

  it('fails closed when the claim cannot be written, and says so in the logs', async () => {
    const db = fakeDb({ claimError: { code: '57014', message: 'statement timeout' } })

    expect(await sendWebsiteHoldPaymentLinkEmail(db.client, INPUT)).toBe('claim_failed')
    expect(emails.sendEventPaymentLinkEmail).not.toHaveBeenCalled()
    expect(log.error).toHaveBeenCalledWith(
      expect.stringContaining('could not claim'),
      expect.objectContaining({ metadata: expect.objectContaining({ code: '57014', message: 'statement timeout' }) }),
    )
  })

  it('never throws when the email fails, records it as undelivered, and texts nobody', async () => {
    emails.sendEventPaymentLinkEmail.mockResolvedValue({ success: false, error: 'Resend is down' })
    const db = fakeDb()

    expect(await sendWebsiteHoldPaymentLinkEmail(db.client, INPUT)).toBe('failed')
    expect(twilio.sendSMS).not.toHaveBeenCalled()
    expect(ledger.updateNotificationDelivery).toHaveBeenCalledWith(expect.objectContaining({ finalStatus: 'failed' }))
    expect(log.error).toHaveBeenCalledWith('Event guest message did not reach the guest', expect.anything())
  })

  it('never throws when the email sender itself throws', async () => {
    emails.sendEventPaymentLinkEmail.mockRejectedValue(new Error('boom'))
    const db = fakeDb()

    await expect(sendWebsiteHoldPaymentLinkEmail(db.client, INPUT)).resolves.toBe('failed')
  })

  it('never throws when something unexpected breaks before the send', async () => {
    flags.isMessagingFlagOn.mockRejectedValue(new Error('flags exploded'))
    const db = fakeDb()

    await expect(sendWebsiteHoldPaymentLinkEmail(db.client, INPUT)).resolves.toBe('failed')
    expect(log.error).toHaveBeenCalledWith('Website hold payment email failed', expect.anything())
  })
})
