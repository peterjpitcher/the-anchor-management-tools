// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeDb, type FakeDb } from '../helpers/fakeSupabaseDb'

type Row = Record<string, unknown>

const mocks = vi.hoisted(() => ({
  client: null as unknown,
  user: vi.fn(),
  canSend: vi.fn(),
  canView: vi.fn(),
  prepareWaiver: vi.fn(),
  createRequest: vi.fn(),
  listDocuments: vi.fn(),
  audit: vi.fn(),
  revalidate: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: mocks.audit }))
vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => mocks.client }))
vi.mock('@/lib/pdf-generator', () => ({ generatePDFFromHTML: vi.fn(), createPdfBrowser: vi.fn(), closePdfBrowser: vi.fn() }))
vi.mock('@/lib/signing/staff', () => ({
  getSigningStaffUser: mocks.user,
  canSendSigningKind: mocks.canSend,
  canViewSigningKind: mocks.canView,
}))
// Which pages make up the food agreement is pinned in tests/lib/signing/documents/booking-contract.test.ts.
vi.mock('@/lib/signing/documents/booking-contract', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/signing/documents/booking-contract')>()
  return { ...original, prepareBookingWaiver: mocks.prepareWaiver }
})
vi.mock('@/lib/signing/service', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/signing/service')>()
  return { ...original, createSigningRequest: mocks.createRequest, listSigningDocumentsForSubject: mocks.listDocuments }
})

import { getBookingSigningState, sendBookingWaiver } from '@/app/actions/signing-bookings'
import { WAIVER_TITLE } from '@/lib/signing/documents/booking-contract'
import { SigningError } from '@/lib/signing/service'

const BOOKING = '33333333-3333-4333-8333-333333333333'
const STAFF = { id: '99999999-9999-4999-8999-999999999999', email: 'billy@example.test', name: 'Billy Summers', position: 'General Manager' }
const RENDER = { html: '<p>contract and food agreement</p>', profile: 'a4_css_page', pages: { onlyLast: 1, total: 5 }, slots: { 'waiver:organiser': 'customer' }, hasInitials: false }
const SENT = {
  documentId: 'doc-waiver',
  version: 1,
  deliveries: [{ partyId: 'party-1', name: 'Sam Example', email: 'sam@example.com', email_status: 'sent' }],
}

let db: FakeDb

function bookingRow(extra: Row = {}): Row {
  return {
    id: BOOKING,
    customer_id: 'cust-1',
    customer_first_name: 'Sam',
    customer_last_name: 'Example',
    customer_name: 'Sam Example',
    contact_email: 'sam@example.com',
    contact_phone: '+447700900123',
    event_date: '2026-12-05',
    event_type: 'Birthday party',
    outside_food: true,
    waiver_status: 'required',
    items: [],
    ...extra,
  }
}

function seed(booking: Row): void {
  db = createFakeDb({ private_bookings: [booking] })
  mocks.client = db.client
  // The action prepares the food agreement from the booking as it stands.
  mocks.prepareWaiver.mockResolvedValue({ prepared: { pdf: Buffer.from('%PDF food agreement'), render: RENDER }, booking })
}

function saved(): Row {
  return db.rows('private_bookings')[0]
}

function waiverAudit(): Row[] {
  return db.rows('private_booking_audit').filter((row) => row.field_name === 'waiver_status')
}

beforeEach(() => {
  vi.resetAllMocks()
  // The action logs an unexpected failure to the console as well as returning it.
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  mocks.user.mockResolvedValue(STAFF)
  mocks.canSend.mockResolvedValue(true)
  mocks.canView.mockResolvedValue(true)
  mocks.audit.mockResolvedValue(undefined)
  mocks.listDocuments.mockResolvedValue([])
  mocks.createRequest.mockResolvedValue(SENT)
  seed(bookingRow())
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the signing state of a booking', () => {
  it.each([
    // stored status, "Outside food" tick, food agreement applies, still outstanding
    ['not_required', false, false, false],
    // Ticked before the tick counted: stored as not required, but the agreement is owed.
    ['not_required', true, true, true],
    ['required', true, true, true],
    ['sent', true, true, true],
    ['overdue', true, true, true],
    ['signed', true, true, false],
  ])('for a status of %s with the tick %s: applies %s, outstanding %s', async (status, outsideFood, required, outstanding) => {
    seed(bookingRow({ waiver_status: status, outside_food: outsideFood }))

    const result = await getBookingSigningState(BOOKING)

    expect(result.success).toBe(true)
    expect(result.data).toMatchObject({ waiverRequired: required, waiverOutstanding: outstanding })
  })

  it('counts a catering package that needs the agreement, with no tick', async () => {
    seed(bookingRow({
      outside_food: false,
      waiver_status: 'required',
      items: [{ item_type: 'catering', package: { id: 'pkg-own-food', name: 'Guests bring food', requires_waiver: true } }],
    }))

    expect((await getBookingSigningState(BOOKING)).data).toMatchObject({ waiverRequired: true, waiverOutstanding: true })
  })

  it('returns the documents sent for this booking, and whether there is an address to send to', async () => {
    const documents = [{ id: 'doc-1', kind: 'private_booking_contract', status: 'sent', parties: [] }]
    mocks.listDocuments.mockResolvedValue(documents)

    const result = await getBookingSigningState(BOOKING)

    expect(mocks.listDocuments).toHaveBeenCalledWith('private_booking', BOOKING)
    expect(result.data).toMatchObject({ documents, hasEmail: true, canSend: true, waiverStatus: 'required' })

    seed(bookingRow({ contact_email: null }))
    expect((await getBookingSigningState(BOOKING)).data?.hasEmail).toBe(false)
  })

  it('says whether this person may send the food agreement', async () => {
    mocks.canSend.mockResolvedValue(false)

    const result = await getBookingSigningState(BOOKING)

    expect(result.data?.canSend).toBe(false)
    expect(mocks.canSend).toHaveBeenCalledWith('private_booking_waiver', STAFF.id)
  })

  it('is refused to someone who is not signed in, or who may not view booking contracts', async () => {
    mocks.user.mockResolvedValueOnce(null)
    expect(await getBookingSigningState(BOOKING)).toEqual({ error: 'Unauthorized' })

    mocks.canView.mockResolvedValueOnce(false)
    expect(await getBookingSigningState(BOOKING)).toEqual({ error: 'Insufficient permissions' })
    expect(mocks.canView).toHaveBeenCalledWith('private_booking_contract', STAFF.id)
    expect(mocks.listDocuments).not.toHaveBeenCalled()
  })

  it('refuses an id that is not a booking id, and a booking that does not exist', async () => {
    expect(await getBookingSigningState('not-a-booking')).toEqual({ error: 'Unknown booking.' })
    expect(await getBookingSigningState('44444444-4444-4444-8444-444444444444')).toEqual({ error: 'Booking not found.' })
  })

  it('reports a failed read, never an empty state', async () => {
    db.failNext({ table: 'private_bookings', operation: 'select', message: 'connection reset' })

    const result = await getBookingSigningState(BOOKING)

    expect(result).toEqual({ error: 'Could not read the booking: connection reset' })
    expect(result.data).toBeUndefined()
  })
})

describe('sending the food agreement on its own', () => {
  it('creates a request for the food agreement, to the customer, and lets the signing service email the link', async () => {
    const result = await sendBookingWaiver(BOOKING)

    expect(result).toEqual({ success: true, data: { documentId: 'doc-waiver', deliveries: SENT.deliveries } })
    expect(mocks.prepareWaiver).toHaveBeenCalledWith(BOOKING)
    expect(mocks.createRequest).toHaveBeenCalledTimes(1)
    const request = mocks.createRequest.mock.calls[0][0]
    expect(request).toMatchObject({
      kind: 'private_booking_waiver',
      subjectId: BOOKING,
      title: WAIVER_TITLE,
      parties: [{ role: 'customer', name: 'Sam Example', email: 'sam@example.com', phone: '+447700900123', customerId: 'cust-1' }],
      createdBy: STAFF.id,
      createdByName: 'Billy Summers',
    })
    expect(request.pdf.toString()).toBe('%PDF food agreement')
    expect(request.render).toBe(RENDER)
    expect(request.summary).toContain('signed separately from the contract')
    // Unlike Email Contract, nothing else carries the link, so the service must send it.
    expect(request.sendLinkEmails).toBeUndefined()
  })

  it.each([
    ['required', 'required'],
    // "Outside food" ticked before the tick counted (13 October 2026).
    ['not required', 'not_required'],
  ])('marks the food agreement sent from a status of %s, once the link has been emailed', async (_label, status) => {
    seed(bookingRow({ waiver_status: status }))

    expect((await sendBookingWaiver(BOOKING)).success).toBe(true)
    expect(saved().waiver_status).toBe('sent')
    expect(waiverAudit()).toEqual([
      expect.objectContaining({
        booking_id: BOOKING,
        action: 'field_updated',
        old_value: status,
        new_value: 'sent',
        performed_by: STAFF.id,
        metadata: { via: 'food_agreement_sent', contract_version: null },
      }),
    ])
  })

  it.each(['sent', 'overdue'])('sends again from a status of %s without changing it', async (status) => {
    seed(bookingRow({ waiver_status: status }))

    expect((await sendBookingWaiver(BOOKING)).success).toBe(true)
    expect(mocks.createRequest).toHaveBeenCalledTimes(1)
    expect(saved().waiver_status).toBe(status)
    expect(waiverAudit()).toHaveLength(0)
  })

  it('records the send in the audit log and refreshes the booking page', async () => {
    await sendBookingWaiver(BOOKING)

    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: STAFF.id,
        operation_type: 'send',
        resource_type: 'signing_document',
        resource_id: 'doc-waiver',
        operation_status: 'success',
        additional_info: { kind: 'private_booking_waiver', booking_id: BOOKING, version: 1 },
      })
    )
    expect(mocks.revalidate).toHaveBeenCalledWith(`/private-bookings/${BOOKING}`)
  })

  it('is refused to someone who is not signed in, or who may not send it, and does nothing', async () => {
    mocks.user.mockResolvedValueOnce(null)
    expect(await sendBookingWaiver(BOOKING)).toEqual({ error: 'Unauthorized' })

    mocks.canSend.mockResolvedValueOnce(false)
    expect(await sendBookingWaiver(BOOKING)).toEqual({ error: 'Insufficient permissions' })
    expect(mocks.canSend).toHaveBeenCalledWith('private_booking_waiver', STAFF.id)

    expect(await sendBookingWaiver('not-a-booking')).toEqual({ error: 'Unknown booking.' })

    expect(mocks.prepareWaiver).not.toHaveBeenCalled()
    expect(mocks.createRequest).not.toHaveBeenCalled()
    expect(db.writes).toHaveLength(0)
    expect(mocks.audit).not.toHaveBeenCalled()
  })

  it('refuses a booking that needs no food agreement, in words the user can act on', async () => {
    seed(bookingRow({ outside_food: false, waiver_status: 'not_required' }))
    mocks.prepareWaiver.mockRejectedValue(
      new SigningError('no_waiver', 'This booking has no outside food, so there is no food agreement to sign.')
    )

    expect(await sendBookingWaiver(BOOKING)).toEqual({
      error: 'This booking has no outside food, so there is no food agreement to sign.',
    })
    expect(mocks.createRequest).not.toHaveBeenCalled()
    expect(saved().waiver_status).toBe('not_required')
    expect(mocks.audit).not.toHaveBeenCalled()
  })

  it('refuses a food agreement that is already signed', async () => {
    seed(bookingRow({ waiver_status: 'signed' }))

    expect(await sendBookingWaiver(BOOKING)).toEqual({ error: 'The food agreement for this booking is already signed.' })
    expect(mocks.createRequest).not.toHaveBeenCalled()
    expect(saved().waiver_status).toBe('signed')
  })

  it('refuses a booking with no customer name to sign as', async () => {
    seed(bookingRow({ customer_first_name: null, customer_last_name: null, customer_name: null }))

    expect(await sendBookingWaiver(BOOKING)).toEqual({ error: 'Add the customer\'s name to the booking first.' })
    expect(mocks.createRequest).not.toHaveBeenCalled()
  })

  it.each([
    ['the email failed', { email_status: 'failed', email: 'sam@example.com', error: 'Mailbox unavailable' }, 'required'],
    ['the email failed, on a booking stored as not required', { email_status: 'failed', email: 'sam@example.com', error: 'Mailbox unavailable' }, 'not_required'],
    ['there is no address to send to', { email_status: 'none', email: null }, 'required'],
  ])('does not mark it sent, and tells the caller, when the request was created but %s', async (_label, delivery, status) => {
    seed(bookingRow({ waiver_status: status }))
    const deliveries = [{ partyId: 'party-1', name: 'Sam Example', ...delivery }]
    mocks.createRequest.mockResolvedValue({ documentId: 'doc-waiver', version: 1, deliveries })

    const result = await sendBookingWaiver(BOOKING)

    // The request exists, so it is not an error, but the result says the customer has no link.
    expect(result.success).toBe(true)
    expect(result.data?.deliveries).toEqual(deliveries)
    expect(result.data?.deliveries[0].email_status).toBe(delivery.email_status)
    // Nothing reached the customer, so the booking does not say the agreement was sent.
    expect(saved().waiver_status).toBe(status)
    expect(waiverAudit()).toHaveLength(0)
    // The request itself is still on the record.
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ resource_id: 'doc-waiver', operation_type: 'send' }))
  })

  it('reports a request that could not be created, and leaves the booking as it was', async () => {
    mocks.createRequest.mockRejectedValue(new Error('Could not store the document: bucket unavailable'))

    const result = await sendBookingWaiver(BOOKING)

    expect(result).toEqual({ error: 'Could not store the document: bucket unavailable' })
    expect(result.success).toBeUndefined()
    expect(saved().waiver_status).toBe('required')
    expect(waiverAudit()).toHaveLength(0)
    expect(mocks.audit).not.toHaveBeenCalled()
  })

  it('reports a contract that could not be divided safely, and creates nothing', async () => {
    mocks.prepareWaiver.mockRejectedValue(new Error('The document printed as 6 pages where 5 were expected, so its pages could not be divided safely'))

    const result = await sendBookingWaiver(BOOKING)

    expect(result.error).toContain('printed as 6 pages where 5 were expected')
    expect(mocks.createRequest).not.toHaveBeenCalled()
    expect(saved().waiver_status).toBe('required')
  })
})
