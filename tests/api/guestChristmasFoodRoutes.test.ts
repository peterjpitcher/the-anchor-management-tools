import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * The Christmas food page's two write paths (spec section 3.3, D5, D8):
 *
 *   /g/<manage token>/table-manage/food   the organiser: save a line, send a guest link, email a copy;
 *   /g/<guest token>/christmas-choice/save one guest saving their own line.
 *
 * Guest scope, the cutoff refusal, invite validation and a failing email sender, with every
 * external service mocked. Nothing here reaches a database or a mailbox.
 */

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  checkGuestTokenThrottle: vi.fn(),
  getTableManagePreviewByRawToken: vi.fn(),
  isPreorderEnabled: vi.fn(),
  loadPreorderOrder: vi.fn(),
  syncPreorderCovers: vi.fn(),
  savePreorderCover: vi.fn(),
  resolvePreorderGuestToken: vi.fn(),
  createPreorderGuestToken: vi.fn(),
  sendEmail: vi.fn(),
  isMessagingFlagOn: vi.fn(),
  logAuditEvent: vi.fn(),
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@/lib/guest/token-throttle', () => ({ checkGuestTokenThrottle: mocks.checkGuestTokenThrottle }))
vi.mock('@/lib/table-bookings/manage-booking', () => ({ getTableManagePreviewByRawToken: mocks.getTableManagePreviewByRawToken }))
vi.mock('@/lib/table-bookings/preorder', async () => {
  const actual = await vi.importActual<typeof import('@/lib/table-bookings/preorder')>('@/lib/table-bookings/preorder')
  return {
    ...actual,
    isPreorderEnabled: mocks.isPreorderEnabled,
    loadPreorderOrder: mocks.loadPreorderOrder,
    syncPreorderCovers: mocks.syncPreorderCovers,
    savePreorderCover: mocks.savePreorderCover,
  }
})
vi.mock('@/lib/table-bookings/preorder-guest-token', () => ({
  resolvePreorderGuestToken: mocks.resolvePreorderGuestToken,
  createPreorderGuestToken: mocks.createPreorderGuestToken,
}))
vi.mock('@/lib/email/emailService', () => ({ sendEmail: mocks.sendEmail }))
vi.mock('@/lib/messaging/flags', () => ({ isMessagingFlagOn: mocks.isMessagingFlagOn }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: mocks.logAuditEvent }))
vi.mock('@/lib/logger', () => ({ logger: mocks.logger }))
vi.mock('@/lib/env', () => ({ getAppUrl: () => 'https://management.example.test' }))

import { POST as organiserPost } from '@/app/g/[token]/table-manage/food/route'
import { POST as guestPost } from '@/app/g/[token]/christmas-choice/save/route'
import { PreorderSaveScopeError } from '@/lib/table-bookings/preorder'

const BOOKING = '00000000-0000-4000-8000-000000000001'
const COVER_1 = '00000000-0000-4000-8000-0000000000c1'
const COVER_2 = '00000000-0000-4000-8000-0000000000c2'
const TURKEY = '00000000-0000-4000-8000-0000000000d1'
const STAMP = { createdAt: '2026-11-01T10:00:00.000Z', updatedAt: '2026-11-01T10:00:00.000Z' }

function cover(id: string, ordinal: number, over: Record<string, unknown> = {}) {
  return { id, tableBookingId: BOOKING, ordinal, guestName: null, dietaryNote: null, hasAllergies: null, allergyDetail: null, selections: [], ...STAMP, ...over }
}

function order(over: Record<string, unknown> = {}) {
  return {
    tableBookingId: BOOKING,
    bookingReference: 'TB-FIXTURE',
    // Friday 11 December 2026: the cutoff is noon on Friday 4 December.
    bookingDate: '2026-12-11',
    bookingTime: '19:00',
    partySize: 2,
    requiresPreorder: true,
    hasGuestSeats: true,
    bookingAllergies: [],
    periodId: 'period-1',
    periodName: 'Christmas',
    preorderCutoffDays: 7,
    courseCounts: [0, 0],
    menuItems: [],
    covers: [cover(COVER_1, 1), cover(COVER_2, 2)],
    ...over,
  }
}

/** A chainable stand-in for the Supabase client, recording every write. */
function fakeDb(tables: Record<string, unknown>) {
  const writes: Array<{ table: string; op: string; values: unknown }> = []
  const from = (table: string) => {
    const builder: Record<string, unknown> = {}
    const chain = () => builder
    for (const method of ['select', 'eq', 'in', 'order', 'not']) builder[method] = chain
    builder.maybeSingle = async () => ({ data: tables[table] ?? null, error: null })
    builder.update = (values: unknown) => {
      writes.push({ table, op: 'update', values })
      return builder
    }
    builder.insert = (values: unknown) => {
      writes.push({ table, op: 'insert', values })
      return Promise.resolve({ error: null })
    }
    builder.then = (resolve: (value: unknown) => unknown) =>
      resolve({ data: Array.isArray(tables[table]) ? tables[table] : [], error: null })
    return builder
  }
  return { client: { from }, writes }
}

function jsonRequest(url: string, body: unknown) {
  return new NextRequest(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
}

function seatPayload(over: Record<string, unknown> = {}) {
  return {
    ordinal: 1,
    coverId: COVER_1,
    guestName: 'Fixture Sam',
    hasAllergies: false,
    allergyDetail: null,
    dietaryNote: null,
    courseCount: 1,
    starterId: null,
    mainId: TURKEY,
    dessertId: null,
    ...over,
  }
}

const organiser = (body: unknown) =>
  organiserPost(jsonRequest('http://localhost/g/manage-token/table-manage/food', body), { params: Promise.resolve({ token: 'manage-token' }) })
const guest = (body: unknown) =>
  guestPost(jsonRequest('http://localhost/g/guest-token/christmas-choice/save', body), { params: Promise.resolve({ token: 'guest-token' }) })

let db: ReturnType<typeof fakeDb>

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-20T10:00:00.000Z'))
  db = fakeDb({
    table_bookings: { id: BOOKING, status: 'confirmed', customer_id: 'customer-1', booking_time: '19:00', start_datetime: '2026-12-11T19:00:00.000Z' },
    customers: { id: 'customer-1', first_name: 'Fixture Organiser', email: 'organiser@example.test', email_status: 'valid', email_deactivated_at: null },
    booking_preorder_reminders: [],
  })
  mocks.createAdminClient.mockReturnValue(db.client)
  mocks.checkGuestTokenThrottle.mockResolvedValue({ allowed: true })
  mocks.getTableManagePreviewByRawToken.mockResolvedValue({ state: 'ready', table_booking_id: BOOKING, status: 'confirmed' })
  mocks.isPreorderEnabled.mockResolvedValue(true)
  mocks.syncPreorderCovers.mockResolvedValue({ removed: [] })
  mocks.loadPreorderOrder.mockResolvedValue(order())
  mocks.savePreorderCover.mockResolvedValue(cover(COVER_1, 1))
  mocks.resolvePreorderGuestToken.mockResolvedValue({ ok: true, tableBookingId: BOOKING, coverId: COVER_2, customerId: 'customer-1', expiresAt: '2026-12-04T12:00:00.000Z' })
  mocks.createPreorderGuestToken.mockResolvedValue({ rawToken: 'raw-guest-token', url: 'https://management.example.test/g/raw-guest-token/christmas-choice', expiresAt: '2026-12-04T12:00:00.000Z' })
  mocks.sendEmail.mockResolvedValue({ success: true })
  mocks.isMessagingFlagOn.mockResolvedValue(true)
})

describe("the guest's own link", () => {
  it('saves only the seat the link names, as the guest', async () => {
    const response = await guest({ seat: seatPayload({ ordinal: 2, coverId: COVER_2 }) })

    expect(response.status).toBe(200)
    expect(mocks.savePreorderCover).toHaveBeenCalledWith(
      db.client,
      expect.objectContaining({ coverId: COVER_2, tableBookingId: BOOKING, actor: { savedBy: 'guest', coverId: COVER_2 }, courseCount: 1 }),
    )
    // A guest save never touches who is sent a link.
    expect(mocks.savePreorderCover.mock.calls[0][1]).not.toHaveProperty('inviteEmail')
  })

  it("refuses another guest's seat, by number or by id, and saves nothing", async () => {
    const byId = await guest({ seat: seatPayload({ ordinal: 2, coverId: COVER_1 }) })
    const byNumber = await guest({ seat: seatPayload({ ordinal: 1, coverId: null }) })

    for (const response of [byId, byNumber]) {
      expect(response.status).toBe(403)
      expect(await response.json()).toEqual({ success: false, error: 'This link is for one guest only, so it cannot change anyone else.' })
    }
    expect(mocks.savePreorderCover).not.toHaveBeenCalled()
  })

  it('refuses a manage link, or any token that is not a guest food link', async () => {
    mocks.resolvePreorderGuestToken.mockResolvedValue({ ok: false, reason: 'invalid_token' })
    const response = await guest({ seat: seatPayload({ ordinal: 2, coverId: COVER_2 }) })
    expect(response.status).toBe(403)
    expect((await response.json()).error).toContain('01753 682707')
    expect(mocks.savePreorderCover).not.toHaveBeenCalled()
  })

  it('refuses a save after the noon cutoff, with the closed line', async () => {
    vi.setSystemTime(new Date('2026-12-04T12:00:01.000Z'))
    const response = await guest({ seat: seatPayload({ ordinal: 2, coverId: COVER_2 }) })

    expect(response.status).toBe(409)
    expect((await response.json()).error).toBe(
      'Choices closed at noon on Friday 4 December 2026. Call 01753 682707 if something needs to change.',
    )
    expect(mocks.savePreorderCover).not.toHaveBeenCalled()
  })

  it('passes a refusal from the save on in the guest\'s words', async () => {
    mocks.savePreorderCover.mockRejectedValue(new PreorderSaveScopeError('This link is for one guest only, so it cannot change anyone else.'))
    const response = await guest({ seat: seatPayload({ ordinal: 2, coverId: COVER_2 }) })
    expect(response.status).toBe(422)
    expect((await response.json()).error).toBe('This link is for one guest only, so it cannot change anyone else.')
  })
})

describe("the organiser's food page", () => {
  it('saves a line as the organiser, on the booking the link resolves to', async () => {
    const response = await organiser({ action: 'save', seat: seatPayload() })

    expect(response.status).toBe(200)
    expect(mocks.savePreorderCover).toHaveBeenCalledWith(
      db.client,
      expect.objectContaining({
        coverId: COVER_1,
        tableBookingId: BOOKING,
        actor: { savedBy: 'organiser' },
        guestName: 'Fixture Sam',
        hasAllergies: false,
        courseCount: 1,
        // A tier change sends every course, so the database's tier clear-up cannot drop a kept dish.
        selections: [
          { course: 'starter', menuItemId: null },
          { course: 'main', menuItemId: TURKEY },
          { course: 'dessert', menuItemId: null },
        ],
      }),
    )
    // Audited by seat number and dish id only, never a name.
    expect(JSON.stringify(mocks.logAuditEvent.mock.calls[0][0])).not.toContain('Fixture Sam')
  })

  it('refuses a seat id the page showed that no longer matches the seat number', async () => {
    const response = await organiser({ action: 'save', seat: seatPayload({ coverId: COVER_2 }) })
    expect(response.status).toBe(409)
    expect(mocks.savePreorderCover).not.toHaveBeenCalled()
  })

  it('refuses a save after the cutoff', async () => {
    vi.setSystemTime(new Date('2026-12-04T12:00:00.000Z'))
    const response = await organiser({ action: 'save', seat: seatPayload() })
    expect(response.status).toBe(409)
    expect((await response.json()).error).toContain('Choices closed at noon on Friday 4 December 2026')
    expect(mocks.savePreorderCover).not.toHaveBeenCalled()
  })

  it('refuses an invite address that does not look right, and sends nothing', async () => {
    const response = await organiser({ action: 'invite', ordinal: 1, coverId: COVER_1, email: 'not an email' })
    expect(response.status).toBe(422)
    expect((await response.json()).error).toBe("That email address doesn't look right. Check it and try again.")
    expect(mocks.createPreorderGuestToken).not.toHaveBeenCalled()
    expect(mocks.sendEmail).not.toHaveBeenCalled()
    expect(db.writes).toEqual([])
  })

  it('sends a link scoped to the seat, expiring at the cutoff, then records it and the ledger row', async () => {
    const response = await organiser({ action: 'invite', ordinal: 1, coverId: COVER_1, email: ' Guest@Example.TEST ' })

    expect(response.status).toBe(200)
    expect(mocks.createPreorderGuestToken).toHaveBeenCalledWith(db.client, expect.objectContaining({
      tableBookingId: BOOKING,
      coverId: COVER_1,
      expiresAt: '2026-12-04T12:00:00.000Z',
    }))
    const email = mocks.sendEmail.mock.calls[0][0]
    expect(email).toEqual(expect.objectContaining({ to: 'guest@example.test', customerId: null, tableBookingId: BOOKING, logRedactions: ['raw-guest-token'] }))
    expect(email.text).toContain('Fixture asked us to send you this link')
    expect(email.text).not.toContain('Organiser')
    expect(db.writes).toEqual([
      { table: 'booking_preorder_covers', op: 'update', values: { invite_email: 'guest@example.test', invite_sent_at: '2026-11-20T10:00:00.000Z' } },
      { table: 'booking_preorder_reminders', op: 'insert', values: { table_booking_id: BOOKING, kind: 'guest_invite', cover_id: COVER_1, sent_at: '2026-11-20T10:00:00.000Z' } },
    ])
  })

  it('tells the organiser when the email does not send, and records nothing as sent', async () => {
    mocks.sendEmail.mockResolvedValue({ success: false, error: 'provider down' })
    const response = await organiser({ action: 'invite', ordinal: 1, coverId: COVER_1, email: 'guest@example.test' })

    expect(response.status).toBe(422)
    const body = await response.json()
    expect(body.success).toBe(false)
    expect(body.error).toContain("We couldn't send that email just now")
    expect(body.error).toContain('01753 682707')
    expect(db.writes).toEqual([])
    expect(mocks.logger.error).toHaveBeenCalledWith('Christmas food link invite was not sent', expect.anything())
  })

  it('treats a thrown sender the same way', async () => {
    mocks.sendEmail.mockRejectedValue(new Error('network'))
    const response = await organiser({ action: 'invite', ordinal: 1, coverId: COVER_1, email: 'guest@example.test' })
    expect(response.status).toBe(422)
    expect(db.writes).toEqual([])
    expect(mocks.logger.error).toHaveBeenCalledWith('Christmas food link invite failed', expect.anything())
  })

  it('allows one resend per line, then refuses', async () => {
    const first = '2026-11-18T10:00:00.000Z'
    db = fakeDb({
      table_bookings: { id: BOOKING, status: 'confirmed', customer_id: 'customer-1', booking_time: '19:00', start_datetime: null },
      customers: { id: 'customer-1', first_name: 'Fixture', email: 'organiser@example.test', email_status: 'valid', email_deactivated_at: null },
      booking_preorder_reminders: [{ cover_id: COVER_1, sent_at: first }],
    })
    mocks.createAdminClient.mockReturnValue(db.client)

    mocks.loadPreorderOrder.mockResolvedValue(order({ covers: [cover(COVER_1, 1, { inviteSentAt: first }), cover(COVER_2, 2)] }))
    expect((await organiser({ action: 'invite', ordinal: 1, coverId: COVER_1, email: 'guest@example.test' })).status).toBe(200)
    // The resend moves the seat's time, not the ledger's first row.
    expect(db.writes.map((write) => write.table)).toEqual(['booking_preorder_covers'])

    mocks.sendEmail.mockClear()
    mocks.loadPreorderOrder.mockResolvedValue(order({ covers: [cover(COVER_1, 1, { inviteSentAt: '2026-11-20T10:00:00.000Z' }), cover(COVER_2, 2)] }))
    const again = await organiser({ action: 'invite', ordinal: 1, coverId: COVER_1, email: 'guest@example.test' })
    expect(again.status).toBe(422)
    expect((await again.json()).error).toContain("You've already resent this guest's link")
    expect(mocks.sendEmail).not.toHaveBeenCalled()
  })

  it('emails the organiser a copy, and refuses while the switch is off', async () => {
    const sent = await organiser({ action: 'copy' })
    expect(sent.status).toBe(200)
    expect(mocks.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'organiser@example.test', commType: 'table_booking_preorder_copy' }))
    // Before the cutoff the copy says choices can still change, never that they have closed.
    const copyText = JSON.stringify(mocks.sendEmail.mock.calls[0][0])
    expect(copyText).toContain('You can change them until noon on Friday 4 December 2026.')
    expect(copyText).not.toContain('Choices have now closed')

    mocks.sendEmail.mockClear()
    mocks.isMessagingFlagOn.mockResolvedValue(false)
    const off = await organiser({ action: 'copy' })
    expect(off.status).toBe(502)
    expect(mocks.sendEmail).not.toHaveBeenCalled()
  })

  it('says so when the copy does not send', async () => {
    mocks.sendEmail.mockResolvedValue({ success: false, error: 'provider down' })
    const response = await organiser({ action: 'copy' })
    expect(response.status).toBe(502)
    expect((await response.json()).error).toContain('01753 682707')
  })
})
