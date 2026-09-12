import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The deposit confirmation under the messaging flag table_deposit_confirmed_email_first.
 *
 * Five things can confirm one payment (Stripe webhook, PayPal webhook, the capture route, the
 * guest payment page and the reconciliation cron), sometimes in the same second. The guest must
 * get one message. Runs through the real notifyCustomer; providers, the database, the audit
 * writer and the idempotency store are mocked.
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

// Like the real minter: every call makes a new token, so every trigger builds a different link.
let tokenCounter = 0
vi.mock('@/lib/table-bookings/manage-booking', () => ({
  createTableManageToken: vi.fn(async () => {
    tokenCounter += 1
    return { url: `https://management.example.com/g/token-${tokenCounter}/table-manage`, rawToken: `token-${tokenCounter}` }
  }),
}))
vi.mock('@/lib/guest/guest-short-link', () => ({
  buildGuestShortLink: vi.fn(async ({ longUrl }: { longUrl: string }) => ({
    url: longUrl.replace(/^.*\/g\/(token-\d+)\/table-manage$/, 'https://l.the-anchor.pub/$1'),
    shortened: true,
  })),
}))

// An in-memory idempotency_keys table with the claim semantics of src/lib/api/idempotency.ts.
const claims = new Map<string, { hash: string; response: { state?: string } }>()
vi.mock('@/lib/api/idempotency', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/idempotency')>()
  return {
    ...actual,
    claimIdempotencyKey: vi.fn(async (_db: unknown, key: string, hash: string) => {
      const existing = claims.get(key)
      if (!existing) {
        claims.set(key, { hash, response: { state: 'processing' } })
        return { state: 'claimed' }
      }
      if (existing.hash !== hash) return { state: 'conflict' }
      return existing.response.state === 'processing'
        ? { state: 'in_progress' }
        : { state: 'replay', response: existing.response }
    }),
    persistIdempotencyResponse: vi.fn(async (_db: unknown, key: string, hash: string, response: { state?: string }) => {
      claims.set(key, { hash, response })
    }),
    releaseIdempotencyClaim: vi.fn(async (_db: unknown, key: string) => {
      claims.delete(key)
    }),
  }
})

import { isMessagingFlagOn } from '@/lib/messaging/flags'
import { sendEmail } from '@/lib/email/emailService'
import { isEmailSuppressed } from '@/lib/email/logging'
import { isCustomerSmsSendAllowed, sendSMS } from '@/lib/twilio'
import { createAdminClient } from '@/lib/supabase/admin'
import { AuditService } from '@/services/audit'
import { releaseIdempotencyClaim } from '@/lib/api/idempotency'
import { sendTableBookingConfirmedAfterDepositSmsIfAllowed } from './bookings'
import { buildTableBookingDepositConfirmedEmail } from './guest-emails'
import { argsOf, called, createRecordingSupabase } from '../../../tests/mocks/recordingSupabase'
import { assertCleanRender, assertCleanText, expectedLongDate } from '../../../tests/mocks/emailRenderChecks'

const BOOKING = {
  id: 'booking-9',
  customer_id: 'cust-9',
  status: 'confirmed',
  booking_reference: 'TB-DEP1',
  booking_date: '2026-10-17',
  booking_time: '19:00:00',
  start_datetime: '2026-10-17T18:00:00Z',
  party_size: 16,
  is_outside_seating: false,
  high_chair_count: 1,
  christmas_course_counts: null,
  deposit_amount: 160,
  deposit_amount_locked: 160,
}

const PAT = {
  id: 'cust-9',
  first_name: 'Pat',
  last_name: 'Guest',
  mobile_number: '+447700900999',
  mobile_e164: '+447700900999',
  email: 'pat@example.com',
  sms_status: 'active',
  sms_opt_in: true,
  email_status: 'valid',
  email_deactivated_at: null,
}

/** Email rows the log would hold, by booking id, once an email has gone. */
let loggedEmails = new Set<string>()

function buildDb(customer: typeof PAT | Record<string, unknown> = PAT, options: { emailLookupFails?: boolean } = {}) {
  const db = createRecordingSupabase({
    tables: {
      table_bookings: () => ({ data: BOOKING, error: null }),
      customers: () => ({ data: customer, error: null }),
      email_messages: (query) => {
        if (options.emailLookupFails) return { data: null, error: { message: 'timeout', code: '57014' } }
        const bookingId = argsOf(query, 'eq').find((args) => args[0] === 'table_booking_id')?.[1] as string
        return { data: loggedEmails.has(bookingId) ? { id: 'email-row-1' } : null, error: null }
      },
      notification_deliveries: (query) =>
        called(query, 'insert') ? { data: { id: 'delivery-1' }, error: null } : { data: null, error: null },
      notification_attempts: () => ({ data: null, error: null }),
    },
  })
  vi.mocked(createAdminClient).mockReturnValue(db.client as never)
  return db
}

beforeEach(() => {
  vi.clearAllMocks()
  claims.clear()
  loggedEmails = new Set()
  tokenCounter = 0
  vi.mocked(isMessagingFlagOn).mockImplementation(async (key) => key === 'table_deposit_confirmed_email_first')
  vi.mocked(isEmailSuppressed).mockResolvedValue(false)
  vi.mocked(isCustomerSmsSendAllowed).mockResolvedValue({ allowed: true } as never)
  vi.mocked(sendEmail).mockImplementation(async (options) => {
    loggedEmails.add(String(options.tableBookingId))
    return { success: true, messageId: 're_dep' } as never
  })
  vi.mocked(sendSMS).mockResolvedValue({ success: true, sid: 'SM9' } as never)
})

describe('deposit confirmation, email first (flag on)', () => {
  it('emails a guest with a usable address, with the shared short link, and sends no text', async () => {
    const db = buildDb()

    const result = await sendTableBookingConfirmedAfterDepositSmsIfAllowed(db.client as never, BOOKING.id)

    expect(result).toEqual({ success: true, code: null, logFailure: false })
    expect(sendSMS).not.toHaveBeenCalled()
    expect(sendEmail).toHaveBeenCalledTimes(1)
    const email = vi.mocked(sendEmail).mock.calls[0][0]
    expect(email).toEqual(
      expect.objectContaining({
        to: 'pat@example.com',
        subject: 'Deposit received: your table at The Anchor is confirmed',
        commType: 'table_booking_deposit_confirmed',
        tableBookingId: BOOKING.id,
        idempotencyKey: 'table_booking_deposit_confirmed:booking-9',
      })
    )
    expect(email.text).toContain('Manage your booking: https://l.the-anchor.pub/token-1')
    expect(claims.get('notify:table_booking_deposit_confirmed:booking-9')?.response).toEqual({
      state: 'sent',
      channel: 'email',
    })
  })

  it('sends one email when all five triggers fire one after another', async () => {
    const db = buildDb()

    const results = []
    for (let trigger = 0; trigger < 5; trigger += 1) {
      results.push(await sendTableBookingConfirmedAfterDepositSmsIfAllowed(db.client as never, BOOKING.id))
    }

    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(sendSMS).not.toHaveBeenCalled()
    expect(results[0]).toEqual({ success: true, code: null, logFailure: false })
    for (const later of results.slice(1)) {
      expect(later).toEqual({ success: true, code: 'already_sent', logFailure: false })
    }
  })

  it('sends one email when the capture route and the webhook arrive in the same moment', async () => {
    const db = buildDb()

    await Promise.all(
      Array.from({ length: 5 }, () => sendTableBookingConfirmedAfterDepositSmsIfAllowed(db.client as never, BOOKING.id))
    )

    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(sendSMS).not.toHaveBeenCalled()
  })

  it('texts the same words when the email fails, records both attempts, and still sends only once', async () => {
    vi.mocked(sendEmail).mockResolvedValue({ success: false, error: 'Resend 500' } as never)
    const db = buildDb()

    await sendTableBookingConfirmedAfterDepositSmsIfAllowed(db.client as never, BOOKING.id)
    await sendTableBookingConfirmedAfterDepositSmsIfAllowed(db.client as never, BOOKING.id)

    expect(sendSMS).toHaveBeenCalledTimes(1)
    const [to, body, options] = vi.mocked(sendSMS).mock.calls[0]
    expect(to).toBe('+447700900999')
    expect(body).toMatch(/^The Anchor: Pat! Deposit sorted, your table for 16 people on .+ is locked in\. See you then! High chair reserved x1\. https:\/\/l\.the-anchor\.pub\/token-1$/)
    assertCleanText(body)
    expect(options?.metadata).toEqual({ table_booking_id: BOOKING.id, template_key: 'table_booking_deposit_confirmed' })
    const attempts = db.queries
      .filter((query) => query.table === 'notification_attempts' && called(query, 'insert'))
      .map((query) => argsOf(query, 'insert')[0][0] as Record<string, unknown>)
    expect(attempts).toEqual([
      expect.objectContaining({ channel: 'email', status: 'failed' }),
      expect.objectContaining({ channel: 'sms', status: 'sent' }),
    ])
  })

  it('texts a guest with no usable address, as today', async () => {
    const db = buildDb({ ...PAT, email: null })

    await sendTableBookingConfirmedAfterDepositSmsIfAllowed(db.client as never, BOOKING.id)

    expect(sendEmail).not.toHaveBeenCalled()
    expect(sendSMS).toHaveBeenCalledTimes(1)
  })

  it('reports the failure, writes the audit row and lets a later trigger try again when both channels fail', async () => {
    vi.mocked(sendEmail).mockResolvedValue({ success: false, error: 'Resend 500' } as never)
    vi.mocked(sendSMS).mockResolvedValue({ success: false, error: 'Twilio down' } as never)
    const db = buildDb()

    const first = await sendTableBookingConfirmedAfterDepositSmsIfAllowed(db.client as never, BOOKING.id)

    expect(first).toEqual({ success: false, code: 'failed', logFailure: false })
    expect(vi.mocked(AuditService.logAuditEvent).mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({
        operation_type: 'table_booking.notification_failed',
        resource_id: BOOKING.id,
        operation_status: 'failure',
      })
    )
    expect(releaseIdempotencyClaim).toHaveBeenCalledTimes(1)

    // The reconciliation cron comes round later, the provider is back, and the guest is told.
    vi.mocked(sendEmail).mockResolvedValue({ success: true, messageId: 're_later' } as never)
    const later = await sendTableBookingConfirmedAfterDepositSmsIfAllowed(db.client as never, BOOKING.id)
    expect(later).toEqual({ success: true, code: null, logFailure: false })
  })

  it('still sends when the email log cannot be checked', async () => {
    const db = buildDb(PAT, { emailLookupFails: true })

    await sendTableBookingConfirmedAfterDepositSmsIfAllowed(db.client as never, BOOKING.id)

    expect(sendEmail).toHaveBeenCalledTimes(1)
  })
})

describe('deposit confirmation with the flag off: exactly today', () => {
  it('sends the text alone, with the long manage link, and takes no claim', async () => {
    vi.mocked(isMessagingFlagOn).mockResolvedValue(false)
    const db = buildDb()

    const result = await sendTableBookingConfirmedAfterDepositSmsIfAllowed(db.client as never, BOOKING.id)

    expect(result).toEqual({ success: true, code: null, logFailure: false })
    expect(sendEmail).not.toHaveBeenCalled()
    expect(claims.size).toBe(0)
    const [to, body, options] = vi.mocked(sendSMS).mock.calls[0]
    expect(to).toBe('+447700900999')
    expect(body).toMatch(/^The Anchor: Pat! Deposit sorted, your table for 16 people on .+ is locked in\. See you then! High chair reserved x1\. https:\/\/management\.example\.com\/g\/token-1\/table-manage$/)
    expect(options).toEqual({
      customerId: 'cust-9',
      metadata: { table_booking_id: BOOKING.id, template_key: 'table_booking_deposit_confirmed' },
    })
    const customerQuery = db.queries.find((query) => query.table === 'customers')!
    expect(argsOf(customerQuery, 'select')[0]).toEqual(['id, first_name, mobile_number, sms_status'])
  })
})

describe('deposit confirmation email renders', () => {
  it('carries every fact of the text and the ones it leaves out', () => {
    const email = buildTableBookingDepositConfirmedEmail({
      firstName: 'Pat',
      bookingReference: 'TB-DEP1',
      bookingDate: '2026-10-17',
      bookingTime: '19:00:00',
      startDateTime: '2026-10-17T18:00:00Z',
      partySize: 16,
      highChairCount: 1,
      depositPaid: 160,
      manageLink: 'https://l.the-anchor.pub/abc',
    })

    assertCleanRender(email)
    expect(expectedLongDate('2026-10-17')).toBe('Saturday 17 October 2026')
    expect(email.text).toContain(
      'Hi Pat, your deposit is sorted and your table for 16 people on Saturday 17 October 2026 at 7pm is locked in. See you then!'
    )
    expect(email.text).toContain('Reference: TB-DEP1')
    expect(email.text).toContain('Deposit paid: £160.00')
    expect(email.text).toContain('High chair reserved: x1')
    expect(email.text).toContain('Manage your booking: https://l.the-anchor.pub/abc')
    expect(email.html).toContain('href="https://l.the-anchor.pub/abc"')
  })

  it('handles an outside Christmas booking on the day the clocks go back', () => {
    const summary = 'Christmas courses: 2 x 3 courses, 1 x 1 course. Guests on one course have nothing to pre-order.'
    const email = buildTableBookingDepositConfirmedEmail({
      firstName: 'Pat',
      bookingReference: 'TB-XMAS',
      bookingDate: '2026-10-25',
      bookingTime: '13:30',
      partySize: 3,
      isOutsideSeating: true,
      christmasCourseSummary: summary,
      depositPaid: 30,
      manageLink: null,
    })

    assertCleanRender(email)
    expect(email.subject).toBe('Deposit received: your outside booking at The Anchor is confirmed')
    expect(email.text).toContain(`on ${expectedLongDate('2026-10-25')} at 1:30pm`)
    expect(email.text).toContain('Seating: Outside (weather permitting)')
    expect(email.text).toContain(summary)
    expect(email.text).not.toContain('Manage your booking')
  })

  it('leaves the amount out rather than printing £0.00', () => {
    const email = buildTableBookingDepositConfirmedEmail({
      firstName: 'Pat',
      bookingReference: 'TB-DEP1',
      bookingDate: '2026-10-17',
      partySize: 16,
      depositPaid: 0,
    })

    assertCleanRender(email)
    expect(email.text).not.toContain('Deposit paid')
  })
})
