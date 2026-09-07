import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * The booking confirmation is the highest-volume guest email the pub sends, and
 * every stored one in the 90 days to 2026-09-07 carried a raw ~80-character
 * `/g/<token>/table-manage` URL. The SMS on the same path was already short,
 * because only `sendSMS` rewrites URLs at send time.
 *
 * These tests assert on what `notifyCustomer` is actually handed: the SMS body
 * and both email parts must carry the short link and no token URL at all.
 *
 * NOTE the base URL below is management.orangejelly.co.uk, not example.test. The
 * short-link destination allowlist rejects anything else by throwing, and the
 * helper fails open, so an off-allowlist fixture would quietly exercise the
 * fallback and assert nothing.
 */

const notifyCustomerMock = vi.fn()

vi.mock('@/lib/notifications/notify', () => ({
  notifyCustomer: (input: unknown) => notifyCustomerMock(input),
}))

vi.mock('@/lib/email/emailService', () => ({
  sendEmail: vi.fn(async () => ({ success: true })),
}))

vi.mock('@/lib/twilio', () => ({
  sendSMS: vi.fn(async () => ({ success: true, code: null, logFailure: false })),
}))

vi.mock('@/lib/table-bookings/manage-booking', () => ({
  createTableManageToken: vi.fn(async () => ({
    rawToken: 'raw-manage-token',
    url: 'https://management.orangejelly.co.uk/g/raw-manage-token/table-manage',
    expiresAt: '2026-07-10T00:00:00.000Z',
  })),
}))

const logAuditEventMock = vi.hoisted(() => vi.fn(async () => undefined))

vi.mock('@/services/audit', () => ({
  AuditService: { logAuditEvent: logAuditEventMock },
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({ from: vi.fn() })),
}))

const createShortLinkInternalMock = vi.hoisted(() => vi.fn())

vi.mock('@/services/short-links', () => ({
  ShortLinkService: {
    createShortLinkInternal: createShortLinkInternalMock,
  },
}))

import { sendTableBookingCreatedSmsIfAllowed, type TableBookingRpcResult } from '@/lib/table-bookings/bookings'

const SHORT_URL = 'https://l.the-anchor.pub/tbm123'
const LONG_MANAGE_URL = 'https://management.orangejelly.co.uk/g/raw-manage-token/table-manage'
const LONG_PAYMENT_URL = 'https://management.orangejelly.co.uk/g/raw-pay-token/table-payment'

function customerClient() {
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(async () => ({
            data: {
              id: 'cust-1',
              first_name: 'Sam',
              last_name: 'Jones',
              mobile_e164: '+447700900123',
              mobile_number: '+447700900123',
              email: 'sam@example.test',
              sms_status: 'active',
              sms_opt_in: true,
              marketing_sms_opt_in: true,
              email_status: 'active',
              email_deactivated_at: null,
              marketing_email_opt_in: true,
            },
            error: null,
          })),
        })),
      })),
    })),
  }
}

function confirmedResult(partial: Partial<TableBookingRpcResult> = {}): TableBookingRpcResult {
  return {
    state: 'confirmed',
    table_booking_id: 'tb-1',
    booking_reference: 'TB-0001',
    party_size: 4,
    start_datetime: '2026-07-10T18:00:00.000Z',
    high_chair_count: 0,
    is_outside_seating: false,
    ...partial,
  } as TableBookingRpcResult
}

function captured() {
  const arg = notifyCustomerMock.mock.calls[0]?.[0] as
    | { sms?: { body?: string }; email?: { html?: string; text?: string } }
    | undefined
  return {
    sms: arg?.sms?.body ?? '',
    html: arg?.email?.html ?? '',
    text: arg?.email?.text ?? '',
  }
}

function auditInfo() {
  return logAuditEventMock.mock.calls[0]?.[0]?.additional_info as Record<string, unknown> | undefined
}

describe('table booking confirmation: guest link shortening', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    notifyCustomerMock.mockResolvedValue({ selectedChannels: ['email'], attempts: [] })
    createShortLinkInternalMock.mockResolvedValue({
      short_code: 'tbm123',
      full_url: SHORT_URL,
      already_exists: false,
    })
  })

  it('puts the shortened manage link in the email and the SMS, with no token URL left', async () => {
    await sendTableBookingCreatedSmsIfAllowed(customerClient() as any, {
      customerId: 'cust-1',
      normalizedPhone: '+447700900123',
      bookingResult: confirmedResult(),
    })

    const out = captured()
    expect(out.html).toContain(SHORT_URL)
    expect(out.text).toContain(SHORT_URL)
    expect(out.sms).toContain(SHORT_URL)

    for (const part of [out.html, out.text, out.sms]) {
      expect(part).not.toContain(LONG_MANAGE_URL)
      expect(part).not.toContain('/g/raw-manage-token/')
    }
  })

  it('shortens once and tags the row with the booking it belongs to', async () => {
    await sendTableBookingCreatedSmsIfAllowed(customerClient() as any, {
      customerId: 'cust-1',
      normalizedPhone: '+447700900123',
      bookingResult: confirmedResult(),
    })

    expect(createShortLinkInternalMock).toHaveBeenCalledTimes(1)
    const [payload] = createShortLinkInternalMock.mock.calls[0]
    expect(payload.destination_url).toBe(LONG_MANAGE_URL)
    expect(payload.link_type).toBe('custom')
    expect(payload.metadata.guest_link_kind).toBe('table_manage')
    expect(payload.metadata.table_booking_id).toBe('tb-1')
    expect(payload.metadata.customer_id).toBe('cust-1')
    // An expiry would send a late tapper to the pub homepage rather than a page
    // that explains itself, so the row must not carry one.
    expect(payload.expires_at).toBeUndefined()
    // The raw token is the credential and staff can read short_links.
    expect(JSON.stringify(payload.metadata)).not.toContain('raw-manage-token')
  })

  it('records short_link_fallback false on the audit row when shortening worked', async () => {
    await sendTableBookingCreatedSmsIfAllowed(customerClient() as any, {
      customerId: 'cust-1',
      normalizedPhone: '+447700900123',
      bookingResult: confirmedResult(),
    })

    expect(auditInfo()?.short_link_fallback).toBe(false)
  })

  // A confirmation that never arrives is a lost booking. The character saving is
  // worth far less than the message, so shortening must fail open.
  it('still sends the confirmation with the long link when shortening fails', async () => {
    createShortLinkInternalMock.mockRejectedValue(new Error('short link service down'))

    await sendTableBookingCreatedSmsIfAllowed(customerClient() as any, {
      customerId: 'cust-1',
      normalizedPhone: '+447700900123',
      bookingResult: confirmedResult(),
    })

    const out = captured()
    expect(out.html).toContain(LONG_MANAGE_URL)
    expect(out.text).toContain(LONG_MANAGE_URL)
    expect(out.sms).toContain(LONG_MANAGE_URL)
    // and the failure is durably recorded, not just logged
    expect(auditInfo()?.short_link_fallback).toBe(true)
  })

  it('shortens the deposit payment link on the pending_payment path', async () => {
    createShortLinkInternalMock.mockResolvedValue({
      short_code: 'pay123',
      full_url: 'https://l.the-anchor.pub/pay123',
      already_exists: false,
    })

    await sendTableBookingCreatedSmsIfAllowed(customerClient() as any, {
      customerId: 'cust-1',
      normalizedPhone: '+447700900123',
      bookingResult: confirmedResult({ state: 'pending_payment' }),
      nextStepUrl: LONG_PAYMENT_URL,
    } as any)

    const [payload] = createShortLinkInternalMock.mock.calls[0]
    expect(payload.destination_url).toBe(LONG_PAYMENT_URL)
    expect(payload.metadata.guest_link_kind).toBe('table_payment')

    const out = captured()
    expect(out.sms).toContain('https://l.the-anchor.pub/pay123')
    expect(out.sms).not.toContain('/g/raw-pay-token/')
    expect(out.html).not.toContain('/g/raw-pay-token/')
  })
})
