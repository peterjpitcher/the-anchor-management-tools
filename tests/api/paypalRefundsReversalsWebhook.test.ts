import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase, type FakeSupabase } from '../helpers/fakeSupabase'

/**
 * Refunds made inside PayPal, reversals (chargebacks) and table-booking deposit denials, run
 * through the real webhook: gate stubbed, then the real idempotency claim, router, domain handlers
 * and ledgers against an in-memory database.
 *
 * What these guard, each a way real money went unrecorded or was recorded twice:
 *  - an event ticket refund made in PayPal was logged `unrouted` and never recorded;
 *  - an invoice refund had nowhere to go at all;
 *  - PayPal taking money back (PAYMENT.CAPTURE.REVERSED) was not handled anywhere;
 *  - table bookings ignored a denied deposit capture;
 *  - PayPal sends every refund twice (two event ids, one refund id) and the app issues refunds itself,
 *    so the same money arrives more than once and must be recorded once.
 */

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_APP_URL = 'https://management.orangejelly.co.uk'
  process.env.CRON_ALERT_EMAIL = 'alerts@example.test'
})

vi.mock('@/lib/paypal-webhook-gate', async () => {
  const { paypalGateModuleMock } = await import('@/../tests/helpers/paypalGateMock')
  return paypalGateModuleMock()
})

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

// The staff alert, the only message these paths may send.
vi.mock('@/lib/cron/alerting', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/cron/alerting')>()),
  reportPaymentAlert: vi.fn(async () => ({ sent: true })),
}))

// Every route to a customer, so the tests can prove none is taken.
vi.mock('@/lib/email/emailService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/email/emailService')>()),
  sendEmail: vi.fn(async () => ({ success: true })),
}))
vi.mock('@/lib/twilio', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/twilio')>()),
  sendSMS: vi.fn(async () => ({ success: true })),
}))
vi.mock('@/lib/email/event-ticket-emails', () => ({
  sendEventRefundStatusUpdateEmail: vi.fn(async () => ({ success: true })),
  sendEventPaymentConfirmationEmail: vi.fn(async () => ({ success: true })),
  sendEventPaymentManualReviewEmail: vi.fn(async () => ({ success: true })),
}))
vi.mock('@/lib/events/event-payments', () => ({
  sendEventPaymentConfirmationSms: vi.fn(async () => ({ success: true })),
  sendEventPaymentManualReviewSms: vi.fn(async () => ({ success: true })),
}))
vi.mock('@/lib/analytics/events', () => ({ recordAnalyticsEvent: vi.fn(async () => undefined) }))

import { createAdminClient } from '@/lib/supabase/admin'
import { reportPaymentAlert } from '@/lib/cron/alerting'
import { sendEmail } from '@/lib/email/emailService'
import { sendSMS } from '@/lib/twilio'
import { sendEventRefundStatusUpdateEmail } from '@/lib/email/event-ticket-emails'
import { sendEventPaymentConfirmationSms, sendEventPaymentManualReviewSms } from '@/lib/events/event-payments'
import { recordAnalyticsEvent } from '@/lib/analytics/events'
import { computeIdempotencyRequestHash } from '@/lib/api/idempotency'
import { POST } from '@/app/api/webhooks/paypal/route'

type Row = Record<string, any>

const EVENT_CAPTURE = 'CAP-EVENT-1'
const TICKET_PAYMENT = 'ticket-payment-1'
const EVENT_BOOKING = 'event-booking-1'

const DASHBOARD_REASON = 'Refund initiated via PayPal dashboard'
const REVERSAL_REASON = 'PayPal reversal or chargeback: PayPal took this payment back'

let db: FakeSupabase

function makeDb(seed: Record<string, Row[]>): FakeSupabase {
  const fake = createFakeSupabase(seed, {
    unique: {
      idempotency_keys: (row) => row.key,
      // Partial unique index: only rows that carry a refund id.
      payment_refunds: (row) => row.paypal_refund_id ?? undefined,
      // payments_paypal_refund_id_unique: refund rows carrying a refund id.
      payments: (row) => (row.charge_type === 'refund' ? row.metadata?.paypal_refund_id ?? undefined : undefined),
    },
  })
  // idempotency_keys is keyed on `key`; the real upsert conflicts on it.
  const from = fake.from
  fake.from = (table: string) => {
    const builder = from(table)
    if (table === 'idempotency_keys') {
      const upsert = builder.upsert
      builder.upsert = (rows: Row | Row[], options?: { onConflict?: string }) =>
        upsert(rows, { onConflict: 'key', ...(options ?? {}) })
    }
    return builder
  }
  vi.mocked(createAdminClient).mockReturnValue(fake as never)
  db = fake
  return fake
}

function rows(table: string): Row[] {
  return db.tables[table] ?? []
}

function refundResource(input: { refundId: string; captureId: string; amount: string; status?: string }): Row {
  return {
    id: input.refundId,
    status: input.status ?? 'COMPLETED',
    amount: { value: input.amount, currency_code: 'GBP' },
    links: [
      { rel: 'self', href: `https://api-m.paypal.com/v2/payments/refunds/${input.refundId}` },
      { rel: 'up', href: `https://api-m.paypal.com/v2/payments/captures/${input.captureId}` },
    ],
  }
}

function refundEvent(
  eventId: string,
  input: { refundId: string; captureId: string; amount: string; status?: string },
  eventType = 'PAYMENT.CAPTURE.REFUNDED',
): Row {
  return { id: eventId, event_type: eventType, resource: refundResource(input) }
}

function reversalEvent(eventId: string, input: { refundId: string; captureId: string; amount: string }): Row {
  return refundEvent(eventId, input, 'PAYMENT.CAPTURE.REVERSED')
}

async function deliver(event: Row): Promise<{ status: number; body: Row }> {
  const built = new Request('https://management.orangejelly.co.uk/api/webhooks/paypal', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(event),
  })
  const response = await POST(Object.assign(built, { nextUrl: new URL(built.url) }) as never)
  return { status: response.status, body: await response.json() }
}

function webhookStatuses(eventId: string): string[] {
  return rows('webhook_logs').filter((row) => row.params?.event_id === eventId).map((row) => row.status)
}

function eventRefundRows(): Row[] {
  return rows('payments').filter((row) => row.charge_type === 'refund')
}

function ticketPayment(): Row {
  return rows('payments').find((row) => row.id === TICKET_PAYMENT) as Row
}

function eventSeed(extraPayments: Row[] = [], sourceStatus = 'succeeded'): Record<string, Row[]> {
  return {
    bookings: [{ id: EVENT_BOOKING, customer_id: 'customer-1', event_id: 'event-1', status: 'confirmed' }],
    payments: [
      {
        id: TICKET_PAYMENT,
        event_booking_id: EVENT_BOOKING,
        charge_type: 'prepaid_event',
        payment_provider: 'paypal',
        payment_method: 'paypal',
        amount: 20,
        currency: 'GBP',
        status: sourceStatus,
        paypal_capture_id: EVENT_CAPTURE,
        paypal_order_id: 'ORDER-EVENT-1',
        metadata: {},
        created_at: '2026-09-01T10:00:00.000Z',
      },
      ...extraPayments,
    ],
  }
}

function expectNoCustomerMessage() {
  expect(sendEmail).not.toHaveBeenCalled()
  expect(sendSMS).not.toHaveBeenCalled()
  expect(sendEventRefundStatusUpdateEmail).not.toHaveBeenCalled()
  expect(sendEventPaymentConfirmationSms).not.toHaveBeenCalled()
  expect(sendEventPaymentManualReviewSms).not.toHaveBeenCalled()
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(reportPaymentAlert).mockResolvedValue({ sent: true })
})

describe('event ticket refund made inside PayPal', () => {
  it('records it the way a staff refund is recorded, and moves the ticket charge on', async () => {
    makeDb(eventSeed())

    const response = await deliver(refundEvent('WH-E1', { refundId: 'R-E1', captureId: EVENT_CAPTURE, amount: '8.00' }))

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ received: true, state: 'refund_recorded', booking_id: EVENT_BOOKING })
    expect(eventRefundRows()).toEqual([
      expect.objectContaining({
        event_booking_id: EVENT_BOOKING,
        charge_type: 'refund',
        payment_provider: 'paypal',
        payment_method: 'paypal',
        amount: 8,
        currency: 'GBP',
        status: 'refunded',
        metadata: expect.objectContaining({
          source_payment_id: TICKET_PAYMENT,
          source_paypal_capture_id: EVENT_CAPTURE,
          paypal_refund_id: 'R-E1',
          reason: 'paypal_dashboard_refund',
          initiated_by_type: 'system',
        }),
      }),
    ])
    expect(ticketPayment().status).toBe('partially_refunded')
    // A refund on its own never cancels the seat.
    expect(rows('bookings')[0].status).toBe('confirmed')
    expect(rows('audit_logs')).toEqual([
      expect.objectContaining({ operation_type: 'paypal_dashboard_refund_reconciled', resource_id: EVENT_BOOKING }),
    ])
    expect(recordAnalyticsEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ eventType: 'refund_created' }))
    expect(webhookStatuses('WH-E1')).toEqual(['received', 'success'])
    expect(reportPaymentAlert).not.toHaveBeenCalled()
    expectNoCustomerMessage()
  })

  it('does nothing the second time PayPal delivers the same event', async () => {
    makeDb(eventSeed())
    const event = refundEvent('WH-E2', { refundId: 'R-E2', captureId: EVENT_CAPTURE, amount: '8.00' })

    await deliver(event)
    const second = await deliver(event)

    expect(second.status).toBe(200)
    expect(second.body).toEqual({ received: true, duplicate: true })
    expect(eventRefundRows()).toHaveLength(1)
  })

  it('records one row when PayPal sends the refund as two different events', async () => {
    makeDb(eventSeed())
    const refund = { refundId: 'R-E3', captureId: EVENT_CAPTURE, amount: '8.00' }

    await deliver(refundEvent('WH-E3a', refund, 'PAYMENT.CAPTURE.REFUNDED'))
    const second = await deliver(refundEvent('WH-E3b', refund, 'PAYMENT.REFUND.COMPLETED'))

    expect(second.status).toBe(200)
    expect(second.body).toMatchObject({ state: 'refund_reconciled', matched: true })
    expect(eventRefundRows()).toHaveLength(1)
    expect(ticketPayment().status).toBe('partially_refunded')
  })

  it('is a no-op for a refund staff already issued and recorded', async () => {
    makeDb(eventSeed([
      {
        id: 'staff-refund-1',
        event_booking_id: EVENT_BOOKING,
        charge_type: 'refund',
        payment_provider: 'paypal',
        amount: 5,
        currency: 'GBP',
        status: 'refunded',
        metadata: { source_payment_id: TICKET_PAYMENT, paypal_refund_id: 'R-STAFF', reason: 'staff_manual_refund' },
      },
    ], 'partially_refunded'))

    const response = await deliver(refundEvent('WH-E4', { refundId: 'R-STAFF', captureId: EVENT_CAPTURE, amount: '5.00' }))

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ state: 'refund_reconciled', matched: true })
    expect(eventRefundRows()).toHaveLength(1)
    expect(eventRefundRows()[0].metadata.reason).toBe('staff_manual_refund')
    expect(ticketPayment().status).toBe('partially_refunded')
  })

  it('settles a pending staff refund and brings the ticket charge up to date', async () => {
    makeDb(eventSeed([
      {
        id: 'staff-refund-2',
        event_booking_id: EVENT_BOOKING,
        charge_type: 'refund',
        payment_provider: 'paypal',
        amount: 20,
        currency: 'GBP',
        status: 'pending',
        metadata: { source_payment_id: TICKET_PAYMENT, paypal_refund_id: 'R-PENDING', reason: 'staff_cancel_refund' },
      },
    ]))

    await deliver(refundEvent('WH-E5', { refundId: 'R-PENDING', captureId: EVENT_CAPTURE, amount: '20.00' }))

    expect(eventRefundRows()).toHaveLength(1)
    expect(eventRefundRows()[0].status).toBe('refunded')
    expect(ticketPayment().status).toBe('refunded')
  })

  it('records a PayPal refund that goes pending then completes, without emailing the guest', async () => {
    makeDb(eventSeed())
    const refund = { refundId: 'R-E10', captureId: EVENT_CAPTURE, amount: '20.00' }

    const pending = await deliver(refundEvent('WH-E10a', { ...refund, status: 'PENDING' }, 'PAYMENT.REFUND.PENDING'))
    expect(pending.status).toBe(200)
    expect(eventRefundRows()).toEqual([expect.objectContaining({ status: 'pending' })])
    expect(ticketPayment().status).toBe('succeeded')

    await deliver(refundEvent('WH-E10b', refund, 'PAYMENT.REFUND.COMPLETED'))

    expect(eventRefundRows()).toEqual([expect.objectContaining({ status: 'refunded' })])
    expect(ticketPayment().status).toBe('refunded')
    // We never promised the guest this refund, so we do not write to them about it.
    expectNoCustomerMessage()
  })

  it('applies a completion that arrives while the pending event for the same refund is being recorded', async () => {
    makeDb(eventSeed())
    const claimKey = 'paypal:event-refund:R-E11'
    // The PENDING event records the refund after this COMPLETED delivery has looked for it and
    // before it takes the refund claim, so the claim reads as already done.
    let landed = false
    const from = db.from
    db.from = (table: string) => {
      const builder = from(table)
      if (table === 'idempotency_keys') {
        const insert = builder.insert
        builder.insert = (row: Row) => {
          if (!landed && row?.key === claimKey) {
            landed = true
            db.tables.payments.push({
              id: 'pending-delivery-row',
              event_booking_id: EVENT_BOOKING,
              charge_type: 'refund',
              payment_provider: 'paypal',
              payment_method: 'paypal',
              amount: 10,
              currency: 'GBP',
              status: 'pending',
              metadata: {
                source_payment_id: TICKET_PAYMENT,
                source_paypal_capture_id: EVENT_CAPTURE,
                paypal_refund_id: 'R-E11',
                paypal_refund_status: 'PENDING',
                reason: 'paypal_dashboard_refund',
                kind: 'refund',
                initiated_by_type: 'system',
              },
            })
            db.tables.idempotency_keys.push({
              key: claimKey,
              request_hash: computeIdempotencyRequestHash({ claimKey }),
              response: { state: 'recorded', payment_id: 'pending-delivery-row' },
              expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
            })
          }
          return insert(row)
        }
      }
      return builder
    }

    const response = await deliver(refundEvent('WH-E11', { refundId: 'R-E11', captureId: EVENT_CAPTURE, amount: '10.00' }, 'PAYMENT.REFUND.COMPLETED'))

    expect(landed).toBe(true)
    expect(response.status).toBe(200)
    expect(eventRefundRows()).toEqual([expect.objectContaining({ id: 'pending-delivery-row', status: 'refunded' })])
    expect(ticketPayment().status).toBe('partially_refunded')
    expectNoCustomerMessage()
  })

  it('settles a staff refund written between the lookup and the claim, rather than stopping at it', async () => {
    makeDb(eventSeed())
    const claimKey = 'paypal:event-refund:R-E12'
    let landed = false
    const from = db.from
    db.from = (table: string) => {
      const builder = from(table)
      if (table === 'idempotency_keys') {
        const insert = builder.insert
        builder.insert = (row: Row) => {
          if (!landed && row?.key === claimKey) {
            landed = true
            db.tables.payments.push({
              id: 'staff-row-12',
              event_booking_id: EVENT_BOOKING,
              charge_type: 'refund',
              payment_provider: 'paypal',
              payment_method: 'paypal',
              amount: 20,
              currency: 'GBP',
              status: 'pending',
              metadata: { source_payment_id: TICKET_PAYMENT, paypal_refund_id: 'R-E12', reason: 'staff_cancel_refund' },
            })
          }
          return insert(row)
        }
      }
      return builder
    }

    const response = await deliver(refundEvent('WH-E12', { refundId: 'R-E12', captureId: EVENT_CAPTURE, amount: '20.00' }))

    expect(landed).toBe(true)
    expect(response.status).toBe(200)
    expect(eventRefundRows()).toEqual([expect.objectContaining({ id: 'staff-row-12', status: 'refunded' })])
    expect(ticketPayment().status).toBe('refunded')
  })

  it('settles a staff refund written between the re-check and the insert, which the unique index refuses', async () => {
    makeDb(eventSeed())
    let landed = false
    const from = db.from
    db.from = (table: string) => {
      const builder = from(table)
      if (table === 'payments') {
        const insert = builder.insert
        builder.insert = (row: Row) => {
          if (!landed && row?.charge_type === 'refund' && row?.metadata?.paypal_refund_id === 'R-E13') {
            landed = true
            db.tables.payments.push({
              id: 'staff-row-13',
              event_booking_id: EVENT_BOOKING,
              charge_type: 'refund',
              payment_provider: 'paypal',
              payment_method: 'paypal',
              amount: 20,
              currency: 'GBP',
              status: 'pending',
              metadata: { source_payment_id: TICKET_PAYMENT, paypal_refund_id: 'R-E13', reason: 'staff_cancel_refund' },
            })
          }
          return insert(row)
        }
      }
      return builder
    }

    const response = await deliver(refundEvent('WH-E13', { refundId: 'R-E13', captureId: EVENT_CAPTURE, amount: '20.00' }))

    expect(landed).toBe(true)
    expect(response.status).toBe(200)
    expect(eventRefundRows()).toEqual([expect.objectContaining({ id: 'staff-row-13', status: 'refunded' })])
    expect(ticketPayment().status).toBe('refunded')
  })

  it('goes from part refunded to refunded across two refunds', async () => {
    makeDb(eventSeed())

    await deliver(refundEvent('WH-E6a', { refundId: 'R-E6a', captureId: EVENT_CAPTURE, amount: '12.00' }))
    expect(ticketPayment().status).toBe('partially_refunded')

    await deliver(refundEvent('WH-E6b', { refundId: 'R-E6b', captureId: EVENT_CAPTURE, amount: '8.00' }))
    expect(ticketPayment().status).toBe('refunded')
    expect(eventRefundRows().map((row) => row.metadata.paypal_refund_id)).toEqual(['R-E6a', 'R-E6b'])
  })

  it('attaches the refund id to an older row recorded without one instead of recording it again', async () => {
    makeDb(eventSeed([
      {
        id: 'legacy-refund',
        event_booking_id: EVENT_BOOKING,
        charge_type: 'refund',
        payment_provider: 'paypal',
        amount: 20,
        currency: 'GBP',
        status: 'refunded',
        metadata: { source_payment_id: TICKET_PAYMENT, reason: 'staff_cancel_refund' },
      },
    ], 'refunded'))

    const response = await deliver(refundEvent('WH-E7', { refundId: 'R-OLD', captureId: EVENT_CAPTURE, amount: '20.00' }))

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ state: 'refund_attached' })
    expect(eventRefundRows()).toHaveLength(1)
    expect(eventRefundRows()[0]).toMatchObject({ id: 'legacy-refund', metadata: expect.objectContaining({ paypal_refund_id: 'R-OLD' }) })
  })

  it('refuses to record more coming back than was paid, and tells staff once', async () => {
    makeDb(eventSeed([
      {
        id: 'staff-refund-3',
        event_booking_id: EVENT_BOOKING,
        charge_type: 'refund',
        amount: 15,
        currency: 'GBP',
        status: 'refunded',
        metadata: { source_payment_id: TICKET_PAYMENT, paypal_refund_id: 'R-EARLIER' },
      },
    ], 'partially_refunded'))
    const refund = { refundId: 'R-TOO-MUCH', captureId: EVENT_CAPTURE, amount: '10.00' }

    const first = await deliver(refundEvent('WH-E8a', refund))
    const second = await deliver(refundEvent('WH-E8b', refund, 'PAYMENT.REFUND.COMPLETED'))

    expect(first.status).toBe(202)
    expect(first.body).toMatchObject({ state: 'manual_review', reason: 'exceeds_captured_amount' })
    expect(second.status).toBe(202)
    expect(eventRefundRows()).toHaveLength(1)
    expect(webhookStatuses('WH-E8a')).toEqual(['received', 'manual_review'])
    expect(reportPaymentAlert).toHaveBeenCalledTimes(1)
    expect(vi.mocked(reportPaymentAlert).mock.calls[0][0].title).toContain('needs recording')
    // Everything that is not an invoice keeps going to the general staff alert inbox.
    expect(vi.mocked(reportPaymentAlert).mock.calls[0][0].to).toBeUndefined()
    expectNoCustomerMessage()
  })

  it('answers 500 and logs no success when the refund row cannot be written, then records it on the retry', async () => {
    makeDb(eventSeed())
    db.failures.push({ table: 'payments', op: 'insert', error: { message: 'insert failed' } })
    const event = refundEvent('WH-E9', { refundId: 'R-E9', captureId: EVENT_CAPTURE, amount: '8.00' })

    const failed = await deliver(event)

    expect(failed.status).toBe(500)
    expect(webhookStatuses('WH-E9')).toEqual(['received', 'error'])
    expect(eventRefundRows()).toHaveLength(0)
    // Both claims released, so the retry is not mistaken for a duplicate.
    expect(rows('idempotency_keys')).toHaveLength(0)

    db.failures.length = 0
    const retried = await deliver(event)

    expect(retried.status).toBe(200)
    expect(eventRefundRows()).toHaveLength(1)
    expect(webhookStatuses('WH-E9')).toEqual(['received', 'error', 'received', 'success'])
  })
})

describe('invoice refund made inside PayPal', () => {
  function invoiceSeed(): Record<string, Row[]> {
    return {
      invoices: [{ id: 'inv-1', invoice_number: 'INV-001', total_amount: 50, paid_amount: 50, status: 'paid' }],
      invoice_payments: [
        { id: 'ip-1', invoice_id: 'inv-1', amount: 50, payment_method: 'paypal', reference: 'CAP-INV-1', source_kind: 'paypal' },
      ],
    }
  }

  it('leaves the invoice ledger alone, records an audit row and asks staff for a credit note once', async () => {
    makeDb(invoiceSeed())
    const refund = { refundId: 'R-INV', captureId: 'CAP-INV-1', amount: '50.00' }

    const first = await deliver(refundEvent('WH-I1a', refund))
    const second = await deliver(refundEvent('WH-I1b', refund, 'PAYMENT.REFUND.COMPLETED'))

    expect(first.status).toBe(202)
    expect(second.status).toBe(202)
    expect(webhookStatuses('WH-I1a')).toEqual(['received', 'manual_review'])
    expect(rows('invoice_payments')).toEqual(invoiceSeed().invoice_payments)
    expect(rows('invoices')).toEqual(invoiceSeed().invoices)
    expect(rows('audit_logs')).toEqual([
      expect.objectContaining({ operation_type: 'paypal_refund_unrecorded', resource_type: 'invoice', resource_id: 'inv-1', operation_status: 'failure' }),
      expect.objectContaining({ operation_type: 'paypal_refund_unrecorded', resource_id: 'inv-1' }),
    ])
    expect(reportPaymentAlert).toHaveBeenCalledTimes(1)
    expect(vi.mocked(reportPaymentAlert).mock.calls[0][0].title).toContain('credit note')
    // Invoice credit notes are the owner's call, so only the manager inbox hears about them.
    expect(vi.mocked(reportPaymentAlert).mock.calls[0][0].to).toBe('manager@the-anchor.pub')
    expectNoCustomerMessage()
  })

  it('answers 500 when the audit row cannot be written', async () => {
    makeDb(invoiceSeed())
    db.failures.push({ table: 'audit_logs', op: 'insert', error: { message: 'audit down' } })

    const response = await deliver(refundEvent('WH-I2', { refundId: 'R-INV2', captureId: 'CAP-INV-1', amount: '10.00' }))

    expect(response.status).toBe(500)
    expect(webhookStatuses('WH-I2')).toEqual(['received', 'error'])
    expect(reportPaymentAlert).not.toHaveBeenCalled()
  })
})

describe('refunds on deposits and parking (payment_refunds)', () => {
  function tableSeed(extraRefunds: Row[] = []): Record<string, Row[]> {
    return {
      table_bookings: [{
        id: 'tb-1',
        status: 'confirmed',
        payment_status: 'completed',
        paypal_deposit_capture_id: 'CAP-TB-1',
        paypal_deposit_order_id: 'ORDER-TB-1',
        deposit_amount: 60,
        deposit_amount_locked: 60,
        deposit_refund_status: null,
      }],
      payment_refunds: extraRefunds,
    }
  }

  it('records a dashboard refund on a table booking deposit', async () => {
    makeDb(tableSeed())

    const response = await deliver(refundEvent('WH-T1', { refundId: 'R-T1', captureId: 'CAP-TB-1', amount: '20.00' }))

    expect(response.status).toBe(200)
    expect(rows('payment_refunds')).toEqual([
      expect.objectContaining({
        source_type: 'table_booking',
        source_id: 'tb-1',
        paypal_refund_id: 'R-T1',
        amount: 20,
        original_amount: 60,
        status: 'completed',
        reason: DASHBOARD_REASON,
        initiated_by_type: 'system',
      }),
    ])
    expect(rows('table_bookings')[0]).toMatchObject({ deposit_refund_status: 'partially_refunded', payment_status: 'partial_refund', status: 'confirmed' })
  })

  it('attaches the id to a staff refund recorded without one (local update failed after PayPal took it)', async () => {
    makeDb(tableSeed([{
      id: 'pr-1',
      source_type: 'table_booking',
      source_id: 'tb-1',
      paypal_capture_id: 'CAP-TB-1',
      paypal_refund_id: null,
      refund_method: 'paypal',
      amount: 20,
      original_amount: 60,
      status: 'completed',
      initiated_by_type: 'staff',
      created_at: '2026-09-20T10:00:00.000Z',
    }]))

    const response = await deliver(refundEvent('WH-T2', { refundId: 'R-T2', captureId: 'CAP-TB-1', amount: '20.00' }))

    expect(response.status).toBe(200)
    expect(rows('payment_refunds')).toHaveLength(1)
    expect(rows('payment_refunds')[0]).toMatchObject({ id: 'pr-1', paypal_refund_id: 'R-T2', status: 'completed' })
  })

  it('completes a staff refund still waiting for PayPal instead of recording a second one', async () => {
    makeDb(tableSeed([{
      id: 'pr-2',
      source_type: 'table_booking',
      source_id: 'tb-1',
      paypal_capture_id: 'CAP-TB-1',
      paypal_refund_id: null,
      refund_method: 'paypal',
      amount: 60,
      original_amount: 60,
      status: 'pending',
      initiated_by_type: 'staff',
    }]))

    await deliver(refundEvent('WH-T3', { refundId: 'R-T3', captureId: 'CAP-TB-1', amount: '60.00' }))

    expect(rows('payment_refunds')).toHaveLength(1)
    expect(rows('payment_refunds')[0]).toMatchObject({ id: 'pr-2', paypal_refund_id: 'R-T3', status: 'completed' })
    expect(rows('table_bookings')[0]).toMatchObject({ deposit_refund_status: 'refunded', payment_status: 'refunded' })
  })

  it('sends a refund that does not match a pending staff refund to a person', async () => {
    makeDb(tableSeed([{
      id: 'pr-3',
      source_type: 'table_booking',
      source_id: 'tb-1',
      paypal_capture_id: 'CAP-TB-1',
      paypal_refund_id: null,
      refund_method: 'paypal',
      amount: 30,
      original_amount: 60,
      status: 'pending',
    }]))

    const response = await deliver(refundEvent('WH-T4', { refundId: 'R-T4', captureId: 'CAP-TB-1', amount: '10.00' }))

    expect(response.status).toBe(202)
    expect(rows('payment_refunds')).toHaveLength(1)
    expect(rows('payment_refunds')[0].paypal_refund_id).toBeNull()
    expect(reportPaymentAlert).toHaveBeenCalledTimes(1)
  })

  it('records one row when PayPal sends the refund as two different events', async () => {
    makeDb(tableSeed())
    const refund = { refundId: 'R-T5', captureId: 'CAP-TB-1', amount: '20.00' }

    await deliver(refundEvent('WH-T5a', refund))
    const second = await deliver(refundEvent('WH-T5b', refund, 'PAYMENT.REFUND.COMPLETED'))

    expect(second.status).toBe(200)
    expect(rows('payment_refunds')).toHaveLength(1)
  })

  it('does not mistake the other event for the same refund, landing mid-delivery, for over-refunding', async () => {
    makeDb(tableSeed())
    // PayPal's other event for this refund records it after this delivery has looked it up by id
    // and before it sums the refunds already on the booking.
    let landed = false
    const from = db.from
    db.from = (table: string) => {
      const builder = from(table)
      if (table === 'payment_refunds') {
        const inFilter = builder.in
        builder.in = (column: string, values: unknown[]) => {
          if (!landed && column === 'status' && values.join() === 'completed,pending') {
            landed = true
            db.tables.payment_refunds.push({
              id: 'other-delivery-row',
              source_type: 'table_booking',
              source_id: 'tb-1',
              paypal_capture_id: 'CAP-TB-1',
              paypal_refund_id: 'R-T8',
              paypal_status: 'COMPLETED',
              refund_method: 'paypal',
              amount: 60,
              original_amount: 60,
              reason: DASHBOARD_REASON,
              status: 'completed',
              initiated_by_type: 'system',
            })
          }
          return inFilter(column, values)
        }
      }
      return builder
    }

    const response = await deliver(refundEvent('WH-T8', { refundId: 'R-T8', captureId: 'CAP-TB-1', amount: '60.00' }))

    expect(landed).toBe(true)
    expect(response.status).toBe(200)
    expect(webhookStatuses('WH-T8')).toEqual(['received', 'success'])
    expect(rows('payment_refunds')).toHaveLength(1)
    // Not "record it by hand": it is recorded already.
    expect(reportPaymentAlert).not.toHaveBeenCalled()
    expect(rows('table_bookings')[0]).toMatchObject({ deposit_refund_status: 'refunded', payment_status: 'refunded' })
  })

  it('answers 500 when the booking cannot be updated, and converges on the retry', async () => {
    makeDb(tableSeed())
    db.failures.push({ table: 'table_bookings', op: 'update', error: { message: 'update failed' } })
    const event = refundEvent('WH-T6', { refundId: 'R-T6', captureId: 'CAP-TB-1', amount: '60.00' })

    const failed = await deliver(event)

    expect(failed.status).toBe(500)
    expect(webhookStatuses('WH-T6')).toEqual(['received', 'error'])

    db.failures.length = 0
    const retried = await deliver(event)

    expect(retried.status).toBe(200)
    expect(rows('payment_refunds')).toHaveLength(1)
    expect(rows('table_bookings')[0]).toMatchObject({ deposit_refund_status: 'refunded', payment_status: 'refunded' })
  })

  it('answers 500 when the refund row cannot be written', async () => {
    makeDb(tableSeed())
    db.failures.push({ table: 'payment_refunds', op: 'insert', error: { message: 'insert failed' } })

    const response = await deliver(refundEvent('WH-T7', { refundId: 'R-T7', captureId: 'CAP-TB-1', amount: '20.00' }))

    expect(response.status).toBe(500)
    expect(webhookStatuses('WH-T7')).not.toContain('success')
    expect(rows('table_bookings')[0].deposit_refund_status).toBeNull()
  })
})

describe('reversals and chargebacks (PAYMENT.CAPTURE.REVERSED)', () => {
  it('records a table booking reversal as a refund and alerts staff, never the customer', async () => {
    makeDb({
      table_bookings: [{
        id: 'tb-1',
        status: 'confirmed',
        payment_status: 'completed',
        paypal_deposit_capture_id: 'CAP-TB-1',
        deposit_amount: 60,
        deposit_amount_locked: 60,
      }],
    })
    const event = reversalEvent('WH-R1', { refundId: 'REV-1', captureId: 'CAP-TB-1', amount: '60.00' })

    const response = await deliver(event)
    const again = await deliver(event)

    expect(response.status).toBe(200)
    expect(again.body).toEqual({ received: true, duplicate: true })
    expect(rows('payment_refunds')).toEqual([
      expect.objectContaining({ source_type: 'table_booking', paypal_refund_id: 'REV-1', amount: 60, status: 'completed', reason: REVERSAL_REASON }),
    ])
    expect(rows('table_bookings')[0]).toMatchObject({ deposit_refund_status: 'refunded', payment_status: 'refunded', status: 'confirmed' })
    expect(rows('audit_logs')).toEqual([expect.objectContaining({ operation_type: 'paypal_capture_reversal_recorded' })])
    expect(reportPaymentAlert).toHaveBeenCalledTimes(1)
    expect(vi.mocked(reportPaymentAlert).mock.calls[0][0].title).toBe('PayPal took back £60.00 on a table booking deposit')
    expectNoCustomerMessage()
  })

  it('records a part reversal on a private booking deposit', async () => {
    makeDb({ private_bookings: [{ id: 'pb-1', status: 'confirmed', paypal_deposit_capture_id: 'CAP-PB-1', deposit_amount: 100 }] })

    const response = await deliver(reversalEvent('WH-R2', { refundId: 'REV-2', captureId: 'CAP-PB-1', amount: '40.00' }))

    expect(response.status).toBe(200)
    expect(rows('payment_refunds')).toEqual([expect.objectContaining({ source_type: 'private_booking', amount: 40, reason: REVERSAL_REASON })])
    expect(rows('private_bookings')[0]).toMatchObject({ deposit_refund_status: 'partially_refunded', status: 'confirmed' })
    expect(reportPaymentAlert).toHaveBeenCalledTimes(1)
    expectNoCustomerMessage()
  })

  it('records a parking reversal without cancelling the booking', async () => {
    makeDb({
      parking_booking_payments: [{ id: 'pp-1', booking_id: 'park-1', transaction_id: 'CAP-PARK-1', amount: 25, status: 'paid' }],
      parking_bookings: [{ id: 'park-1', status: 'confirmed', payment_status: 'paid' }],
    })

    const response = await deliver(reversalEvent('WH-R3', { refundId: 'REV-3', captureId: 'CAP-PARK-1', amount: '25.00' }))

    expect(response.status).toBe(200)
    expect(rows('parking_booking_payments')[0].refund_status).toBe('refunded')
    expect(rows('parking_bookings')[0]).toMatchObject({ payment_status: 'refunded', status: 'confirmed' })
    expect(reportPaymentAlert).toHaveBeenCalledTimes(1)
    expectNoCustomerMessage()
  })

  it('records an event ticket reversal with no refund email and no analytics', async () => {
    makeDb(eventSeed())

    const response = await deliver(reversalEvent('WH-R4', { refundId: 'REV-4', captureId: EVENT_CAPTURE, amount: '20.00' }))

    expect(response.status).toBe(200)
    expect(eventRefundRows()).toEqual([
      expect.objectContaining({ amount: 20, status: 'refunded', metadata: expect.objectContaining({ reason: 'paypal_reversal', kind: 'reversal', paypal_refund_id: 'REV-4' }) }),
    ])
    expect(ticketPayment().status).toBe('refunded')
    expect(recordAnalyticsEvent).not.toHaveBeenCalled()
    expect(reportPaymentAlert).toHaveBeenCalledTimes(1)
    expect(vi.mocked(reportPaymentAlert).mock.calls[0][0].summary).toContain('recorded it as money returned')
    expectNoCustomerMessage()
  })

  it('leaves an invoice unchanged, audits it and alerts staff', async () => {
    makeDb({
      invoices: [{ id: 'inv-1', paid_amount: 50, status: 'paid' }],
      invoice_payments: [{ id: 'ip-1', invoice_id: 'inv-1', amount: 50, reference: 'CAP-INV-1', source_kind: 'paypal' }],
    })

    const response = await deliver(reversalEvent('WH-R5', { refundId: 'REV-5', captureId: 'CAP-INV-1', amount: '50.00' }))

    expect(response.status).toBe(202)
    expect(rows('invoice_payments')).toHaveLength(1)
    expect(rows('invoices')[0]).toMatchObject({ paid_amount: 50, status: 'paid' })
    expect(rows('audit_logs')).toEqual([expect.objectContaining({ operation_type: 'paypal_capture_reversed', resource_id: 'inv-1' })])
    expect(reportPaymentAlert).toHaveBeenCalledTimes(1)
    expect(vi.mocked(reportPaymentAlert).mock.calls[0][0].summary).toContain('issue a credit note')
    expect(vi.mocked(reportPaymentAlert).mock.calls[0][0].to).toBe('manager@the-anchor.pub')
    expectNoCustomerMessage()
  })

  it('does not guess at a reversal shaped as a capture: nothing recorded, staff alerted', async () => {
    makeDb({
      table_bookings: [{ id: 'tb-9', status: 'confirmed', payment_status: 'completed', paypal_deposit_capture_id: 'CAP-TB-9', deposit_amount: 60 }],
    })

    const response = await deliver({
      id: 'WH-R6',
      event_type: 'PAYMENT.CAPTURE.REVERSED',
      resource: { id: 'CAP-TB-9', custom_id: 'tb-9', status: 'REVERSED', amount: { value: '60.00', currency_code: 'GBP' } },
    })

    expect(response.status).toBe(202)
    expect(rows('payment_refunds')).toHaveLength(0)
    expect(reportPaymentAlert).toHaveBeenCalledTimes(1)
    expect(vi.mocked(reportPaymentAlert).mock.calls[0][0].summary).toContain('could not record it automatically')
  })
})

describe('table booking deposit denied (PAYMENT.CAPTURE.DENIED)', () => {
  function denial(eventId: string, bookingId: string, orderId: string | null): Row {
    const resource: Row = { id: 'CAP-DENIED', custom_id: bookingId, status: 'DENIED', status_details: { reason: 'INSTRUMENT_DECLINED' } }
    if (orderId) resource.supplementary_data = { related_ids: { order_id: orderId } }
    return { id: eventId, event_type: 'PAYMENT.CAPTURE.DENIED', resource }
  }

  function pendingBooking(orderId: string): Record<string, Row[]> {
    return {
      table_bookings: [{
        id: 'tb-2',
        status: 'pending_payment',
        payment_status: 'pending',
        paypal_deposit_order_id: orderId,
        paypal_deposit_capture_id: null,
      }],
    }
  }

  it('releases the denied order so a fresh one can be issued, and changes nothing else', async () => {
    makeDb(pendingBooking('ORDER-TB-2'))

    const response = await deliver(denial('WH-D1', 'tb-2', 'ORDER-TB-2'))

    expect(response.status).toBe(200)
    expect(rows('table_bookings')[0]).toMatchObject({ paypal_deposit_order_id: null, status: 'pending_payment', payment_status: 'pending' })
    expect(rows('audit_logs')).toEqual([
      expect.objectContaining({ operation_type: 'payment.capture_denied', resource_id: 'tb-2', additional_info: expect.objectContaining({ cleared: true, order_id: 'ORDER-TB-2' }) }),
    ])
    expectNoCustomerMessage()
  })

  it('never clears a replacement order', async () => {
    makeDb(pendingBooking('ORDER-NEW'))

    await deliver(denial('WH-D2', 'tb-2', 'ORDER-OLD'))

    expect(rows('table_bookings')[0].paypal_deposit_order_id).toBe('ORDER-NEW')
    expect(rows('audit_logs')[0].additional_info).toMatchObject({ cleared: false })
  })

  it('leaves a denial that names no order for a person', async () => {
    makeDb(pendingBooking('ORDER-TB-2'))

    const response = await deliver(denial('WH-D3', 'tb-2', null))

    expect(response.status).toBe(200)
    expect(rows('table_bookings')[0].paypal_deposit_order_id).toBe('ORDER-TB-2')
    expect(rows('audit_logs')).toEqual([expect.objectContaining({ operation_type: 'payment.capture_denied_unresolved', operation_status: 'failure' })])
  })

  it('answers 500 when the denial cannot be audited', async () => {
    makeDb(pendingBooking('ORDER-TB-2'))
    db.failures.push({ table: 'audit_logs', op: 'insert', error: { message: 'audit down' } })

    const response = await deliver(denial('WH-D4', 'tb-2', 'ORDER-TB-2'))

    expect(response.status).toBe(500)
    expect(webhookStatuses('WH-D4')).toEqual(['received', 'error'])
  })
})

describe('money on a capture that is not ours', () => {
  it.each([
    ['a refund', refundEvent('WH-U1', { refundId: 'R-U1', captureId: 'CAP-NOBODY', amount: '5.00' })],
    ['a reversal', reversalEvent('WH-U2', { refundId: 'R-U2', captureId: 'CAP-NOBODY', amount: '5.00' })],
  ])('acknowledges %s as unrouted and writes nothing', async (_label, event) => {
    makeDb(eventSeed())

    const response = await deliver(event)

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ received: true, unrouted: true })
    expect(webhookStatuses(event.id)).toEqual(['unrouted'])
    expect(eventRefundRows()).toHaveLength(0)
    expect(rows('payment_refunds')).toHaveLength(0)
    expect(reportPaymentAlert).not.toHaveBeenCalled()
  })
})
