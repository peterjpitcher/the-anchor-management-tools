import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { createFakeSupabase, type FakeSupabase } from '../helpers/fakeSupabase'

/**
 * The bounce fallback for table booking emails (P4 with P3 and P5).
 *
 * The senders run for real against an in-memory database: they mint real tokens, build real short
 * links and write the delivery row through the real notifyCustomer. The fallback then reads that
 * same database. Stood in for: the email and SMS providers, the flags, the audit writer, alerts,
 * the job queue, the short link RPC, the idempotency store and the pre-order order. Runs in the
 * London and the UTC suite.
 */

const state = vi.hoisted(() => ({
  db: null as any,
  flags: {} as Record<string, boolean>,
  shortLinks: 0,
  preorder: { requiresPreorder: true, complete: false },
}))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn(() => state.db) }))
vi.mock('@/lib/messaging/flags', () => ({ isMessagingFlagOn: vi.fn(async (key: string) => state.flags[key] === true) }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
vi.mock('@/lib/cron/alerting', () => ({ reportCronFailure: vi.fn(async () => undefined) }))
vi.mock('@/lib/cron-auth', () => ({ authorizeCronRequest: vi.fn(() => ({ authorized: true })) }))
vi.mock('@/lib/email/emailService', () => ({ sendEmail: vi.fn() }))
vi.mock('@/lib/email/logging', () => ({ isEmailSuppressed: vi.fn(async () => false) }))
vi.mock('@/lib/twilio', () => ({
  sendSMS: vi.fn(),
  sendWhatsApp: vi.fn(),
  isCustomerSmsSendAllowed: vi.fn(async () => ({ allowed: true })),
  isCustomerWhatsAppSendAllowed: vi.fn(async () => ({ allowed: false })),
}))
vi.mock('@/services/audit', () => ({ AuditService: { logAuditEvent: vi.fn(async () => undefined) } }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn(async () => undefined) }))
vi.mock('@/lib/unified-job-queue', () => ({ jobQueue: { enqueue: vi.fn(async () => ({ success: true, jobId: 'job-1' })) } }))
vi.mock('@/lib/api/idempotency', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/idempotency')>()
  return {
    ...actual,
    claimIdempotencyKey: vi.fn(async () => ({ state: 'claimed' })),
    persistIdempotencyResponse: vi.fn(async () => undefined),
    releaseIdempotencyClaim: vi.fn(async () => undefined),
  }
})
// The short link row as the create_short_link RPC writes it, in the database the fallback reads.
vi.mock('@/services/short-links', () => ({
  ShortLinkService: {
    createShortLinkInternal: vi.fn(async (input: { destination_url: string; link_type: string; metadata?: Record<string, unknown> }) => {
      const { buildShortLinkUrl } = await import('@/lib/short-links/base-url')
      state.shortLinks += 1
      const shortCode = `sl${state.shortLinks}`
      await state.db.from('short_links').insert({
        short_code: shortCode,
        destination_url: input.destination_url,
        link_type: input.link_type,
        metadata: input.metadata ?? {},
        expires_at: null,
      })
      return { short_code: shortCode, full_url: buildShortLinkUrl(shortCode), already_exists: false }
    }),
  },
}))
vi.mock('@/lib/table-bookings/preorder', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/table-bookings/preorder')>()
  return {
    PREORDER_BOOKER_REMINDER_DAYS: 10,
    isPreorderEnabled: vi.fn(async () => true),
    decidePreorderChases: vi.fn(() => ['booker_reminder']),
    describePreorderGaps: vi.fn(() => '2 main courses'),
    loadPreorderOrder: vi.fn(async (_db: unknown, tableBookingId: string) => ({
      tableBookingId,
      bookingDate: '2026-10-24',
      preorderCutoffDays: 3,
      requiresPreorder: state.preorder.requiresPreorder,
      partySize: 4,
      covers: [],
    })),
    getPreorderCompleteness: vi.fn(() => ({ complete: state.preorder.complete })),
    // The real cut-off: noon London three days before, 21 October 2026 11:00 UTC for these bookings.
    getPreorderCutoff: actual.getPreorderCutoff,
  }
})

import { sendEmail } from '@/lib/email/emailService'
import { sendSMS } from '@/lib/twilio'
import { AuditService } from '@/services/audit'
import { ShortLinkService } from '@/services/short-links'
import { reportCronFailure } from '@/lib/cron/alerting'
import { hashGuestToken } from '@/lib/guest/tokens'
import { buildShortLinkUrl } from '@/lib/short-links/base-url'
import { getIsoWeekday } from '@/lib/dateUtils'
import {
  sendTableBookingCancelledSmsIfAllowed,
  sendTableBookingConfirmedAfterDepositSmsIfAllowed,
  type TableBookingCancellationRefundResult,
} from '@/lib/table-bookings/bookings'
import { applyPartySizeDepositTransition } from '@/lib/table-bookings/staff-deposit-transitions'
import { GET as sweepConfirmReminders } from '@/app/api/cron/table-booking-confirm/route'
import { GET as sweepPreorderReminders } from '@/app/api/cron/preorder-reminders/route'
import { tableBookingFallbackRenderer } from '@/lib/table-bookings/fallback-renderer'
import { DELAYED_FALLBACK_RENDERERS, findDelayedFallbackRenderer } from '@/lib/notifications/delayed-fallback/renderers'
import {
  buildTableBookingDeliveryMetadata,
  cancellationFacts,
  confirmReminderFacts,
  depositConfirmedFacts,
  partySizeDepositRequestFacts,
  preorderReminderFacts,
  TABLE_BOOKING_FALLBACK_TEMPLATE_KEYS,
  type TableBookingFallbackLink,
  type TableBookingFallbackMessage,
} from '@/lib/table-bookings/fallback-details'
import { enqueueDelayedFallbackForEmailEvent } from '@/lib/notifications/delayed-fallback/enqueue'
import { evaluateFallbackSkip, runDelayedFallbackJob } from '@/lib/notifications/delayed-fallback/run'
import type { DelayedFallbackRender, FallbackBookingFacts } from '@/lib/notifications/delayed-fallback/types'
import { assertCleanText } from '../mocks/emailRenderChecks'

const mockedSendEmail = sendEmail as unknown as Mock
const mockedSendSMS = sendSMS as unknown as Mock

/** Tuesday 20 October 2026, before every booking below. */
const NOW_ISO = '2026-10-20T10:00:00.000Z'

/** mobile_number and mobile_e164 differ in format, so a test sees which one each message names. */
const GUEST = {
  id: 'cust-1',
  first_name: 'Sarah',
  last_name: 'Guest',
  mobile_number: '07700900123',
  mobile_e164: '+447700900123',
  email: 'sarah@example.com',
  sms_status: 'active',
  sms_opt_in: true,
  marketing_sms_opt_in: false,
  email_status: 'valid',
  email_deactivated_at: null,
  marketing_email_opt_in: false,
}

function bookingRow(overrides: Record<string, unknown> = {}): Record<string, any> {
  return {
    id: 'tb-1',
    customer_id: 'cust-1',
    booking_reference: 'TB-A1B2',
    status: 'confirmed',
    payment_status: null,
    // Saturday 24 October 2026, 7pm: the last evening of British Summer Time.
    booking_date: '2026-10-24',
    booking_time: '19:00:00',
    start_datetime: '2026-10-24T18:00:00+00:00',
    party_size: 4,
    committed_party_size: null,
    booking_type: 'regular',
    booking_purpose: 'food',
    is_outside_seating: false,
    high_chair_count: 1,
    christmas_course_counts: null,
    deposit_amount: null,
    deposit_amount_locked: null,
    deposit_waived: false,
    hold_expires_at: null,
    guest_confirmed_at: null,
    booking_period_id: null,
    booking_period_name: null,
    booking_period_requires_preorder: false,
    booking_period_answer: null,
    ...overrides,
  }
}

function seedDb(tables: Record<string, any[]>): FakeSupabase {
  state.db = createFakeSupabase({
    notification_deliveries: [],
    notification_attempts: [],
    guest_tokens: [],
    short_links: [],
    email_messages: [],
    ...tables,
  })
  return state.db
}

function lastDelivery(): Record<string, any> {
  const rows = state.db.tables.notification_deliveries
  return rows[rows.length - 1]
}

function onlyTextSent(): { to: string; body: string; options: Record<string, any> } {
  expect(mockedSendSMS).toHaveBeenCalledTimes(1)
  const [to, body, options] = mockedSendSMS.mock.calls[0]
  return { to, body, options }
}

async function rebuild(delivery: Record<string, any> = lastDelivery()): Promise<DelayedFallbackRender> {
  return tableBookingFallbackRenderer.render({ delivery: delivery as any, client: state.db, now: new Date() })
}

function ready(render: DelayedFallbackRender): Extract<DelayedFallbackRender, { kind: 'ready' }> {
  if (render.kind !== 'ready') throw new Error(`Expected a ready render, got unavailable: ${render.reason}`)
  return render
}

const WEEKDAY_PREFIXES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** Every weekday the text names is the weekday of the booking's London date. */
function expectWeekdaysMatch(body: string, isoDate: string): void {
  const expected = getIsoWeekday(isoDate)
  const mentions = [...body.matchAll(/\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/g)]
  expect(mentions.length).toBeGreaterThan(0)
  for (const [word] of mentions) {
    expect(WEEKDAY_PREFIXES.indexOf(word.slice(0, 3)) + 1).toBe(expected)
  }
}

/** No broken values, no banned dashes and never a zero amount. */
function expectCleanText(body: string): void {
  assertCleanText(body)
  expect(body).not.toMatch(/£0(?:\.0+)?(?![\d.])/)
  expect(body).not.toMatch(/GBP 0(?![\d.])/)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(NOW_ISO))
  state.flags = {}
  state.shortLinks = 0
  state.preorder = { requiresPreorder: true, complete: false }
  // The email fails in the same attempt, so each sender texts the guest and the test sees the text.
  mockedSendEmail.mockResolvedValue({ success: false, error: 'Resend 500' })
  mockedSendSMS.mockResolvedValue({ success: true, sid: 'SM-1' })
})

afterEach(() => {
  vi.useRealTimers()
})

// ---------------------------------------------------------------------------
// The rebuilt text is the text the sender sends
// ---------------------------------------------------------------------------

describe('each email-first table booking message is rebuilt as the text its sender sends', () => {
  it('registers one renderer for every template key the table booking senders use', () => {
    for (const templateKey of Object.values(TABLE_BOOKING_FALLBACK_TEMPLATE_KEYS)) {
      expect(findDelayedFallbackRenderer(templateKey)).toBe(tableBookingFallbackRenderer)
    }
    expect(DELAYED_FALLBACK_RENDERERS).toContain(tableBookingFallbackRenderer)
    expect(findDelayedFallbackRenderer('table_booking_created')).toBeNull()
  })

  const REFUND_VARIANTS: Array<[string, TableBookingCancellationRefundResult]> = [
    ['full refund', { refunded: true, amountPence: 16000, tier: 'full' }],
    ['half refund', { refunded: true, amountPence: 8000, tier: 'half' }],
    ['inside three days', { refunded: false, reason: 'zero_tier' }],
    ['refund failed, amount known', { refunded: false, reason: 'refund_failed', depositOwed: true, amountOwedPence: 16000 }],
    ['refund failed, amount unknown', { refunded: false, reason: 'refund_failed', depositOwed: true }],
    ['terms unreadable', { refunded: false, reason: 'terms_unreadable' }],
    ['no deposit', { refunded: false, reason: 'no_deposit' }],
  ]

  it.each(REFUND_VARIANTS)('table_booking_cancelled (%s): the same words, to the same number', async (_label, refundResult) => {
    state.flags = { table_cancelled_email_first: true }
    seedDb({ table_bookings: [bookingRow({ status: 'cancelled' })], customers: [GUEST] })

    await sendTableBookingCancelledSmsIfAllowed(state.db, {
      customerId: 'cust-1',
      bookingReference: 'TB-A1B2',
      bookingDate: '2026-10-24',
      refundResult,
      tableBookingId: 'tb-1',
    })
    const sent = onlyTextSent()
    const delivery = lastDelivery()

    const render = ready(await rebuild(delivery))

    expect(render.sms.body).toBe(sent.body)
    expect(render.sms.to).toBe(sent.to)
    // The cancellation has always named the stored mobile first.
    expect(render.sms.to).toBe('07700900123')
    expect(render.sms.customerId).toBe('cust-1')
    expect(render.sms.metadata).toEqual({ booking_reference: 'TB-A1B2', table_booking_id: 'tb-1' })
    expect(render.expectCancelled).toBe(true)
    expect(render.booking).toMatchObject({ type: 'table_booking', id: 'tb-1', status: 'cancelled', startsAt: '2026-10-24T18:00:00.000Z' })
    expect(evaluateFallbackSkip(render, delivery.metadata.booking_facts, new Date())).toBeNull()
    expectCleanText(render.sms.body)
    expectWeekdaysMatch(render.sms.body, '2026-10-24')
  })

  it('table_booking_deposit_confirmed: the same words and the same short link the email carried', async () => {
    state.flags = { table_deposit_confirmed_email_first: true }
    seedDb({ table_bookings: [bookingRow({ party_size: 16, deposit_amount: 160, deposit_amount_locked: 160 })], customers: [GUEST] })

    await sendTableBookingConfirmedAfterDepositSmsIfAllowed(state.db, 'tb-1')
    const sent = onlyTextSent()
    const shortUrl = buildShortLinkUrl('sl1')
    expect(mockedSendEmail.mock.calls[0][0].text).toContain(shortUrl)
    expect(sent.body).toBe(
      `The Anchor: Sarah! Deposit sorted, your table for 16 people on Sat 24 Oct, 7:00 pm is locked in. See you then! High chair reserved x1. ${shortUrl}`
    )

    const render = ready(await rebuild())

    expect(render.sms.body).toBe(sent.body)
    expect(render.sms.to).toBe(sent.to)
    expect(render.sms.to).toBe('07700900123')
    expect(render.sms.metadata).toEqual({ table_booking_id: 'tb-1' })
    expect(render.expectCancelled).toBe(false)
    expect(render.booking.facts).toEqual({ booking_date: '2026-10-24', booking_time: '19:00', party_size: 16, status: 'confirmed' })
    expect(evaluateFallbackSkip(render, lastDelivery().metadata.booking_facts, new Date())).toBeNull()
  })

  it('table_booking_pending_payment: the same deposit request with the same payment short link', async () => {
    state.flags = { table_party_size_deposit_email_first: true }
    seedDb({ table_bookings: [bookingRow({ party_size: 16 })], customers: [GUEST] })

    await applyPartySizeDepositTransition(state.db, {
      booking: {
        id: 'tb-1',
        customer_id: 'cust-1',
        party_size: 16,
        status: 'confirmed',
        payment_status: null,
        booking_type: 'regular',
        start_datetime: '2026-10-24T18:00:00+00:00',
        deposit_amount: null,
        deposit_amount_locked: null,
        deposit_waived: false,
        booking_period_id: null,
        booking_period_name: null,
      },
      previousPartySize: 4,
      newPartySize: 16,
      sendSms: true,
      appBaseUrl: 'https://management.example.com',
    })
    const sent = onlyTextSent()
    const shortUrl = buildShortLinkUrl('sl1')
    expect(sent.body).toBe(
      `The Anchor: Hi Sarah, your party size has been updated to 16 people. A table deposit of £160.00 (16 x GBP 10) is now required to secure your booking. Pay now: ${shortUrl}`
    )

    const render = ready(await rebuild())

    expect(render.sms.body).toBe(sent.body)
    expect(render.sms.to).toBe(sent.to)
    // The deposit request has always named the E.164 mobile first.
    expect(render.sms.to).toBe('+447700900123')
    expect(render.sms.metadata).toEqual({ trigger: 'party_size_threshold_crossed', table_booking_id: 'tb-1' })
    expect(render.booking.facts).toEqual({
      party_size: 16,
      deposit_amount: 160,
      // The 24-hour hold the request set: 20 October 10:00 UTC plus a day.
      hold_expires_at: '2026-10-21T10:00:00.000Z',
      awaiting_payment: 'yes',
    })
    expect(evaluateFallbackSkip(render, lastDelivery().metadata.booking_facts, new Date())).toBeNull()
  })

  it('table_booking_confirm_reminder: the same question with the same confirm short link', async () => {
    state.flags = { table_confirm_reminder_email_first: true }
    // Friday 23 October 2026, 11:00 BST: the sweep asks everyone booked for tomorrow.
    vi.setSystemTime(new Date('2026-10-23T10:00:00.000Z'))
    seedDb({
      table_bookings: [{ ...bookingRow(), customers: GUEST }],
      customers: [GUEST],
      table_booking_confirm_reminders: [],
    })

    const response = await sweepConfirmReminders(new Request('http://localhost/api/cron/table-booking-confirm') as never)
    expect(await response.json()).toEqual(expect.objectContaining({ sent: 1, failed: 0 }))
    const sent = onlyTextSent()
    const shortUrl = buildShortLinkUrl('sl1')
    expect(sent.body).toBe(`The Anchor: Sarah, your table for 4 is Saturday 24 October at 7pm. Still coming? Tap to confirm or cancel: ${shortUrl}`)

    const render = ready(await rebuild())

    expect(render.sms.body).toBe(sent.body)
    expect(render.sms.to).toBe(sent.to)
    expect(render.sms.to).toBe('+447700900123')
    expect(render.booking.facts).toEqual({
      booking_date: '2026-10-24',
      booking_time: '19:00',
      party_size: 4,
      status: 'confirmed',
      guest_confirmed: 'no',
    })
    expect(evaluateFallbackSkip(render, lastDelivery().metadata.booking_facts, new Date())).toBeNull()
  })

  it('table_booking_preorder_reminder: the same chase with the same manage short link', async () => {
    state.flags = { table_preorder_email_first: true }
    // Saturday 17 October 2026: seven days before the booking.
    vi.setSystemTime(new Date('2026-10-17T11:00:00.000Z'))
    seedDb({
      table_bookings: [
        bookingRow({
          booking_period_id: 'period-xmas',
          booking_period_name: 'Christmas 2026',
          booking_period_requires_preorder: true,
          booking_period_answer: true,
        }),
      ],
      customers: [GUEST],
      booking_periods: [{ id: 'period-xmas', preorder_cutoff_days: 3 }],
      booking_preorder_reminders: [],
    })

    const response = await sweepPreorderReminders(new Request('http://localhost/api/cron/preorder-reminders') as never)
    expect((await response.json()).result).toEqual(expect.objectContaining({ bookerReminders: 1, failed: 0 }))
    const sent = onlyTextSent()
    const shortUrl = buildShortLinkUrl('sl1')
    expect(sent.body).toBe(
      `The Anchor: Sarah, we still need the food choices for your booking on Saturday 24 October at 7pm. Every guest needs a main course. Choose here: ${shortUrl}`
    )

    const render = ready(await rebuild())

    expect(render.sms.body).toBe(sent.body)
    expect(render.sms.to).toBe(sent.to)
    expect(render.sms.to).toBe('+447700900123')
    expect(render.booking.facts).toEqual({ booking_date: '2026-10-24', booking_time: '19:00', choices_outstanding: 'yes' })
    expect(evaluateFallbackSkip(render, lastDelivery().metadata.booking_facts, new Date())).toBeNull()
  })

  it('records ids and facts on the delivery row, and never a name, number, address, body, link or token', async () => {
    state.flags = { table_party_size_deposit_email_first: true }
    seedDb({ table_bookings: [bookingRow({ party_size: 16 })], customers: [GUEST] })

    await applyPartySizeDepositTransition(state.db, {
      booking: { ...bookingRow({ party_size: 16 }) } as never,
      previousPartySize: 4,
      newPartySize: 16,
      sendSms: true,
      appBaseUrl: 'https://management.example.com',
    })
    const sent = onlyTextSent()
    const metadata = lastDelivery().metadata

    expect(Object.keys(metadata).sort()).toEqual(
      ['booking_facts', 'fallback_link', 'fallback_message', 'has_email', 'has_sms', 'has_whatsapp', 'source', 'table_booking_id', 'template_key'].sort()
    )
    expect(metadata).toMatchObject({
      source: 'table_booking_email_first',
      table_booking_id: 'tb-1',
      template_key: 'table_booking_pending_payment',
      fallback_message: 'party_size_deposit_request',
      fallback_link: 'short_link',
    })
    const stored = JSON.stringify(metadata)
    const rawToken = String(state.db.tables.short_links[0].destination_url).split('/g/')[1].split('/')[0]
    for (const secret of ['Sarah', GUEST.mobile_number, GUEST.mobile_e164, GUEST.email, 'http', rawToken, hashGuestToken(rawToken), sent.body]) {
      expect(stored).not.toContain(secret)
    }
  })
})

// ---------------------------------------------------------------------------
// Rebuilt from fixture bookings, either side of the clock change
// ---------------------------------------------------------------------------

const RAW_TOKEN = 'raw-token-for-tests'

const LINKS: Partial<Record<TableBookingFallbackMessage, { kind: string; action: string; path: string }>> = {
  deposit_confirmed: { kind: 'table_manage', action: 'manage', path: 'table-manage' },
  party_size_deposit_request: { kind: 'table_payment', action: 'payment', path: 'table-payment' },
  confirm_reminder: { kind: 'booking_confirm', action: 'booking_confirm', path: 'confirm-booking' },
  preorder_reminder: { kind: 'table_manage', action: 'manage', path: 'table-manage' },
}

const CANCELLED_WITH_REFUND: TableBookingCancellationRefundResult = { refunded: true, amountPence: 16000, tier: 'full' }

/** The booking each message is about, and the facts its sender would have stored. */
function scenario(message: TableBookingFallbackMessage, overrides: Record<string, unknown> = {}) {
  const base: Record<TableBookingFallbackMessage, Record<string, unknown>> = {
    cancellation: { status: 'cancelled' },
    deposit_confirmed: { party_size: 16, deposit_amount: 160, deposit_amount_locked: 160 },
    party_size_deposit_request: {
      party_size: 16,
      status: 'pending_payment',
      payment_status: 'pending',
      deposit_amount: 160,
      hold_expires_at: '2026-10-21T10:00:00+00:00',
    },
    confirm_reminder: {},
    preorder_reminder: {},
  }
  const booking = bookingRow({ ...base[message], ...overrides })
  const facts: Record<TableBookingFallbackMessage, () => FallbackBookingFacts> = {
    cancellation: () => cancellationFacts({ bookingDate: booking.booking_date, refundResult: CANCELLED_WITH_REFUND }),
    deposit_confirmed: () => depositConfirmedFacts(booking as never),
    party_size_deposit_request: () =>
      partySizeDepositRequestFacts({ partySize: 16, depositAmount: 160, holdExpiresAt: booking.hold_expires_at, awaitingPayment: true }),
    confirm_reminder: () => confirmReminderFacts(booking as never),
    preorder_reminder: () =>
      preorderReminderFacts({ bookingDate: booking.booking_date, bookingTime: booking.booking_time, choicesOutstanding: true }),
  }
  return { booking, facts: facts[message]() }
}

/**
 * A delivery row as notifyTableBookingGuestEmailFirst writes it, with the booking, the guest and
 * the short link and token the email's link was made from.
 */
function seedDelivery(input: {
  message: TableBookingFallbackMessage
  booking: Record<string, any>
  facts: FallbackBookingFacts | null
  link?: TableBookingFallbackLink
  customers?: Array<Record<string, unknown>>
  token?: Record<string, unknown> | null
  shortLink?: Record<string, unknown> | null
  delivery?: Record<string, unknown>
  metadata?: Record<string, unknown>
}): FakeSupabase {
  const templateKey = TABLE_BOOKING_FALLBACK_TEMPLATE_KEYS[input.message]
  const linkSpec = LINKS[input.message]
  const recorded = buildTableBookingDeliveryMetadata({
    tableBookingId: input.booking.id,
    templateKey,
    fallback: {
      message: input.message,
      facts: input.facts ?? {},
      ...(linkSpec ? { link: input.link ?? 'short_link' } : {}),
    },
  })
  if (input.facts === null) delete recorded.booking_facts

  return seedDb({
    table_bookings: [input.booking],
    customers: input.customers ?? [GUEST],
    guest_tokens:
      linkSpec && input.token !== null
        ? [
            {
              id: 'guest-token-1',
              hashed_token: hashGuestToken(RAW_TOKEN),
              customer_id: 'cust-1',
              table_booking_id: input.booking.id,
              action_type: linkSpec.action,
              expires_at: '2026-11-30T00:00:00+00:00',
              consumed_at: null,
              ...input.token,
            },
          ]
        : [],
    short_links:
      linkSpec && input.shortLink !== null
        ? [
            {
              id: 'short-link-1',
              short_code: 'abc123',
              destination_url: `https://example.com/g/${RAW_TOKEN}/${linkSpec.path}`,
              link_type: 'custom',
              expires_at: null,
              created_at: '2026-10-19T09:00:00.000Z',
              metadata: {
                source: 'guest_link_builder',
                guest_link_kind: linkSpec.kind,
                guest_token_hash: hashGuestToken(RAW_TOKEN),
                customer_id: 'cust-1',
                event_booking_id: null,
                table_booking_id: input.booking.id,
              },
              ...input.shortLink,
            },
          ]
        : [],
    notification_deliveries: [
      {
        id: 'delivery-1',
        customer_id: 'cust-1',
        template_key: templateKey,
        policy: 'email_first',
        category: 'transactional',
        urgency: 'standard',
        selected_channel: 'email',
        final_status: 'sent',
        delayed_fallback_allowed: true,
        delayed_fallback_sent_at: null,
        created_at: '2026-10-19T09:00:01.000Z',
        metadata: { ...recorded, ...input.metadata, has_email: true, has_whatsapp: false, has_sms: true },
        ...input.delivery,
      },
    ],
    notification_attempts: [
      { id: 'attempt-1', delivery_id: 'delivery-1', channel: 'email', attempt_order: 1, status: 'sent', resend_message_id: 're_1' },
    ],
  })
}

function seedScenario(message: TableBookingFallbackMessage, options: Omit<Parameters<typeof seedDelivery>[0], 'message' | 'booking' | 'facts'> & { booking?: Record<string, unknown> } = {}) {
  const { booking, facts } = scenario(message, options.booking)
  return seedDelivery({ ...options, message, booking, facts })
}

const ALL_MESSAGES: TableBookingFallbackMessage[] = [
  'cancellation',
  'deposit_confirmed',
  'party_size_deposit_request',
  'confirm_reminder',
  'preorder_reminder',
]
const LINKED_MESSAGES = ALL_MESSAGES.filter((message) => LINKS[message])

describe('rebuilt texts from fixture bookings, either side of the 25 October 2026 clock change', () => {
  const FIXTURES = [
    {
      label: 'Saturday 24 October, the last evening of British Summer Time',
      booking: { booking_date: '2026-10-24', booking_time: '19:00:00', start_datetime: '2026-10-24T18:00:00+00:00' },
      startsAt: '2026-10-24T18:00:00.000Z',
      long: 'Saturday 24 October at 7pm',
      short: 'Sat 24 Oct, 7:00 pm',
      date: '24 Oct 2026',
    },
    {
      label: 'Monday 26 October, the first week of Greenwich Mean Time',
      booking: { booking_date: '2026-10-26', booking_time: '19:00:00', start_datetime: '2026-10-26T19:00:00+00:00' },
      startsAt: '2026-10-26T19:00:00.000Z',
      long: 'Monday 26 October at 7pm',
      short: 'Mon 26 Oct, 7:00 pm',
      date: '26 Oct 2026',
    },
  ]

  for (const fixture of FIXTURES) {
    describe(fixture.label, () => {
      it.each(ALL_MESSAGES)('%s: no broken values, the right weekday, the right start', async (message) => {
        seedScenario(message, { booking: fixture.booking })

        const render = ready(await rebuild())
        const body = render.sms.body

        expectCleanText(body)
        expect(render.booking.startsAt).toBe(fixture.startsAt)
        if (message === 'party_size_deposit_request') {
          // The request names no date; it states the money and the link.
          expect(body).toContain('£160.00 (16 x GBP 10)')
        } else {
          expectWeekdaysMatch(body, fixture.booking.booking_date)
        }
        if (message === 'cancellation') expect(body).toContain(fixture.date)
        if (message === 'deposit_confirmed') expect(body).toContain(fixture.short)
        if (message === 'confirm_reminder' || message === 'preorder_reminder') expect(body).toContain(fixture.long)
        if (LINKS[message]) expect(body).toContain(buildShortLinkUrl('abc123'))
      })
    })
  }

  it('a Christmas deposit and an outside Christmas booking state their own words, still with no broken values', async () => {
    seedScenario('party_size_deposit_request', { booking: { booking_type: 'christmas', deposit_amount: 150 } })
    // The stored facts said 160, so the fallback would skip this one; the words are still checked.
    const christmas = ready(await rebuild())
    expectCleanText(christmas.sms.body)
    expect(christmas.sms.body).toContain('A Christmas deposit of £150.00 is now required')

    seedScenario('deposit_confirmed', { booking: { is_outside_seating: true, high_chair_count: 0, christmas_course_counts: [3, 3, 1] } })
    const outside = ready(await rebuild())
    expectCleanText(outside.sms.body)
    expect(outside.sms.body).toContain('your outside booking for 16 people')
    expect(outside.sms.body).toContain('Outside seating (weather permitting).')
    expect(outside.sms.body).toContain('Christmas courses: 1 x 1 course, 2 x 3 courses. One course needs no pre-order.')
  })
})

// ---------------------------------------------------------------------------
// Links are found, never made
// ---------------------------------------------------------------------------

describe('links are found, never made', () => {
  it.each(LINKED_MESSAGES)('%s: reading the link writes nothing and creates no token or short link', async (message) => {
    seedScenario(message)
    const before = JSON.stringify(state.db.tables)

    ready(await rebuild())

    expect(JSON.stringify(state.db.tables)).toBe(before)
    expect(ShortLinkService.createShortLinkInternal).not.toHaveBeenCalled()
  })

  it.each(LINKED_MESSAGES)('%s: no short link for the booking: link_not_found', async (message) => {
    seedScenario(message, { shortLink: null })
    expect(await rebuild()).toMatchObject({ kind: 'unavailable', reason: 'link_not_found', booking: { type: 'table_booking', id: 'tb-1' } })
  })

  it.each(LINKED_MESSAGES)('%s: a short link made after the email is not the one it carried: link_not_found', async (message) => {
    seedScenario(message, { shortLink: { created_at: '2026-10-19T09:30:00.000Z' } })
    expect(await rebuild()).toMatchObject({ kind: 'unavailable', reason: 'link_not_found' })
  })

  it.each(LINKED_MESSAGES)('%s: a token that has expired: link_expired', async (message) => {
    seedScenario(message, { token: { expires_at: '2026-10-20T09:59:00+00:00' } })
    expect(await rebuild()).toMatchObject({ kind: 'unavailable', reason: 'link_expired' })
  })

  // Paying through the payment link, or answering through the confirm link, is the whole point of
  // those messages. A manage link does several things, so a used one only means it no longer works.
  const DONE_WHEN_USED: TableBookingFallbackMessage[] = ['party_size_deposit_request', 'confirm_reminder']

  it.each(DONE_WHEN_USED)('%s: a token that has been used is the answer the message asked for: no_longer_needed', async (message) => {
    seedScenario(message, { token: { consumed_at: '2026-10-19T12:00:00+00:00' } })
    expect(await rebuild()).toEqual({ kind: 'no_longer_needed', booking: { type: 'table_booking', id: 'tb-1' } })
  })

  it.each(LINKED_MESSAGES.filter((message) => !DONE_WHEN_USED.includes(message)))(
    '%s: a manage token that has been used: link_expired',
    async (message) => {
      seedScenario(message, { token: { consumed_at: '2026-10-19T12:00:00+00:00' } })
      expect(await rebuild()).toMatchObject({ kind: 'unavailable', reason: 'link_expired' })
    }
  )

  it.each(LINKED_MESSAGES)('%s: a token for another guest or another kind of link: link_not_found', async (message) => {
    seedScenario(message, { token: { customer_id: 'someone-else' } })
    expect(await rebuild()).toMatchObject({ kind: 'unavailable', reason: 'link_not_found' })

    seedScenario(message, { token: { action_type: 'review_redirect' } })
    expect(await rebuild()).toMatchObject({ kind: 'unavailable', reason: 'link_not_found' })

    seedScenario(message, { token: null })
    expect(await rebuild()).toMatchObject({ kind: 'unavailable', reason: 'link_not_found' })
  })

  it.each(LINKED_MESSAGES)('%s: the email carried a full-length link, whose token is never stored: link_not_rebuildable', async (message) => {
    seedScenario(message, { link: 'full_url' })
    expect(await rebuild()).toMatchObject({ kind: 'unavailable', reason: 'link_not_rebuildable' })
  })

  it('a deposit confirmation that went without a manage link is rebuilt without one', async () => {
    seedScenario('deposit_confirmed', { link: 'none', shortLink: null, token: null })

    const render = ready(await rebuild())

    expect(render.sms.body).toBe(
      'The Anchor: Sarah! Deposit sorted, your table for 16 people on Sat 24 Oct, 7:00 pm is locked in. See you then! High chair reserved x1.'
    )
  })

  it('a message that must carry a link never goes without one', async () => {
    seedScenario('confirm_reminder', { link: 'none' })
    expect(await rebuild()).toMatchObject({ kind: 'unavailable', reason: 'link_not_found' })
  })

  it('every link reason reads as a plain sentence for staff', async () => {
    seedScenario('party_size_deposit_request', { shortLink: null })
    state.flags = { bounce_sms_fallback: true }

    const outcome = await runDelayedFallbackJob({ deliveryId: 'delivery-1' }, { now: () => new Date() })

    expect(outcome).toEqual({ outcome: 'failed', reason: 'link_not_found', deliveryId: 'delivery-1' })
    expect(mockedSendSMS).not.toHaveBeenCalled()
    expect(state.db.tables.notification_deliveries[0]).toMatchObject({
      final_status: 'failed',
      metadata: expect.objectContaining({ undelivered_reason: 'link_not_found' }),
    })
    expect(AuditService.logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        operation_type: 'table_booking.notification_failed',
        resource_type: 'table_booking',
        resource_id: 'tb-1',
        error_message:
          'The email bounced and the text fallback failed: the link in the email could not be found again, and a new one is never made for a text.',
      })
    )
    expect(reportCronFailure).toHaveBeenCalledTimes(1)

    const { loadUndeliveredGuestMessages } = await import('@/lib/notifications/undelivered')
    const listed = await loadUndeliveredGuestMessages({ sinceIso: '2000-01-01T00:00:00.000Z' })
    expect(listed.rows[0]).toMatchObject({ reason: 'Email bounced; the link could not be found again', booking: { href: '/table-bookings/tb-1' } })
  })
})

// ---------------------------------------------------------------------------
// When the text cannot be rebuilt at all
// ---------------------------------------------------------------------------

describe('unavailable', () => {
  it.each(ALL_MESSAGES)('%s: the booking has gone: booking_missing', async (message) => {
    const { booking, facts } = scenario(message)
    seedDelivery({ message, booking, facts })
    state.db.tables.table_bookings = []

    expect(await rebuild()).toEqual({ kind: 'unavailable', reason: 'booking_missing', booking: { type: 'table_booking', id: 'tb-1' } })
  })

  it.each(ALL_MESSAGES)('%s: the customer record has gone: customer_missing', async (message) => {
    seedScenario(message, { customers: [] })
    expect(await rebuild()).toMatchObject({ kind: 'unavailable', reason: 'customer_missing' })
  })

  it.each(ALL_MESSAGES)('%s: the delivery carries no facts: facts_missing', async (message) => {
    const { booking } = scenario(message)
    seedDelivery({ message, booking, facts: null })
    expect(await rebuild()).toMatchObject({ kind: 'unavailable', reason: 'facts_missing' })
  })

  it('a cancellation whose refund outcome was not recorded is never guessed: facts_missing', async () => {
    const { booking } = scenario('cancellation')
    seedDelivery({ message: 'cancellation', booking, facts: { booking_date: '2026-10-24' } })
    expect(await rebuild()).toMatchObject({ kind: 'unavailable', reason: 'facts_missing' })
  })

  it('a deposit request is never rebuilt for a cleared deposit, which the job skips as no longer needed', async () => {
    seedScenario('party_size_deposit_request', { booking: { deposit_amount: null, status: 'confirmed', payment_status: null } })

    expect(await rebuild()).toEqual({ kind: 'no_longer_needed', booking: { type: 'table_booking', id: 'tb-1' } })

    state.flags = { bounce_sms_fallback: true }
    const outcome = await runDelayedFallbackJob({ deliveryId: 'delivery-1' }, { now: () => new Date() })
    expect(outcome).toMatchObject({ outcome: 'skipped', reason: 'no_longer_needed' })
    expect(mockedSendSMS).not.toHaveBeenCalled()
    expect(reportCronFailure).not.toHaveBeenCalled()
  })

  it('a delivery without a table booking id: booking_missing, with no booking to name', async () => {
    seedScenario('confirm_reminder', { metadata: { table_booking_id: undefined } })
    expect(await rebuild()).toEqual({ kind: 'unavailable', reason: 'booking_missing', booking: null })
  })

  it('a message recorded under another template key is never answered with this text: no_renderer', async () => {
    seedScenario('deposit_confirmed', { delivery: { template_key: 'table_booking_pending_payment' } })
    expect(await rebuild()).toMatchObject({ kind: 'unavailable', reason: 'no_renderer' })
  })
})

// ---------------------------------------------------------------------------
// The same rules as private bookings
// ---------------------------------------------------------------------------

describe('held to the same rules as private bookings', () => {
  beforeEach(() => {
    state.flags = { bounce_sms_fallback: true }
  })

  async function runJob() {
    return runDelayedFallbackJob({ deliveryId: 'delivery-1' }, { now: () => new Date() })
  }

  it.each(ALL_MESSAGES)('%s: sends the rebuilt text through sendSMS while it is still true', async (message) => {
    seedScenario(message)

    const outcome = await runJob()

    expect(outcome).toMatchObject({ outcome: 'sent', deliveryId: 'delivery-1' })
    const { options } = onlyTextSent()
    expect(options).toEqual(
      expect.objectContaining({
        customerId: 'cust-1',
        createCustomerIfMissing: false,
        metadata: expect.objectContaining({
          table_booking_id: 'tb-1',
          template_key: TABLE_BOOKING_FALLBACK_TEMPLATE_KEYS[message],
          source: 'email_bounce_fallback',
          delayed_fallback_delivery_id: 'delivery-1',
        }),
      })
    )
    expect(state.db.tables.notification_deliveries[0]).toMatchObject({ final_status: 'fallback_sent', selected_channel: 'sms' })
  })

  it.each([
    ['cancellation', { booking_date: '2026-10-31', booking_time: '19:00:00' }],
    ['deposit_confirmed', { party_size: 18 }],
    ['deposit_confirmed', { booking_time: '20:00:00' }],
    ['party_size_deposit_request', { deposit_amount: 180 }],
    ['party_size_deposit_request', { hold_expires_at: '2026-10-22T10:00:00+00:00' }],
    ['confirm_reminder', { party_size: 6 }],
    ['preorder_reminder', { booking_date: '2026-10-25' }],
  ] as Array<[TableBookingFallbackMessage, Record<string, unknown>]>)(
    '%s: a stated fact changed since the email (%o): booking_changed',
    async (message, change) => {
      const { booking, facts } = scenario(message)
      seedDelivery({ message, booking: { ...booking, ...change }, facts })

      expect(await runJob()).toMatchObject({ outcome: 'skipped', reason: 'booking_changed' })
      expect(mockedSendSMS).not.toHaveBeenCalled()
      expect(reportCronFailure).not.toHaveBeenCalled()
    }
  )

  it.each([
    ['party_size_deposit_request', 'paid since the email', { booking: { status: 'confirmed', payment_status: 'completed' } }],
    [
      'party_size_deposit_request',
      'paid through the link, so its token is used',
      { booking: { status: 'confirmed', payment_status: 'completed' }, token: { consumed_at: '2026-10-20T09:30:00+00:00' } },
    ],
    ['confirm_reminder', 'the guest has answered since', { booking: { guest_confirmed_at: '2026-10-20T09:00:00+00:00' } }],
  ] as Array<[TableBookingFallbackMessage, string, Parameters<typeof seedScenario>[1]]>)(
    '%s: %s: skipped as no longer needed, never failed',
    async (message, _label, options) => {
      seedScenario(message, options)

      expect(await runJob()).toEqual({ outcome: 'skipped', reason: 'no_longer_needed', deliveryId: 'delivery-1' })
      expect(mockedSendSMS).not.toHaveBeenCalled()
      expect(reportCronFailure).not.toHaveBeenCalled()
      expect(state.db.tables.notification_deliveries[0]).toMatchObject({
        final_status: 'bounced',
        metadata: expect.objectContaining({ delayed_fallback: expect.objectContaining({ outcome: 'skipped', reason: 'no_longer_needed' }) }),
      })
      expect(AuditService.logAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          operation_type: 'notification.bounce_fallback_skipped',
          resource_id: 'tb-1',
          additional_info: expect.objectContaining({
            description: 'The email bounced. No text was sent because what it asked for has been done since, so it no longer applies.',
          }),
        })
      )
    }
  )

  it('preorder_reminder: the food choices have come in since the email: no_longer_needed', async () => {
    seedScenario('preorder_reminder')
    state.preorder.complete = true
    expect(await runJob()).toMatchObject({ outcome: 'skipped', reason: 'no_longer_needed' })
    expect(mockedSendSMS).not.toHaveBeenCalled()
    expect(reportCronFailure).not.toHaveBeenCalled()
  })

  it('preorder_reminder: the booking no longer needs a pre-order: no_longer_needed', async () => {
    seedScenario('preorder_reminder')
    state.preorder.requiresPreorder = false
    expect(await runJob()).toMatchObject({ outcome: 'skipped', reason: 'no_longer_needed' })
  })

  it('preorder_reminder: the form locks at noon three days before, so a text after that is too late', async () => {
    seedScenario('preorder_reminder')
    // Wednesday 21 October 2026, 12:00 BST: the cut-off itself.
    vi.setSystemTime(new Date('2026-10-21T11:00:00.000Z'))

    expect(await runJob()).toMatchObject({ outcome: 'skipped', reason: 'too_late' })
    expect(mockedSendSMS).not.toHaveBeenCalled()
    expect(reportCronFailure).not.toHaveBeenCalled()
  })

  it('preorder_reminder: a minute before the form locks the text still goes', async () => {
    seedScenario('preorder_reminder')
    vi.setSystemTime(new Date('2026-10-21T10:59:00.000Z'))
    expect(await runJob()).toMatchObject({ outcome: 'sent' })
  })

  it('party_size_deposit_request: once the payment link has run out, "Pay now" is too late, even with the link gone', async () => {
    // The hold, and with it the payment link, ran out at 10:00 UTC on 21 October.
    seedScenario('party_size_deposit_request', { token: { expires_at: '2026-10-21T10:00:00+00:00' } })
    vi.setSystemTime(new Date('2026-10-21T10:00:00.000Z'))

    expect(await runJob()).toMatchObject({ outcome: 'skipped', reason: 'too_late' })
    expect(mockedSendSMS).not.toHaveBeenCalled()
    expect(reportCronFailure).not.toHaveBeenCalled()
  })

  it('party_size_deposit_request: the rebuilt text carries the payment link expiry', async () => {
    seedScenario('party_size_deposit_request')
    expect(ready(await rebuild()).validUntil).toBe('2026-10-21T10:00:00.000Z')
  })

  it('confirm_reminder: the text names the day and never says "tomorrow", so it holds until the booking starts', async () => {
    seedScenario('confirm_reminder')
    const render = ready(await rebuild())
    // If this wording ever says tomorrow, validUntil must become the start of the booking's London day.
    expect(render.sms.body).not.toMatch(/tomorrow/i)
    expect(render.validUntil).toBe('2026-10-24T18:00:00.000Z')
  })

  it.each(ALL_MESSAGES.filter((message) => message !== 'cancellation'))(
    '%s on a booking cancelled since: skipped',
    async (message) => {
      seedScenario(message, { booking: { status: 'cancelled' } })

      expect(await runJob()).toMatchObject({ outcome: 'skipped', reason: 'booking_cancelled' })
      expect(mockedSendSMS).not.toHaveBeenCalled()
      expect(state.db.tables.notification_deliveries[0].final_status).toBe('bounced')
      expect(AuditService.logAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({ operation_type: 'notification.bounce_fallback_skipped', resource_type: 'table_booking', resource_id: 'tb-1' })
      )
    }
  )

  it('cancellation on a booking reinstated since: skipped', async () => {
    seedScenario('cancellation', { booking: { status: 'confirmed' } })

    expect(await runJob()).toMatchObject({ outcome: 'skipped', reason: 'booking_no_longer_cancelled' })
    expect(mockedSendSMS).not.toHaveBeenCalled()
  })

  it('confirm_reminder once the sitting has started: skipped', async () => {
    seedScenario('confirm_reminder')
    vi.setSystemTime(new Date('2026-10-24T18:30:00.000Z'))

    expect(await runJob()).toMatchObject({ outcome: 'skipped', reason: 'booking_past' })
    expect(mockedSendSMS).not.toHaveBeenCalled()
  })

  it('a guest with no mobile: undelivered, and staff are told', async () => {
    seedScenario('deposit_confirmed', { customers: [{ ...GUEST, mobile_number: null, mobile_e164: null }] })

    expect(await runJob()).toMatchObject({ outcome: 'failed', reason: 'no_sms_channel' })
    expect(mockedSendSMS).not.toHaveBeenCalled()
    expect(reportCronFailure).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// End to end
// ---------------------------------------------------------------------------

describe('end to end: a bounced deposit request becomes the text it replaced', () => {
  it('sends the email, takes the bounce, and texts the same words with the same link, once', async () => {
    state.flags = { table_party_size_deposit_email_first: true, bounce_sms_fallback: true }
    seedDb({ table_bookings: [bookingRow({ party_size: 16 })], customers: [GUEST] })
    mockedSendEmail.mockResolvedValue({ success: true, messageId: 're_bounce_1' })

    const transition = await applyPartySizeDepositTransition(state.db, {
      booking: bookingRow({ party_size: 16 }) as never,
      previousPartySize: 4,
      newPartySize: 16,
      sendSms: true,
      appBaseUrl: 'https://management.example.com',
    })
    expect(transition).toMatchObject({ state: 'deposit_required', notification: { status: 'sent', channel: 'email' } })
    expect(mockedSendSMS).not.toHaveBeenCalled()
    const shortUrl = buildShortLinkUrl('sl1')
    expect(mockedSendEmail.mock.calls[0][0].text).toContain(`Pay your deposit: ${shortUrl}`)
    const tokensAfterEmail = state.db.tables.guest_tokens.length
    const linksAfterEmail = state.db.tables.short_links.length

    const queued = await enqueueDelayedFallbackForEmailEvent({ eventType: 'email.bounced', resendEmailId: 're_bounce_1' })
    expect(queued).toMatchObject({ enqueued: true, reason: 'queued' })

    const outcome = await runDelayedFallbackJob({ deliveryId: queued.deliveryId }, { now: () => new Date() })
    const again = await runDelayedFallbackJob({ deliveryId: queued.deliveryId }, { now: () => new Date() })

    expect(outcome).toMatchObject({ outcome: 'sent' })
    expect(again).toMatchObject({ outcome: 'skipped', reason: 'already_handled' })
    const { to, body, options } = onlyTextSent()
    expect(to).toBe('+447700900123')
    expect(body).toBe(
      `The Anchor: Hi Sarah, your party size has been updated to 16 people. A table deposit of £160.00 (16 x GBP 10) is now required to secure your booking. Pay now: ${shortUrl}`
    )
    expect(options).toEqual({
      customerId: 'cust-1',
      createCustomerIfMissing: false,
      metadata: {
        trigger: 'party_size_threshold_crossed',
        table_booking_id: 'tb-1',
        template_key: 'table_booking_pending_payment',
        stage: expect.any(String),
        source: 'email_bounce_fallback',
        delayed_fallback_delivery_id: queued.deliveryId,
      },
    })

    const delivery = state.db.tables.notification_deliveries.find((row: Record<string, any>) => row.id === queued.deliveryId)
    expect(delivery).toMatchObject({ final_status: 'fallback_sent', selected_channel: 'sms' })
    expect(state.db.tables.notification_attempts).toContainEqual(
      expect.objectContaining({ delivery_id: queued.deliveryId, channel: 'sms', attempt_order: 2, status: 'sent' })
    )
    expect(AuditService.logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ operation_type: 'notification.bounce_fallback_sent', resource_type: 'table_booking', resource_id: 'tb-1' })
    )
    // The fallback found the link; it made no new token and no new short link.
    expect(state.db.tables.guest_tokens).toHaveLength(tokensAfterEmail)
    expect(state.db.tables.short_links).toHaveLength(linksAfterEmail)
    expect(ShortLinkService.createShortLinkInternal).toHaveBeenCalledTimes(1)
  })
})
