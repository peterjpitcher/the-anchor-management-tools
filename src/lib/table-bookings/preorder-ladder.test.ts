import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  sendEmail: vi.fn(),
  sendSMS: vi.fn(),
  isCustomerSmsSendAllowed: vi.fn(),
  isEmailSuppressed: vi.fn(),
  logAuditEvent: vi.fn(),
  createTableManageToken: vi.fn(),
  createPreorderGuestToken: vi.fn(),
  buildGuestShortLink: vi.fn(),
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

vi.mock('@/lib/email/emailService', () => ({ sendEmail: mocks.sendEmail }))
vi.mock('@/lib/email/logging', () => ({ isEmailSuppressed: mocks.isEmailSuppressed }))
vi.mock('@/lib/twilio', () => ({ sendSMS: mocks.sendSMS, isCustomerSmsSendAllowed: mocks.isCustomerSmsSendAllowed }))
vi.mock('@/services/audit', () => ({ AuditService: { logAuditEvent: mocks.logAuditEvent } }))
vi.mock('@/lib/table-bookings/manage-booking', () => ({ createTableManageToken: mocks.createTableManageToken }))
vi.mock('@/lib/table-bookings/preorder-guest-token', () => ({ createPreorderGuestToken: mocks.createPreorderGuestToken }))
vi.mock('@/lib/guest/guest-short-link', () => ({ buildGuestShortLink: mocks.buildGuestShortLink }))
vi.mock('@/lib/logger', () => ({ logger: mocks.logger }))
// Reached through preorder-alerts' module graph only; never called here.
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn() }))

import { createFakeSupabase, type FakeSupabase } from '../../../tests/helpers/fakeSupabase'
import { assertCleanGsmText, assertCleanRender } from '../../../tests/mocks/emailRenderChecks'
import { PREORDER_MANAGER_EMAIL } from './preorder-alerts'
import { PURGED_GUEST_ADDRESS, purgeGuestInviteEmails, runPreorderLadder, type LadderBooking, type LadderLedgerRow } from './preorder-ladder'

/**
 * The reminder ladder as the cron runs it (D6, D7): which messages go at which run, that the ledger
 * stops anything going twice even when two runs overlap, that a failed send keeps no "sent" row and
 * is reported, the owner's call list and the guests' own reminders.
 *
 * The booking is on Saturday 12 December 2026 at 7pm with a 7 day cutoff, so choices close at noon
 * on Saturday 5 December. The rungs: 21 November, 28 November and 2 December at noon, 4 December at
 * noon (the day before, with the call list and the guest reminders), 5 December at 9am.
 */

const ORGANISER_EMAIL = 'alex@example.com'
const GUEST_EMAIL = 'jo@example.com'
const MANAGE_LINK = 'https://l.the-anchor.pub/food1'

const BOOKING: LadderBooking = {
  id: 'b-1',
  booking_reference: 'TB-XMAS1',
  booking_date: '2026-12-12',
  booking_time: '19:00:00',
  start_datetime: '2026-12-12T19:00:00.000Z',
  party_size: 3,
  customer_id: 'cust-1',
  booking_period_id: 'p-1',
  booking_period_name: 'Christmas 2026',
  christmas_course_counts: [1, 2, 0],
  created_at: '2026-11-01T10:00:00.000Z',
}

const ORGANISER = {
  id: 'cust-1',
  first_name: 'Alex',
  last_name: 'Organiser',
  mobile_e164: '+447700900777',
  mobile_number: '07700900777',
  email: ORGANISER_EMAIL,
  sms_status: 'active',
  sms_opt_in: true,
  email_status: 'valid',
  email_deactivated_at: null,
}

function cover(id: string, ordinal: number, extra: Record<string, unknown>) {
  return {
    id, table_booking_id: 'b-1', ordinal, guest_name: null, dietary_note: null, has_allergies: null, allergy_detail: null,
    invite_email: null, invite_sent_at: null, invite_reminded_at: null, last_saved_by: null, last_saved_at: null,
    created_at: '2026-11-01T10:00:00Z', updated_at: '2026-11-01T10:00:00Z', ...extra,
  }
}

function selection(id: string, coverId: string, course: string, menuItemId: string) {
  return { id, cover_id: coverId, course, menu_item_id: menuItemId, item_name: `Fixture ${course}`, price_gbp: null, created_at: '2026-11-01T10:00:00Z', updated_at: '2026-11-01T10:00:00Z' }
}

/**
 * Seat 1 is complete (1 course, a main). Seat 2 (Jo, 2 courses) has a main and still needs a starter
 * or a dessert, and was sent her own link. Seat 3 has nothing yet.
 */
function seed(overrides: { customer?: Record<string, unknown>; complete?: boolean } = {}): FakeSupabase {
  const covers = [
    cover('c-1', 1, { guest_name: 'Sam Smith', has_allergies: false }),
    cover('c-2', 2, { guest_name: 'Jo', has_allergies: false, invite_email: GUEST_EMAIL, invite_sent_at: '2026-11-20T10:00:00Z' }),
  ]
  const selections = [selection('s-1', 'c-1', 'main', 'i-main'), selection('s-2', 'c-2', 'main', 'i-main')]
  let counts = BOOKING.christmas_course_counts
  if (overrides.complete) {
    covers.push(cover('c-3', 3, { guest_name: 'Kit', has_allergies: false }))
    selections.push(selection('s-3', 'c-2', 'dessert', 'i-dessert'), selection('s-4', 'c-3', 'main', 'i-main'))
    counts = [1, 2, 1]
  }
  return createFakeSupabase(
    {
      table_bookings: [
        {
          ...BOOKING, christmas_course_counts: counts, status: 'confirmed', booking_type: 'christmas', allergies: [],
          booking_period_answer: true, booking_period_requires_preorder: true,
        },
      ],
      booking_periods: [{ id: 'p-1', preorder_cutoff_days: 7 }],
      booking_period_menu_items: [
        { id: 'i-main', period_id: 'p-1', course: 'main', name: 'Fixture main', is_active: true, is_child_option: false, sort_order: 1 },
        { id: 'i-dessert', period_id: 'p-1', course: 'dessert', name: 'Fixture dessert', is_active: true, is_child_option: false, sort_order: 2 },
      ],
      booking_preorder_covers: covers,
      booking_preorder_selections: selections,
      booking_preorder_reminders: [],
      customers: [{ ...ORGANISER, ...(overrides.customer ?? {}) }],
    },
    // The table's two unique indexes: (booking, kind) for booking rows, (booking, kind, seat) for a guest's.
    { unique: { booking_preorder_reminders: (row) => `${row.table_booking_id}:${row.kind}:${row.cover_id ?? ''}` } },
  )
}

async function run(db: FakeSupabase, now: string, booking: LadderBooking = BOOKING) {
  const ledger = db.tables.booking_preorder_reminders.map((row) => ({ ...row })) as LadderLedgerRow[]
  return runPreorderLadder(db as never, {
    now: new Date(now),
    bookings: [{ ...booking, christmas_course_counts: db.tables.table_bookings[0].christmas_course_counts }],
    ledger,
    cutoffByPeriod: new Map([['p-1', 7]]),
    appBaseUrl: 'https://management.example.com',
  })
}

function emails() {
  return mocks.sendEmail.mock.calls.map((call) => call[0] as { to: string; subject: string; html: string; text: string; idempotencyKey?: string; logRedactions?: string[] })
}

function ledgerKinds(db: FakeSupabase): string[] {
  return db.tables.booking_preorder_reminders.map((row) => (row.cover_id ? `${row.kind}:${row.cover_id}` : row.kind)).sort()
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.sendEmail.mockResolvedValue({ success: true, messageId: 're_1' })
  mocks.sendSMS.mockResolvedValue({ success: true, sid: 'SM1' })
  mocks.isCustomerSmsSendAllowed.mockResolvedValue({ allowed: true })
  mocks.isEmailSuppressed.mockResolvedValue(false)
  mocks.logAuditEvent.mockResolvedValue(undefined)
  mocks.createTableManageToken.mockResolvedValue({ rawToken: 'manage-tok', url: 'https://management.example.com/g/manage-tok/table-manage', expiresAt: '2026-12-14T19:00:00Z' })
  mocks.buildGuestShortLink.mockResolvedValue({ url: MANAGE_LINK, shortened: true })
  let guestTokens = 0
  mocks.createPreorderGuestToken.mockImplementation(async (_db: unknown, input: { expiresAt: string }) => {
    guestTokens += 1
    return { rawToken: `guest-tok-${guestTokens}`, url: `https://management.example.com/g/guest-tok-${guestTokens}/christmas-choice`, expiresAt: input.expiresAt }
  })
})

describe('the organiser rungs', () => {
  it('sends the 21 day email and no text, once, however many times the run repeats', async () => {
    const db = seed()

    const first = await run(db, '2026-11-21T12:00:30Z')
    const again = await run(db, '2026-11-21T12:00:30Z')
    const nineAmNextDay = await run(db, '2026-11-22T09:00:30Z')

    expect(first).toEqual(expect.objectContaining({ organiserEmails: 1, organiserTexts: 0, failed: 0 }))
    expect(again.organiserEmails + nineAmNextDay.organiserEmails).toBe(0)
    expect(mocks.sendSMS).not.toHaveBeenCalled()
    expect(emails()).toHaveLength(1)
    const [email] = emails()
    assertCleanRender(email)
    expect(email.to).toBe(ORGANISER_EMAIL)
    expect(email.idempotencyKey).toBe('table_booking_preorder_reminder:b-1:booker_21d')
    expect(email.text).toContain('Jo: a starter or a dessert.')
    expect(email.text).toContain('Guest 3: a name, their allergies, their number of courses and a main.')
    expect(email.text).not.toContain('Sam')
    expect(ledgerKinds(db)).toEqual(['booker_21d'])
  })

  it('sends nothing twice when two runs overlap', async () => {
    const db = seed()

    const [a, b] = await Promise.all([run(db, '2026-11-21T12:00:30Z'), run(db, '2026-11-21T12:00:30Z')])

    expect(a.organiserEmails + b.organiserEmails).toBe(1)
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1)
    expect(ledgerKinds(db)).toEqual(['booker_21d'])
  })

  it('sends nothing before a rung is due, and nothing for a rung that fell before the booking was made', async () => {
    const db = seed()

    const early = await run(db, '2026-11-21T11:59:00Z')
    // Made at 1pm on 21 November, after the 21 day rung: it starts at the 14 day rung.
    const late = await run(db, '2026-11-21T13:00:00Z', { ...BOOKING, created_at: '2026-11-21T13:00:00Z' })

    expect(early.organiserEmails + late.organiserEmails).toBe(0)
    expect(mocks.sendEmail).not.toHaveBeenCalled()
    expect(db.tables.booking_preorder_reminders).toHaveLength(0)
  })

  it('does not repeat the 10 day ask for a booking the first release already reminded', async () => {
    const db = seed()
    db.tables.booking_preorder_reminders.push({ id: 'old', table_booking_id: 'b-1', kind: 'booker_reminder', cover_id: null, sent_at: '2026-12-02T12:00:00Z' })

    const result = await run(db, '2026-12-02T12:00:30Z')

    expect(result.organiserEmails).toBe(0)
  })

  it('stops once everything is in', async () => {
    const db = seed({ complete: true })

    const result = await run(db, '2026-12-04T12:00:30Z')

    expect(result.alreadyComplete).toBe(1)
    expect(mocks.sendEmail).not.toHaveBeenCalled()
    expect(mocks.sendSMS).not.toHaveBeenCalled()
  })

  it('sends nothing once the form has locked at noon on cutoff day', async () => {
    const db = seed()

    const result = await run(db, '2026-12-05T12:00:30Z')

    expect(result.skipped).toBe(1)
    expect(mocks.sendEmail).not.toHaveBeenCalled()
  })
})

describe('the day before the cutoff, then cutoff morning', () => {
  it('emails and texts the organiser, sends the call list and reminds the invited guest, then the last call at 9am', async () => {
    const db = seed()

    const dayBefore = await run(db, '2026-12-04T12:00:30Z')

    expect(dayBefore).toEqual(
      expect.objectContaining({ organiserEmails: 1, organiserTexts: 1, managerEmails: 1, managerCallListBookings: 1, guestReminders: 1, failed: 0, partial: 0 }),
    )
    expect(ledgerKinds(db)).toEqual(['booker_day_before', 'guest_reminder:c-2', 'manager_day_before'])

    const [to, body, options] = mocks.sendSMS.mock.calls[0]
    expect(to).toBe('+447700900777')
    assertCleanGsmText(body)
    expect(body).toBe(`The Anchor: Hi Alex, we still need Christmas food choices for Jo and Guest 3. Choices close at noon tomorrow. Fill them in here: ${MANAGE_LINK}`)
    expect(options.metadata).toEqual({ table_booking_id: 'b-1', template_key: 'table_booking_preorder_reminder', stage: 'booker_day_before' })

    const organiser = emails().find((email) => email.to === ORGANISER_EMAIL)!
    expect(organiser.subject).toBe('Your Christmas food choices close at noon tomorrow')

    const manager = emails().find((email) => email.to === PREORDER_MANAGER_EMAIL)!
    expect(manager.subject).toBe('Christmas food choices still missing: 1 booking to ring')
    expect(manager.text).toContain('TB-XMAS1')
    expect(manager.text).toContain('Call: Alex Organiser on +447700900777')
    expect(manager.text).toContain('Seat 2 (2 courses) needs a starter or a dessert.')
    // Seat numbers only on a staff email: no guest names.
    expect(manager.text).not.toContain('Jo')

    const guest = emails().find((email) => email.to === GUEST_EMAIL)!
    assertCleanRender(guest)
    expect(guest.text).toContain('Hi Jo, Alex asked us to send you a link')
    expect(guest.text).toContain('We still need a starter or a dessert.')
    expect(guest.text).toContain('https://management.example.com/g/guest-tok-1/christmas-choice')
    // Only this guest's seat, and the token is kept out of the email log.
    expect(guest.text).not.toContain('Guest 3')
    expect(guest.logRedactions).toEqual(['https://management.example.com/g/guest-tok-1/christmas-choice', 'guest-tok-1'])
    // A fresh token, scoped to the seat and expiring at the cutoff.
    expect(mocks.createPreorderGuestToken).toHaveBeenCalledWith(db, expect.objectContaining({
      customerId: 'cust-1', tableBookingId: 'b-1', coverId: 'c-2', expiresAt: '2026-12-05T12:00:00.000Z',
    }))
    expect(db.tables.booking_preorder_covers.find((row) => row.id === 'c-2')?.invite_reminded_at).toBe('2026-12-04T12:00:30.000Z')

    vi.clearAllMocks()
    mocks.sendEmail.mockResolvedValue({ success: true })
    mocks.sendSMS.mockResolvedValue({ success: true })
    const cutoffMorning = await run(db, '2026-12-05T09:00:30Z')

    expect(cutoffMorning).toEqual(expect.objectContaining({ organiserEmails: 1, organiserTexts: 1, managerEmails: 0, guestReminders: 0 }))
    expect(emails().map((email) => email.subject)).toEqual(['Last call: Christmas food choices close at noon today'])
    expect(mocks.sendSMS.mock.calls[0][1]).toContain('last call. Christmas food choices close at noon today')
    expect(ledgerKinds(db)).toEqual(['booker_cutoff_morning', 'booker_day_before', 'guest_reminder:c-2', 'manager_day_before'])
  })

  it('does not remind a guest who was never sent a link, or whose address has been cleared', async () => {
    const db = seed()
    const jo = db.tables.booking_preorder_covers.find((row) => row.id === 'c-2')!
    jo.invite_email = null

    const result = await run(db, '2026-12-04T12:00:30Z')

    expect(result.guestReminders).toBe(0)
    expect(emails().some((email) => email.to === GUEST_EMAIL)).toBe(false)
    expect(ledgerKinds(db)).not.toContain('guest_reminder:c-2')
  })
})

describe('an organiser with no usable email', () => {
  it('gets nothing on an email-only rung and no ledger row, and a text only on the day before', async () => {
    const db = seed({ customer: { email: null } })

    const rung21 = await run(db, '2026-11-21T12:00:30Z')
    expect(rung21.noChannel).toBe(1)
    expect(db.tables.booking_preorder_reminders).toHaveLength(0)

    const dayBefore = await run(db, '2026-12-04T12:00:30Z')
    expect(dayBefore.organiserTexts).toBe(1)
    expect(dayBefore.organiserEmails).toBe(0)
    expect(emails().some((email) => email.to === ORGANISER_EMAIL)).toBe(false)
  })

  it('gets no text when they have opted out of texts', async () => {
    mocks.isCustomerSmsSendAllowed.mockResolvedValue({ allowed: false, reason: 'sms_opt_in_blocked' })
    const db = seed({ customer: { email: null } })

    const dayBefore = await run(db, '2026-12-04T12:00:30Z')

    expect(dayBefore.organiserTexts).toBe(0)
    expect(mocks.sendSMS).not.toHaveBeenCalled()
    expect(ledgerKinds(db)).not.toContain('booker_day_before')
  })
})

describe('a failing sender', () => {
  it('is recorded and reported, keeps no ledger row, and the next run tries again', async () => {
    mocks.sendEmail.mockResolvedValueOnce({ success: false, error: 'provider down' })
    const db = seed()

    const failed = await run(db, '2026-11-21T12:00:30Z')

    expect(failed.failed).toBe(1)
    expect(failed.organiserEmails).toBe(0)
    expect(failed.failures).toEqual([
      { bookingId: 'b-1', reference: 'TB-XMAS1', kind: 'booker_21d', outcome: 'failed', error: 'email: provider down' },
    ])
    expect(db.tables.booking_preorder_reminders).toHaveLength(0)
    expect(mocks.logger.error).toHaveBeenCalled()
    expect(mocks.logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ operation_type: 'table_booking.notification_failed', resource_id: 'b-1' }))

    const retried = await run(db, '2026-11-22T09:00:30Z')
    expect(retried.organiserEmails).toBe(1)
    expect(ledgerKinds(db)).toEqual(['booker_21d'])
  })

  it('keeps the row when the provider gave no definite answer, so it is not sent twice', async () => {
    mocks.sendEmail.mockResolvedValueOnce({ success: false, error: 'timed out', uncertain: true })
    const db = seed()

    const result = await run(db, '2026-11-21T12:00:30Z')

    expect(result.failures[0]).toEqual(expect.objectContaining({ outcome: 'uncertain' }))
    expect(ledgerKinds(db)).toEqual(['booker_21d'])
  })

  it('a text that fails beside an email that went is partial: reported, and the row kept', async () => {
    mocks.sendSMS.mockResolvedValue({ success: false, error: 'Twilio down' })
    const db = seed()

    const result = await run(db, '2026-12-04T12:00:30Z')

    expect(result.partial).toBe(1)
    expect(result.failures).toContainEqual(expect.objectContaining({ kind: 'booker_day_before', outcome: 'partial', error: 'text: Twilio down' }))
    expect(ledgerKinds(db)).toContain('booker_day_before')
  })

  it('a failed call list email releases its rows for the next run', async () => {
    mocks.sendEmail.mockImplementation(async (input: { to: string }) =>
      input.to === PREORDER_MANAGER_EMAIL ? { success: false, error: 'provider down' } : { success: true },
    )
    const db = seed()

    const result = await run(db, '2026-12-04T12:00:30Z')

    expect(result.managerEmails).toBe(0)
    expect(result.failures).toContainEqual(expect.objectContaining({ kind: 'manager_day_before', outcome: 'failed' }))
    expect(ledgerKinds(db)).not.toContain('manager_day_before')

    mocks.sendEmail.mockResolvedValue({ success: true })
    const retried = await run(db, '2026-12-05T09:00:30Z')
    expect(retried.managerEmails).toBe(1)
  })

  it('a failed guest reminder releases its row and leaves invite_reminded_at unset', async () => {
    mocks.sendEmail.mockImplementation(async (input: { to: string }) =>
      input.to === GUEST_EMAIL ? { success: false, error: 'provider down' } : { success: true },
    )
    const db = seed()

    const result = await run(db, '2026-12-04T12:00:30Z')

    expect(result.guestReminders).toBe(0)
    expect(result.failures).toContainEqual(expect.objectContaining({ kind: 'guest_reminder', coverId: 'c-2', outcome: 'failed' }))
    expect(ledgerKinds(db)).not.toContain('guest_reminder:c-2')
    expect(db.tables.booking_preorder_covers.find((row) => row.id === 'c-2')?.invite_reminded_at).toBeNull()
  })
})

describe('the call list across bookings', () => {
  it('sends one email listing every booking due this run', async () => {
    const db = seed()
    const second = { ...db.tables.table_bookings[0], id: 'b-2', booking_reference: 'TB-XMAS2', booking_time: '13:00:00', party_size: 1, christmas_course_counts: [0] }
    db.tables.table_bookings.push(second)

    const result = await runPreorderLadder(db as never, {
      now: new Date('2026-12-04T12:00:30Z'),
      bookings: [BOOKING, { ...BOOKING, id: 'b-2', booking_reference: 'TB-XMAS2', booking_time: '13:00:00', party_size: 1, christmas_course_counts: [0] }],
      ledger: [],
      cutoffByPeriod: new Map([['p-1', 7]]),
    })

    expect(result.managerEmails).toBe(1)
    expect(result.managerCallListBookings).toBe(2)
    const managerEmails = emails().filter((email) => email.to === PREORDER_MANAGER_EMAIL)
    expect(managerEmails).toHaveLength(1)
    expect(managerEmails[0].subject).toBe('Christmas food choices still missing: 2 bookings to ring')
    expect(managerEmails[0].text).toContain('TB-XMAS1')
    expect(managerEmails[0].text).toContain('TB-XMAS2')
  })
})

describe('purgeGuestInviteEmails', () => {
  it('clears the guest addresses on seats whose booking date has passed, and no others', async () => {
    const db = seed()
    db.tables.table_bookings.push({ id: 'b-past', booking_date: '2026-11-30' })
    db.tables.booking_preorder_covers.push(cover('c-past', 1, { table_booking_id: 'b-past', invite_email: 'old@example.com' }))

    const cleared = await purgeGuestInviteEmails(db as never, '2026-12-01')

    expect(cleared).toBe(1)
    expect(db.tables.booking_preorder_covers.find((row) => row.id === 'c-past')?.invite_email).toBeNull()
    expect(db.tables.booking_preorder_covers.find((row) => row.id === 'c-2')?.invite_email).toBe(GUEST_EMAIL)
  })

  it("removes the guest's address from the log of their invite and reminder on the same past bookings only", async () => {
    const db = seed()
    db.tables.table_bookings.push({ id: 'b-past', booking_date: '2026-11-30' })
    db.tables.booking_preorder_covers.push(cover('c-past', 1, { table_booking_id: 'b-past', invite_email: 'old@example.com' }))
    db.tables.email_messages = [
      { id: 'm-invite', table_booking_id: 'b-past', comm_type: 'table_booking_preorder_guest_invite', to_address: 'old@example.com' },
      { id: 'm-reminder', table_booking_id: 'b-past', comm_type: 'table_booking_preorder_guest_reminder', to_address: 'old@example.com' },
      // The organiser's own messages on the same booking keep their address.
      { id: 'm-organiser', table_booking_id: 'b-past', comm_type: 'table_booking_preorder_reminder', to_address: 'organiser@example.com' },
      // A booking still to come keeps its guest's address.
      { id: 'm-future', table_booking_id: BOOKING.id, comm_type: 'table_booking_preorder_guest_invite', to_address: GUEST_EMAIL },
    ]

    await purgeGuestInviteEmails(db as never, '2026-12-01')

    const address = (id: string) => db.tables.email_messages.find((row) => row.id === id)?.to_address
    expect(address('m-invite')).toBe(PURGED_GUEST_ADDRESS)
    expect(address('m-reminder')).toBe(PURGED_GUEST_ADDRESS)
    expect(address('m-organiser')).toBe('organiser@example.com')
    expect(address('m-future')).toBe(GUEST_EMAIL)
  })

  it('leaves the seats for the next run when the log cannot be updated', async () => {
    const db = seed()
    db.tables.table_bookings.push({ id: 'b-past', booking_date: '2026-11-30' })
    db.tables.booking_preorder_covers.push(cover('c-past', 1, { table_booking_id: 'b-past', invite_email: 'old@example.com' }))
    db.failures.push({ table: 'email_messages', op: 'update', error: { message: 'timeout' } })

    await expect(purgeGuestInviteEmails(db as never, '2026-12-01')).rejects.toBeTruthy()
    expect(db.tables.booking_preorder_covers.find((row) => row.id === 'c-past')?.invite_email).toBe('old@example.com')
  })
})
