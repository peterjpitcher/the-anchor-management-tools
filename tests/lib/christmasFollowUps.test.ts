import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The one follow-up email to somebody who started a Christmas dinner booking online and did not
 * finish (Christmas funnel spec, owner decisions 5 and 8): who gets it, when, that the claim is
 * written before the send and never released, and that the flag and the kill switch hold it.
 * Run against the in-memory fake database with the real email builder, token, unsubscribe and
 * date helpers; only the sender is a fake.
 */

const { logError, logWarn, logInfo } = vi.hoisted(() => ({ logError: vi.fn(), logWarn: vi.fn(), logInfo: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { error: logError, warn: logWarn, info: logInfo } }))
vi.mock('@/lib/email/emailService', () => ({ sendEmail: vi.fn() }))
vi.mock('@/lib/messaging/flags', () => ({ isMessagingFlagOn: vi.fn() }))

import { CHRISTMAS_PERIOD, leadsDb } from '../helpers/christmasLeadsDb'
import { assertCleanText } from '../mocks/emailRenderChecks'
import { isMessagingFlagOn } from '@/lib/messaging/flags'
import { sendEmail } from '@/lib/email/emailService'
import {
  followUpIdempotencyKey,
  isFollowUpHour,
  runChristmasLeadFollowUps,
} from '@/lib/table-bookings/christmas-follow-ups'
import { optOutLeadByToken, readResumeLink } from '@/lib/table-bookings/christmas-leads'

// 10:00 London on Friday 20 November 2026 (GMT, so 10:00 UTC).
const NOW = new Date('2026-11-20T10:00:00Z')
const YESTERDAY = '2026-11-19T15:00:00.000Z'

type SendArgs = Parameters<typeof sendEmail>[0]

function lead(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    lead_ref: `ref-${id}`,
    source: 'website',
    booking_period_id: CHRISTMAS_PERIOD.id,
    customer_id: null,
    table_booking_id: null,
    first_name: 'Sam',
    last_name: 'Example',
    email: `${id}@example.com`,
    mobile_e164: `+4477009001${id.replace(/\D/g, '').padStart(2, '0').slice(-2)}`,
    booking_date: '2026-12-15',
    booking_time: '12:00:00',
    party_size: 12,
    follow_up_opt_out: false,
    follow_up_claimed_at: null,
    follow_up_sent_at: null,
    follow_up_outcome: null,
    resume_token_hash: null,
    resume_token_expires_at: null,
    opt_out_token_hash: null,
    created_at: YESTERDAY,
    ...overrides,
  }
}

function sender(result: { success: boolean; error?: string; uncertain?: boolean } = { success: true }) {
  return vi.fn(async (_options: SendArgs) => ({ messageId: 're_1', ...result }) as never)
}

async function run(db: ReturnType<typeof leadsDb>, options: { now?: Date; send?: ReturnType<typeof sender>; flagOn?: boolean; suspended?: boolean } = {}) {
  return runChristmasLeadFollowUps({
    db: db.client,
    now: options.now ?? NOW,
    send: (options.send ?? sender()) as never,
    flagOn: async () => options.flagOn ?? true,
    suspended: () => options.suspended ?? false,
  })
}

function sentTo(send: ReturnType<typeof sender>): string[] {
  return send.mock.calls.map(([options]) => String(options.to)).sort()
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('the 10:00 London gate', () => {
  it.each([
    ['10:00 UTC in winter (10:00 GMT)', '2026-11-20T10:00:00Z', true],
    ['09:00 UTC in winter (09:00 GMT)', '2026-11-20T09:00:00Z', false],
    ['09:00 UTC in summer time (10:00 BST)', '2026-07-15T09:00:00Z', true],
    ['10:00 UTC in summer time (11:00 BST)', '2026-07-15T10:00:00Z', false],
  ])('%s is due: %s', async (_label, iso, due) => {
    expect(isFollowUpHour(new Date(iso))).toBe(due)
    const db = leadsDb({ table_booking_leads: [lead('a')] })
    const send = sender()

    const result = await run(db, { now: new Date(iso), send })

    expect(result.state).toBe(due ? 'ran' : 'not_due')
    if (!due) {
      expect(send).not.toHaveBeenCalled()
      expect(db.fake.writes).toEqual([])
    }
  })
})

describe('who gets the follow-up', () => {
  it('emails only the leads that pass every rule, once each', async () => {
    const db = leadsDb({
      table_booking_leads: [
        lead('ok1'),
        lead('today', { created_at: '2026-11-20T08:00:00.000Z' }),
        lead('optout', { follow_up_opt_out: true }),
        lead('linked', { table_booking_id: 'booking-9' }),
        lead('soon', { booking_date: '2026-11-25' }),
        lead('booked'),
        lead('cancelled'),
        lead('dup', { email: 'ok1@example.com', created_at: '2026-11-19T16:00:00.000Z' }),
        lead('lapsed', { source: 'lapsed_hold', table_booking_id: 'booking-8' }),
        lead('claimed', { follow_up_claimed_at: '2026-11-19T10:00:00.000Z' }),
        lead('noname', { first_name: '' }),
      ],
      table_bookings: [
        { id: 'b1', customer_id: null, contact_email: 'booked@example.com', booking_type: 'christmas', status: 'confirmed', booking_date: '2026-12-04' },
        { id: 'b2', customer_id: null, contact_email: 'cancelled@example.com', booking_type: 'christmas', status: 'cancelled', booking_date: '2026-12-04' },
      ],
    })
    const send = sender()

    const result = await run(db, { send })

    expect(sentTo(send)).toEqual(['cancelled@example.com', 'ok1@example.com'])
    expect(result).toEqual(
      expect.objectContaining({
        state: 'ran',
        flag: 'on',
        held: null,
        sent: 2,
        refused: 0,
        uncertain: 0,
        errors: 0,
        skipped: { already_booked: 1, already_followed_up: 1, missing_details: 1 },
      }),
    )
    // Today's lead, the opted out, the linked, the too-soon, the lapsed hold and the claimed one
    // are never even read for sending.
    expect(result.state === 'ran' && result.considered).toBe(5)
  })

  it('skips a lead whose mobile already holds a Christmas booking through the customer record', async () => {
    const db = leadsDb({
      table_booking_leads: [lead('a', { mobile_e164: '+447700900555' })],
      customers: [{ id: 'customer-5', email: 'different@example.com', mobile_e164: '+447700900555' }],
      table_bookings: [{ id: 'b1', customer_id: 'customer-5', contact_email: null, booking_type: 'christmas', status: 'pending_payment', booking_date: '2026-12-01' }],
    })
    const send = sender()

    const result = await run(db, { send })

    expect(send).not.toHaveBeenCalled()
    expect(result.state === 'ran' && result.skipped).toEqual({ already_booked: 1 })
  })

  it('leaves a date the period can no longer take online (inside the 192 hours) for staff', async () => {
    // 28 November at 09:00 is 7 days 23 hours away: past the 8-day date filter, inside the notice.
    const db = leadsDb({ table_booking_leads: [lead('a', { booking_date: '2026-11-28', booking_time: '09:00:00' })] })
    const send = sender()

    const result = await run(db, { send })

    expect(send).not.toHaveBeenCalled()
    expect(result.state === 'ran' && result.skipped).toEqual({ not_bookable_online: 1 })
  })
})

describe('the email that goes', () => {
  it('carries a working resume link, a working opt-out link and the idempotency key, and no raw token reaches the log', async () => {
    const db = leadsDb({ table_booking_leads: [lead('a')] })
    const send = sender()

    await run(db, { send })

    const options = send.mock.calls[0][0]
    expect(options).toEqual(
      expect.objectContaining({
        to: 'a@example.com',
        subject: 'Your Christmas dinner at The Anchor',
        commType: 'christmas_lead_follow_up',
        idempotencyKey: followUpIdempotencyKey('a'),
      }),
    )
    for (const part of [options.subject, options.html ?? '', options.text ?? '']) assertCleanText(part)
    expect(options.text).toContain('You started booking Christmas dinner for 12 on Tuesday 15 December 2026')

    const resumeToken = /#resume=([A-Za-z0-9_-]{43})/.exec(options.text ?? '')?.[1] as string
    const optOutToken = /opt-out\?t=([A-Za-z0-9_-]{43})/.exec(options.text ?? '')?.[1] as string
    expect(options.unsubscribeUrl).toContain(`/api/table-bookings/leads/opt-out?t=${optOutToken}`)
    expect(options.logRedactions).toEqual([resumeToken, optOutToken])

    // The resume link fills the website form in; the opt-out link marks the lead.
    expect(await readResumeLink(db.client, resumeToken, NOW)).toEqual(
      expect.objectContaining({ state: 'ok', data: expect.objectContaining({ first_name: 'Sam', party_size: 12, booking_date: '2026-12-15' }) }),
    )
    expect(await optOutLeadByToken(db.client, optOutToken)).toBe('opted_out')
    expect(db.fake.rows('table_booking_leads')[0].follow_up_opt_out).toBe(true)
  })

  it("uses the customer's own marketing unsubscribe link when the lead matches a customer", async () => {
    const db = leadsDb({ table_booking_leads: [lead('a', { customer_id: 'customer-1' })] })
    const send = sender()

    await run(db, { send })

    const options = send.mock.calls[0][0]
    expect(options.unsubscribeUrl).toMatch(/\/api\/unsubscribe\?t=/)
    expect(options.customerId).toBe('customer-1')
    expect(db.fake.rows('email_unsubscribe_tokens')).toEqual([expect.objectContaining({ customer_id: 'customer-1' })])
  })
})

describe('review fixes of 10 November 2026', () => {
  it('skips a lead whose customer has unsubscribed from our marketing email', async () => {
    const db = leadsDb({
      table_booking_leads: [lead('a', { customer_id: 'customer-1' }), lead('b')],
      customers: [{ id: 'customer-1', email: 'different@example.com', marketing_email_opted_out_at: '2026-10-01T10:00:00Z' }],
    })
    const send = sender()

    const result = await run(db, { send })

    expect(sentTo(send)).toEqual(['b@example.com'])
    expect(result.state === 'ran' && result.skipped).toEqual({ customer_unsubscribed: 1 })
    // Not claimed, so nothing about it changed.
    expect(db.fake.rows('table_booking_leads').find((row) => row.id === 'a')?.follow_up_claimed_at).toBeNull()
  })

  it('skips a lead whose address belongs to an unsubscribed customer, whatever its case', async () => {
    const db = leadsDb({
      table_booking_leads: [lead('a')],
      customers: [{ id: 'customer-2', email: 'A@Example.com', marketing_email_opted_out_at: '2026-10-01T10:00:00Z' }],
    })
    const send = sender()

    const result = await run(db, { send })

    expect(send).not.toHaveBeenCalled()
    expect(result.state === 'ran' && result.skipped).toEqual({ customer_unsubscribed: 1 })
  })

  it('does not email an address a second time in a season after the first lead has been deleted', async () => {
    // The first lead (and its claim) went in the 30-day clear-out; the email log still has it.
    const db = leadsDb({
      table_booking_leads: [lead('a')],
      email_messages: [
        { id: 'em-1', comm_type: 'christmas_lead_follow_up', to_address: 'a@example.com', metadata: { lead_id: 'gone', booking_period_id: CHRISTMAS_PERIOD.id } },
      ],
    })
    const send = sender()

    const result = await run(db, { send })

    expect(send).not.toHaveBeenCalled()
    expect(result.state === 'ran' && result.skipped).toEqual({ already_followed_up: 1 })
  })

  it('still emails an address whose earlier follow-up was for another season', async () => {
    const db = leadsDb({
      table_booking_leads: [lead('a')],
      email_messages: [
        { id: 'em-1', comm_type: 'christmas_lead_follow_up', to_address: 'a@example.com', metadata: { lead_id: 'old', booking_period_id: 'period-xmas-2025' } },
      ],
    })
    const send = sender()

    await run(db, { send })

    expect(sentTo(send)).toEqual(['a@example.com'])
    expect(send.mock.calls[0][0].metadata).toEqual(expect.objectContaining({ booking_period_id: CHRISTMAS_PERIOD.id }))
  })

  it('reads past a full page of skipped leads to reach one that can be emailed', async () => {
    // 150 older leads all skipped (their customer unsubscribed), then one good lead.
    const skipped = Array.from({ length: 150 }, (_, index) =>
      lead(`s${index}`, { customer_id: 'customer-out', created_at: `2026-11-18T10:${String(Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}.000Z` }),
    )
    const db = leadsDb({
      table_booking_leads: [...skipped, lead('good', { created_at: '2026-11-19T15:00:00.000Z' })],
      customers: [{ id: 'customer-out', email: null, marketing_email_opted_out_at: '2026-10-01T10:00:00Z' }],
    })
    const send = sender()

    const result = await run(db, { send })

    expect(sentTo(send)).toEqual(['good@example.com'])
    expect(result.state === 'ran' && result.considered).toBe(151)
    expect(result.state === 'ran' && result.skipped).toEqual({ customer_unsubscribed: 150 })
  })

  it('sends no more than 100 in one run, and the rest wait for the next', async () => {
    const leads = Array.from({ length: 130 }, (_, index) =>
      lead(`l${index}`, { created_at: `2026-11-18T11:${String(Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}.000Z` }),
    )
    const db = leadsDb({ table_booking_leads: leads })
    const send = sender()

    const result = await run(db, { send })

    expect(send).toHaveBeenCalledTimes(100)
    expect(result.state === 'ran' && result.sent).toBe(100)
    expect(db.fake.rows('table_booking_leads').filter((row) => row.follow_up_claimed_at === null)).toHaveLength(30)
  })
})

describe('the claim', () => {
  it('is written before the email goes, and records the outcome after', async () => {
    const db = leadsDb({ table_booking_leads: [lead('a')] })
    const claimedAtSend: unknown[] = []
    const send = vi.fn(async () => {
      claimedAtSend.push(db.fake.rows('table_booking_leads')[0].follow_up_claimed_at)
      return { success: true, messageId: 're_1' } as never
    })

    await run(db, { send: send as never })

    expect(claimedAtSend).toEqual([NOW.toISOString()])
    expect(db.fake.rows('table_booking_leads')[0]).toEqual(
      expect.objectContaining({ follow_up_claimed_at: NOW.toISOString(), follow_up_sent_at: NOW.toISOString(), follow_up_outcome: 'sent' }),
    )
  })

  it('sends nothing for a lead another run claimed first', async () => {
    const db = leadsDb({ table_booking_leads: [lead('a')] })
    db.fake.beforeUpdate((table, matched) => {
      if (table === 'table_booking_leads') for (const row of matched) row.follow_up_claimed_at ??= '2026-11-20T09:59:59.000Z'
    })
    const send = sender()

    const result = await run(db, { send })

    expect(send).not.toHaveBeenCalled()
    expect(result.state === 'ran' && result.skipped).toEqual({ claimed_elsewhere: 1 })
  })

  it('a literal second run sends nothing', async () => {
    const db = leadsDb({ table_booking_leads: [lead('a'), lead('b')] })
    const first = sender()
    const second = sender()

    await run(db, { send: first })
    const again = await run(db, { send: second })

    expect(first).toHaveBeenCalledTimes(2)
    expect(second).not.toHaveBeenCalled()
    expect(again.state === 'ran' && again.considered).toBe(0)
  })

  it.each([
    ['refused', { success: false, error: 'Resend 422: invalid address' }],
    ['uncertain', { success: false, error: 'timed out', uncertain: true }],
  ])('records a %s send and never retries it', async (outcome, result) => {
    const db = leadsDb({ table_booking_leads: [lead('a')] })
    const send = sender(result)

    const first = await run(db, { send })
    const retry = sender()
    await run(db, { send: retry })

    expect(first.state === 'ran' && first[outcome as 'refused' | 'uncertain']).toBe(1)
    expect(db.fake.rows('table_booking_leads')[0]).toEqual(
      expect.objectContaining({ follow_up_outcome: outcome, follow_up_sent_at: null, follow_up_claimed_at: NOW.toISOString() }),
    )
    expect(retry).not.toHaveBeenCalled()
    expect(logError).toHaveBeenCalledWith(
      'Christmas follow-up email did not go; it will not be retried automatically',
      expect.objectContaining({ metadata: expect.objectContaining({ leadId: 'a' }) }),
    )
  })
})

describe('the switches', () => {
  it('sends and claims nothing while the messaging flag is off, but still clears old leads', async () => {
    const db = leadsDb({ table_booking_leads: [lead('a'), lead('old', { booking_date: '2026-10-15' })] })
    const send = sender()

    const result = await run(db, { send, flagOn: false })

    expect(result).toEqual(expect.objectContaining({ state: 'ran', flag: 'off', sent: 0 }))
    expect(send).not.toHaveBeenCalled()
    expect(db.fake.rows('table_booking_leads').map((row) => [row.id, row.follow_up_claimed_at])).toEqual([['a', null]])
  })

  it('reads the real flag christmas_lead_follow_up when no reader is passed', async () => {
    vi.mocked(isMessagingFlagOn).mockResolvedValue(false)
    const db = leadsDb({ table_booking_leads: [lead('a')] })

    await runChristmasLeadFollowUps({ db: db.client, now: NOW, send: sender() as never, suspended: () => false })

    expect(isMessagingFlagOn).toHaveBeenCalledWith('christmas_lead_follow_up')
  })

  it('holds every lead unclaimed while an email kill switch is on', async () => {
    const db = leadsDb({ table_booking_leads: [lead('a')] })
    const send = sender()

    const result = await run(db, { send, suspended: true })

    expect(result).toEqual(expect.objectContaining({ state: 'ran', flag: 'on', held: 'email_suspended', sent: 0 }))
    expect(send).not.toHaveBeenCalled()
    expect(db.fake.rows('table_booking_leads')[0].follow_up_claimed_at).toBeNull()

    // Once the switch is off again, the lead still gets its one email.
    const later = sender()
    await run(db, { send: later })
    expect(later).toHaveBeenCalledTimes(1)
  })

  it('honours SUSPEND_ALL_EMAIL through the real kill switch reader', async () => {
    vi.stubEnv('SUSPEND_ALL_EMAIL', 'true')
    try {
      const db = leadsDb({ table_booking_leads: [lead('a')] })
      const send = sender()

      const result = await runChristmasLeadFollowUps({ db: db.client, now: NOW, send: send as never, flagOn: async () => true })

      expect(result).toEqual(expect.objectContaining({ held: 'email_suspended' }))
      expect(send).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllEnvs()
    }
  })
})

describe('the 30-day clear-out', () => {
  it('deletes leads dated more than 30 days ago, of either source, and keeps the rest', async () => {
    const db = leadsDb({
      table_booking_leads: [
        lead('old', { booking_date: '2026-10-20' }),
        lead('oldhold', { source: 'lapsed_hold', booking_date: '2026-10-01', table_booking_id: 'b1' }),
        lead('edge', { booking_date: '2026-10-21', follow_up_claimed_at: '2026-10-10T10:00:00.000Z' }),
        lead('future', { booking_date: '2026-12-15', follow_up_claimed_at: '2026-11-19T10:00:00.000Z' }),
      ],
    })

    await run(db)

    expect(db.fake.rows('table_booking_leads').map((row) => row.id)).toEqual(['edge', 'future'])
  })
})
