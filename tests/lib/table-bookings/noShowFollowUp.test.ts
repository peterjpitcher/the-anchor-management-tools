import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase, type FakeSupabase } from '../../helpers/fakeSupabase'
import { assertCleanRender, expectedLongDate } from '../../mocks/emailRenderChecks'

/**
 * The morning-after no-show email (owner decisions of 22 November 2026): the 10:00 London gate in
 * winter and summer, who gets it, that the claim is written before the send and never released,
 * that the flag and the kill switch hold it, that it is email only, and the wording as rendered
 * from fixtures. Run against the in-memory fake database with the real email builder, link token
 * and date helpers; only the sender is a fake.
 *
 * Every instant is written in UTC so the file reads the same in both test zones.
 */

const { logError } = vi.hoisted(() => ({ logError: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { error: logError, warn: vi.fn(), info: vi.fn() } }))
vi.mock('@/lib/email/emailService', () => ({ sendEmail: vi.fn() }))
vi.mock('@/lib/email/logging', () => ({ isEmailSuppressed: vi.fn(async () => false) }))
vi.mock('@/lib/messaging/flags', () => ({ isMessagingFlagOn: vi.fn() }))
vi.mock('@/services/audit', () => ({ AuditService: { logAuditEvent: vi.fn(async () => undefined) } }))
vi.mock('@/lib/twilio', () => ({ sendSMS: vi.fn(), sendWhatsApp: vi.fn() }))

import { sendEmail } from '@/lib/email/emailService'
import { isMessagingFlagOn } from '@/lib/messaging/flags'
import { sendSMS, sendWhatsApp } from '@/lib/twilio'
import { hashGuestToken } from '@/lib/guest/tokens'
import {
  isNoShowFollowUpHour,
  noShowFollowUpIdempotencyKey,
  runNoShowFollowUps,
} from '@/lib/table-bookings/no-show-follow-up'
import { buildNoShowFollowUpEmail, noShowFollowUpProblem } from '@/lib/table-bookings/no-show-follow-up-email'

type SendArgs = Parameters<typeof sendEmail>[0]

// 10:00 London on Sunday 22 November 2026 (GMT, so 10:00 UTC). Yesterday is Saturday 21 November.
const NOW = new Date('2026-11-22T10:00:00Z')
const APP = 'https://management.example.test'

function customer(id: string, overrides: Record<string, unknown> = {}) {
  return { id, first_name: 'Sam', email: `${id}@example.com`, email_status: null, email_deactivated_at: null, ...overrides }
}

function booking(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    customer_id: 'c1',
    status: 'no_show',
    booking_date: '2026-11-21',
    booking_time: '19:00:00',
    start_datetime: '2026-11-21T19:00:00.000Z',
    party_size: 4,
    contact_email: null,
    event_booking_id: null,
    no_show_marked_by: null,
    no_show_follow_up_claimed_at: null,
    no_show_follow_up_sent_at: null,
    ...overrides,
  }
}

function seed(bookings: Array<Record<string, unknown>>, customers = [customer('c1')]): FakeSupabase {
  return createFakeSupabase({ table_bookings: bookings, customers, guest_tokens: [] })
}

const send = vi.fn(async (_options: SendArgs) => ({ success: true as const, messageId: 'msg-1' }))

function run(db: FakeSupabase, overrides: Record<string, unknown> = {}) {
  return runNoShowFollowUps({
    db: db as never,
    now: NOW,
    send: send as never,
    flagOn: async () => true,
    suspended: () => false,
    isSuppressed: async () => false,
    appBaseUrl: APP,
    ...overrides,
  })
}

const row = (db: FakeSupabase, id: string) => db.tables.table_bookings.find((candidate) => candidate.id === id)

beforeEach(() => {
  vi.clearAllMocks()
  send.mockResolvedValue({ success: true, messageId: 'msg-1' })
})

describe('the 10:00 London gate', () => {
  it('is 10:00 UTC in winter and 09:00 UTC in summer time', () => {
    // Winter (GMT): the 10:00 UTC run is the one.
    expect(isNoShowFollowUpHour(new Date('2026-11-22T10:00:00Z'))).toBe(true)
    expect(isNoShowFollowUpHour(new Date('2026-11-22T10:59:00Z'))).toBe(true)
    expect(isNoShowFollowUpHour(new Date('2026-11-22T09:00:00Z'))).toBe(false)
    expect(isNoShowFollowUpHour(new Date('2026-11-22T11:00:00Z'))).toBe(false)
    // Summer (BST): the 09:00 UTC run is the one.
    expect(isNoShowFollowUpHour(new Date('2026-07-12T09:00:00Z'))).toBe(true)
    expect(isNoShowFollowUpHour(new Date('2026-07-12T10:00:00Z'))).toBe(false)
    expect(isNoShowFollowUpHour(new Date('2026-07-12T08:00:00Z'))).toBe(false)
  })

  it('does nothing on any other hourly run', async () => {
    const db = seed([booking('b1')])

    const result = await run(db, { now: new Date('2026-11-22T09:00:00Z') })

    expect(result).toEqual({ state: 'not_due', londonTime: '09:00' })
    expect(send).not.toHaveBeenCalled()
    expect(row(db, 'b1')?.no_show_follow_up_claimed_at).toBeNull()
  })

  it("emails yesterday's no-shows on the summer run too", async () => {
    // Sunday 12 July 2026, 10:00 BST. Saturday 11 July at 19:00 BST is 18:00 UTC.
    const db = seed([booking('b1', { booking_date: '2026-07-11', start_datetime: '2026-07-11T18:00:00.000Z' })])

    const result = await run(db, { now: new Date('2026-07-12T09:00:00Z') })

    expect(result).toMatchObject({ state: 'ran', sent: 1 })
    expect(send.mock.calls[0][0].text).toContain(`at 7pm on ${expectedLongDate('2026-07-11')}`)
  })
})

describe('who is emailed', () => {
  it('sends one email, by email only, with a link that opens the guest page', async () => {
    const db = seed([booking('b1')])

    const result = await run(db)

    expect(result).toMatchObject({ state: 'ran', flag: 'on', held: null, considered: 1, sent: 1, refused: 0, errors: 0 })
    expect(send).toHaveBeenCalledTimes(1)
    const options = send.mock.calls[0][0]
    expect(options).toMatchObject({
      to: 'c1@example.com',
      subject: 'Did we miss you yesterday?',
      commType: 'table_no_show_follow_up',
      customerId: 'c1',
      tableBookingId: 'b1',
      idempotencyKey: noShowFollowUpIdempotencyKey('b1'),
    })

    // The link in the email is a real guest token for this booking, kept out of the email log.
    const token = db.tables.guest_tokens[0]
    expect(token).toMatchObject({ action_type: 'no_show_follow_up', table_booking_id: 'b1', customer_id: 'c1' })
    const rawToken = /\/g\/([^/]+)\/no-show-follow-up/.exec(options.text ?? '')?.[1] as string
    expect(hashGuestToken(rawToken)).toBe(token.hashed_token)
    expect(options.logRedactions).toEqual([rawToken])
    expect(Date.parse(token.expires_at)).toBe(NOW.getTime() + 14 * 24 * 60 * 60 * 1000)

    expect(row(db, 'b1')).toMatchObject({
      no_show_follow_up_claimed_at: NOW.toISOString(),
      no_show_follow_up_sent_at: NOW.toISOString(),
    })
    // Never a text, whatever happens.
    expect(sendSMS).not.toHaveBeenCalled()
    expect(sendWhatsApp).not.toHaveBeenCalled()
  })

  it('treats a staff-marked and an automatic no-show the same', async () => {
    const db = seed(
      [booking('auto'), booking('staff', { customer_id: 'c2', no_show_marked_by: 'staff-1' })],
      [customer('c1'), customer('c2')],
    )

    const result = await run(db)

    expect(result).toMatchObject({ sent: 2 })
  })

  it('leaves out anything that is not a no-show for yesterday', async () => {
    const db = seed(
      [
        booking('put-right', { status: 'confirmed' }),
        booking('cancelled', { status: 'cancelled' }),
        booking('two-days-ago', { booking_date: '2026-11-20', start_datetime: '2026-11-20T19:00:00.000Z' }),
        booking('today', { booking_date: '2026-11-22', start_datetime: '2026-11-22T09:00:00.000Z' }),
        booking('event-table', { event_booking_id: 'event-booking-1' }),
        booking('already-claimed', { no_show_follow_up_claimed_at: '2026-11-22T10:00:00.000Z' }),
      ],
    )

    const result = await run(db)

    expect(result).toMatchObject({ state: 'ran', considered: 0, sent: 0 })
    expect(send).not.toHaveBeenCalled()
  })

  it('leaves out a late-night table that really started today, because the subject says yesterday', async () => {
    // Booked on Saturday's hours at 00:15, so it started on Sunday, the day the email would go.
    const db = seed([booking('after-midnight', { booking_time: '00:15:00', start_datetime: '2026-11-22T00:15:00.000Z' })])

    const result = await run(db)

    expect(result).toMatchObject({ sent: 0, skipped: { not_yesterday: 1 } })
    expect(row(db, 'after-midnight')?.no_show_follow_up_claimed_at).toBeNull()
  })

  it('sends nothing, and claims nothing, without a usable email address', async () => {
    const db = seed(
      [
        booking('none', { customer_id: 'none' }),
        booking('malformed', { customer_id: 'malformed' }),
        booking('bounced', { customer_id: 'bounced' }),
        booking('deactivated', { customer_id: 'deactivated' }),
        booking('suppressed', { customer_id: 'suppressed' }),
        booking('no-customer', { customer_id: null }),
      ],
      [
        customer('none', { email: null }),
        customer('malformed', { email: 'not-an-address' }),
        customer('bounced', { email_status: 'bounced' }),
        customer('deactivated', { email_deactivated_at: '2026-10-01T00:00:00.000Z' }),
        customer('suppressed'),
      ],
    )

    const result = await run(db, { isSuppressed: async (email: string) => email === 'suppressed@example.com' })

    expect(result).toMatchObject({ sent: 0, skipped: { no_usable_email: 6 } })
    expect(send).not.toHaveBeenCalled()
    expect(db.tables.table_bookings.every((candidate) => candidate.no_show_follow_up_claimed_at === null)).toBe(true)
    expect(sendSMS).not.toHaveBeenCalled()
  })

  it('uses the address typed for the booking over a bounced customer address', async () => {
    const db = seed([booking('b1', { contact_email: 'Typed@Example.com ' })], [customer('c1', { email_status: 'bounced' })])

    await run(db)

    expect(send.mock.calls[0][0].to).toBe('typed@example.com')
  })

  it('sends one email to a guest with two no-shows', async () => {
    const db = seed([booking('early', { booking_time: '12:00:00' }), booking('late')])

    const result = await run(db)

    expect(result).toMatchObject({ sent: 1, skipped: { same_guest: 1 } })
    expect(send).toHaveBeenCalledTimes(1)
  })
})

describe('idempotency and the switches', () => {
  it('never sends twice: a second run at 10:00 finds the claim', async () => {
    const db = seed([booking('b1')])

    await run(db)
    const second = await run(db, { now: new Date('2026-11-22T10:30:00Z') })

    expect(second).toMatchObject({ state: 'ran', considered: 0, sent: 0 })
    expect(send).toHaveBeenCalledTimes(1)
    expect(db.tables.guest_tokens).toHaveLength(1)
  })

  it('claims before it sends, and keeps the claim when the send is refused', async () => {
    const db = seed([booking('b1')])
    send.mockImplementationOnce(async () => {
      // The claim is already on the booking while the email is being sent.
      expect(row(db, 'b1')?.no_show_follow_up_claimed_at).toBe(NOW.toISOString())
      return { success: false, error: 'provider said no' } as never
    })

    const first = await run(db)
    const second = await run(db)

    expect(first).toMatchObject({ sent: 0, refused: 1 })
    expect(second).toMatchObject({ considered: 0 })
    expect(send).toHaveBeenCalledTimes(1)
    expect(row(db, 'b1')).toMatchObject({ no_show_follow_up_claimed_at: NOW.toISOString(), no_show_follow_up_sent_at: null })
    expect(logError).toHaveBeenCalled()
  })

  it('records a send whose outcome is unknown and does not retry it', async () => {
    const db = seed([booking('b1')])
    send.mockResolvedValueOnce({ success: false, uncertain: true, error: 'timed out' } as never)

    const result = await run(db)

    expect(result).toMatchObject({ sent: 0, uncertain: 1 })
    expect(row(db, 'b1')?.no_show_follow_up_claimed_at).toBe(NOW.toISOString())
  })

  it('sends and claims nothing while the flag is off', async () => {
    const db = seed([booking('b1')])

    const result = await run(db, { flagOn: async () => false })

    expect(result).toMatchObject({ state: 'ran', flag: 'off', sent: 0 })
    expect(send).not.toHaveBeenCalled()
    expect(row(db, 'b1')?.no_show_follow_up_claimed_at).toBeNull()
  })

  it('reads the table_no_show_follow_up flag when none is passed', async () => {
    vi.mocked(isMessagingFlagOn).mockResolvedValue(false)
    const db = seed([booking('b1')])

    const result = await runNoShowFollowUps({ db: db as never, now: NOW, send: send as never })

    expect(isMessagingFlagOn).toHaveBeenCalledWith('table_no_show_follow_up')
    expect(result).toMatchObject({ flag: 'off' })
  })

  it('holds the run, claiming nothing, while email is suspended', async () => {
    const db = seed([booking('b1')])

    const result = await run(db, { suspended: () => true })

    expect(result).toMatchObject({ flag: 'on', held: 'email_suspended', sent: 0 })
    expect(send).not.toHaveBeenCalled()
    expect(row(db, 'b1')?.no_show_follow_up_claimed_at).toBeNull()
  })
})

describe('the email as the guest reads it', () => {
  const email = buildNoShowFollowUpEmail({
    firstName: 'Sam',
    partySize: 4,
    bookingDate: '2026-11-21',
    bookingTime: '19:00:00',
    replyUrl: `${APP}/g/raw-token/no-show-follow-up`,
  })

  it('renders with no broken values, the venue number and the sign-off', () => {
    assertCleanRender(email)
  })

  it('names the weekday that the date really falls on', () => {
    // 21 November 2026 is a Saturday, worked out from the calendar and not from a formatter.
    expect(expectedLongDate('2026-11-21')).toBe('Saturday 21 November 2026')
    expect(email.text).toContain('at 7pm on Saturday 21 November 2026')
    expect(email.html).toContain('at 7pm on Saturday 21 November 2026')
    for (const date of ['2026-07-11', '2026-12-31', '2027-03-28', '2026-10-25']) {
      const other = buildNoShowFollowUpEmail({ firstName: 'Sam', partySize: 2, bookingDate: date, bookingTime: '12:30', replyUrl: 'https://x.test/g/t/no-show-follow-up' })
      expect(other.text).toContain(`at 12:30pm on ${expectedLongDate(date)}`)
    }
  })

  it('is the wording the owner approved, word for word', () => {
    expect(email.subject).toBe('Did we miss you yesterday?')
    expect(email.text).toBe(
      [
        "Hi Sam, we had a table for 4 booked for you at 7pm on Saturday 21 November 2026, and our records show you didn't make it.",
        "If we've made a mistake and you did come in, thank you very much for joining us. Please let us know with the button below so we can put it right.",
        `I did come in: ${APP}/g/raw-token/no-show-follow-up`,
        "If you weren't able to make it, that's no problem at all, and nobody is cross. It would really help us to know what got in the way, so we can make booking with us easier.",
        `Tell us what happened: ${APP}/g/raw-token/no-show-follow-up#what-happened`,
        "We'd love to see you another time.",
        'Any questions, call us on 01753 682707 or email manager@the-anchor.pub.',
        'The Anchor',
      ].join('\n\n'),
    )
    expect(email.html).toContain('>I did come in</a>')
    expect(email.html).toContain('>Tell us what happened</a>')
    expect(email.html).not.toMatch(/!/)
  })

  it('refuses to build from a missing fact instead of sending a broken email', () => {
    expect(noShowFollowUpProblem({ firstName: 'Sam', partySize: 4, bookingDate: '2026-11-21', bookingTime: '19:00' })).toBeNull()
    expect(noShowFollowUpProblem({ firstName: ' ', partySize: 4, bookingDate: '2026-11-21', bookingTime: '19:00' })).toBe('no first name')
    expect(noShowFollowUpProblem({ firstName: 'Sam', partySize: 0, bookingDate: '2026-11-21', bookingTime: '19:00' })).toBe('no party size')
    expect(noShowFollowUpProblem({ firstName: 'Sam', partySize: 4, bookingDate: 'soon', bookingTime: '19:00' })).toBe('no date')
    expect(noShowFollowUpProblem({ firstName: 'Sam', partySize: 4, bookingDate: '2026-11-21', bookingTime: '' })).toBe('no time')
  })

  it('skips a booking with a missing fact without claiming it', async () => {
    const db = seed([booking('b1', { party_size: null })])

    const result = await run(db)

    expect(result).toMatchObject({ sent: 0, skipped: { missing_details: 1 } })
    expect(row(db, 'b1')?.no_show_follow_up_claimed_at).toBeNull()
  })
})
