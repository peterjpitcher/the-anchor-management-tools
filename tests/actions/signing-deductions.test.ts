// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeDb, type FakeDb } from '../helpers/fakeSupabaseDb'

/**
 * Sending a proposed deposit deduction to the customer to agree (owner decision, 13 October
 * 2026). Nothing here may state a sum of money that might be wrong, so every doubt about the
 * deposit is a refusal, and nothing is sent for a deduction that has already been decided.
 */

type Row = Record<string, unknown>

const mocks = vi.hoisted(() => ({
  client: null as unknown,
  user: vi.fn(),
  canSend: vi.fn(),
  canView: vi.fn(),
  sendTemplate: vi.fn(),
  listSubject: vi.fn(),
  audit: vi.fn(),
  revalidate: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: mocks.audit }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => mocks.client }))
vi.mock('@/lib/signing/staff', () => ({
  getSigningStaffUser: mocks.user,
  canSendSigningKind: mocks.canSend,
  canViewSigningKind: mocks.canView,
}))
vi.mock('@/lib/signing/send-template', () => ({ sendTemplateSigningRequest: mocks.sendTemplate }))
vi.mock('@/lib/signing/service', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/signing/service')>()
  return { ...original, listSigningDocumentsForSubject: mocks.listSubject }
})

import { getDeductionAgreements, sendDeductionForAgreement } from '@/app/actions/signing-deductions'
import { SigningError } from '@/lib/signing/service'
import { TEMPLATE_MERGE_FIELDS } from '@/lib/signing/template-fields'
import { TemplateMergeError, findMergeFields, mergeTemplateText } from '@/lib/signing/template-render'

const BOOKING = '33333333-3333-4333-8333-333333333333'
const DEDUCTION = '77777777-7777-4777-8777-777777777777'
const OTHER_DEDUCTION = '88888888-8888-4888-8888-888888888888'
const STAFF = { id: '99999999-9999-4999-8999-999999999999', email: 'peter@example.test', name: 'Peter Pitcher', position: 'Director' }
const sent = { documentId: 'doc-1', version: 1, deliveries: [{ partyId: 'p1', name: 'Alex Host', email: 'alex@example.com', email_status: 'sent' }] }

let db: FakeDb

function bookingRow(extra: Row = {}): Row {
  return {
    id: BOOKING,
    customer_id: 'cust-1',
    customer_name: 'Alex Host',
    customer_first_name: 'Alex',
    customer_last_name: 'Host',
    contact_email: 'alex@example.com',
    contact_phone: '+447700900123',
    event_date: '2026-12-05',
    event_type: 'Birthday party',
    date_tbd: false,
    deposit_amount: 250,
    deposit_paid_date: '2026-09-01T10:00:00.000Z',
    invoice_id: null,
    invoice_deposit_treatment: null,
    ...extra,
  }
}

function deductionRow(extra: Row = {}): Row {
  return { id: DEDUCTION, booking_id: BOOKING, amount: 50, reason: 'Red wine on the function room carpet', status: 'proposed', ...extra }
}

function seed(tables: { booking?: Row | null; deduction?: Row | null; refunds?: Row[] } = {}): void {
  db = createFakeDb({
    private_bookings: tables.booking === null ? [] : [tables.booking ?? bookingRow()],
    private_booking_deductions: tables.deduction === null ? [] : [tables.deduction ?? deductionRow()],
    payment_refunds: tables.refunds ?? [],
  })
  mocks.client = db.client
}

function send(): ReturnType<typeof sendDeductionForAgreement> {
  return sendDeductionForAgreement({ deductionId: DEDUCTION })
}

beforeEach(() => {
  vi.clearAllMocks()
  seed()
  mocks.user.mockResolvedValue(STAFF)
  mocks.canSend.mockResolvedValue(true)
  mocks.canView.mockResolvedValue(true)
  mocks.audit.mockResolvedValue(undefined)
  mocks.sendTemplate.mockResolvedValue(sent)
  mocks.listSubject.mockResolvedValue([])
})

describe('sending a deduction to the customer to agree', () => {
  it('sends the template for that deduction, to the customer on the booking, filed under the booking', async () => {
    const result = await send()

    expect(result).toEqual({ success: true, data: { documentId: 'doc-1', deliveries: sent.deliveries } })
    expect(mocks.sendTemplate).toHaveBeenCalledTimes(1)
    const request = mocks.sendTemplate.mock.calls[0][0]
    expect(request).toMatchObject({
      kind: 'deposit_deduction_agreement',
      slug: 'deposit-deduction-agreement',
      subjectId: BOOKING,
      user: STAFF,
      // One series per deduction: sending again replaces this deduction's request and no other.
      seriesKey: `deduction:${DEDUCTION}`,
      // The amount goes in the title, so two requests on one booking can be told apart.
      titleSuffix: '£50.00',
    })
    expect(request.parties).toEqual([
      { role: 'customer', name: 'Alex Host', email: 'alex@example.com', phone: '+447700900123', customerId: 'cust-1' },
    ])
  })

  it('states the deduction, the deposit paid and what comes back, as money, and keeps the figures on the document', async () => {
    await send()

    const request = mocks.sendTemplate.mock.calls[0][0]
    expect(request.mergeValues).toEqual({
      customer_name: 'Alex Host',
      event_label: 'Birthday party on Saturday, 5 December 2026',
      deduction_amount: '£50.00',
      deposit_amount: '£250.00',
      deduction_reason: 'Red wine on the function room carpet',
      amount_to_return: '£200.00',
    })
    expect(request.context).toEqual({
      deduction_id: DEDUCTION,
      deduction_amount: 50,
      deduction_reason: 'Red wine on the function room carpet',
      deposit_amount: 250,
      amount_to_return: 200,
    })
    expect(request.summary).toBe(
      'We propose to keep £50.00 from your deposit for Birthday party on Saturday, 5 December 2026. Sign to agree, or decline and tell us why.'
    )
  })

  it('does the sum in pence, so pounds and pence come out exact', async () => {
    seed({ booking: bookingRow({ deposit_amount: '100.10' }), deduction: deductionRow({ amount: '33.35' }) })

    await send()

    const request = mocks.sendTemplate.mock.calls[0][0]
    expect(request.mergeValues).toMatchObject({ deduction_amount: '£33.35', deposit_amount: '£100.10', amount_to_return: '£66.75' })
    expect(request.context).toMatchObject({ deduction_amount: 33.35, deposit_amount: 100.1, amount_to_return: 66.75 })
  })

  it('allows a deduction of the whole deposit, leaving nothing to come back', async () => {
    seed({ deduction: deductionRow({ amount: 250 }) })

    expect((await send()).success).toBe(true)
    expect(mocks.sendTemplate.mock.calls[0][0].mergeValues.amount_to_return).toBe('£0.00')
  })

  it('names the event as "date to be confirmed" when the booking has no firm date', async () => {
    seed({ booking: bookingRow({ date_tbd: true }) })

    await send()

    expect(mocks.sendTemplate.mock.calls[0][0].mergeValues.event_label).toBe('Birthday party (date to be confirmed)')
  })

  it('sends a deduction that has already been discussed', async () => {
    seed({ deduction: deductionRow({ status: 'discussed' }) })

    expect((await send()).success).toBe(true)
  })

  it('writes an audit entry and refreshes the booking page', async () => {
    await send()

    expect(mocks.audit).toHaveBeenCalledWith({
      user_id: STAFF.id,
      user_email: STAFF.email,
      operation_type: 'send',
      resource_type: 'signing_document',
      resource_id: 'doc-1',
      operation_status: 'success',
      additional_info: { kind: 'deposit_deduction_agreement', version: 1, booking_id: BOOKING, deduction_id: DEDUCTION, deduction_amount: 50 },
    })
    expect(mocks.revalidate).toHaveBeenCalledWith(`/private-bookings/${BOOKING}`)
  })

  it('changes nothing on the deduction or the booking: the General Manager still decides', async () => {
    await send()

    expect(db.writes).toEqual([])
    expect(db.rows('private_booking_deductions')[0].status).toBe('proposed')
  })

  it('supplies every field the seeded wording uses, so the document can be filled once the gaps are', async () => {
    await send()

    const migration = readFileSync(join(process.cwd(), 'supabase/migrations/20261013170000_signing_deposit_deduction_agreement.sql'), 'utf8')
    const body = migration.split('$body$')[1]
    const supplied = { manager_name: STAFF.name, date_today: '13 October 2026', ...mocks.sendTemplate.mock.calls[0][0].mergeValues }
    expect(Object.keys(supplied).sort()).toEqual([...TEMPLATE_MERGE_FIELDS.deposit_deduction_agreement].sort())

    const merged = mergeTemplateText(body, supplied)
    expect(findMergeFields(merged)).toEqual([])
    expect(merged).toContain('We propose to keep £50.00 from your deposit of £250.00.')
    expect(merged).toContain('The reason: Red wine on the function room carpet')
    expect(merged).toContain('That would leave £200.00 to come back to you.')
    expect(merged).toContain('Alex Host, this is about the booking and damage deposit for Birthday party on Saturday, 5 December 2026 at The Anchor.')
  })
})

describe('what it refuses', () => {
  function expectNothingSent(): void {
    expect(mocks.sendTemplate).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
    expect(db.writes).toEqual([])
  }

  it('refuses an id that is not one', async () => {
    expect(await sendDeductionForAgreement({ deductionId: 'not-an-id' })).toEqual({ error: 'Unknown deduction.' })
    expect(mocks.user).not.toHaveBeenCalled()
    expectNothingSent()
  })

  it('refuses someone who is not signed in', async () => {
    mocks.user.mockResolvedValue(null)

    expect(await send()).toEqual({ error: 'Unauthorized' })
    expectNothingSent()
  })

  it('refuses someone without the permission, checked for this kind', async () => {
    mocks.canSend.mockResolvedValue(false)

    expect(await send()).toEqual({ error: 'Insufficient permissions' })
    expect(mocks.canSend).toHaveBeenCalledWith('deposit_deduction_agreement', STAFF.id)
    expectNothingSent()
  })

  it('refuses a deduction that does not exist', async () => {
    seed({ deduction: null })

    expect(await send()).toEqual({ error: 'Deduction not found.' })
    expectNothingSent()
  })

  it.each(['approved', 'rejected', 'applied'])('refuses a deduction that is already %s', async (status) => {
    seed({ deduction: deductionRow({ status }) })

    expect(await send()).toEqual({ error: 'This deduction has already been decided, so it cannot be sent to the customer.' })
    expectNothingSent()
  })

  it('refuses when the booking is gone', async () => {
    seed({ booking: null })

    expect(await send()).toEqual({ error: 'Booking not found.' })
    expectNothingSent()
  })

  it('refuses a booking with no customer name', async () => {
    seed({ booking: bookingRow({ customer_name: null, customer_first_name: null, customer_last_name: ' ' }) })

    expect(await send()).toEqual({ error: "Add the customer's name to the booking first." })
    expectNothingSent()
  })

  it.each([null, '', '   '])('refuses a booking with no customer email (%j)', async (email) => {
    seed({ booking: bookingRow({ contact_email: email }) })

    expect(await send()).toEqual({
      error: 'This booking has no email address for the customer. Add one to the booking, then send the deduction again.',
    })
    expectNothingSent()
  })

  it.each([
    ['no paid date', { deposit_paid_date: null }],
    ['no amount', { deposit_amount: null }],
    ['an amount of nought', { deposit_amount: 0 }],
    ['an amount that is not a number', { deposit_amount: 'lots' }],
  ])('refuses when the deposit paid cannot be determined: %s', async (_case, extra) => {
    seed({ booking: bookingRow(extra) })

    expect(await send()).toEqual({
      error: 'This booking has no deposit recorded as paid, so there is nothing to deduct from. Record the deposit on the booking first.',
    })
    expectNothingSent()
  })

  it('refuses when the deposit was put towards the bill, so none of it is held', async () => {
    seed({ booking: bookingRow({ invoice_id: 'inv-1', invoice_deposit_treatment: 'deducted' }) })

    expect((await send()).error).toBe('The deposit on this booking was put towards the bill, so none of it is held to deduct from.')
    expectNothingSent()
  })

  it('still sends when the booking has an invoice and the deposit is held separately', async () => {
    seed({ booking: bookingRow({ invoice_id: 'inv-1', invoice_deposit_treatment: 'held_separately' }) })

    expect((await send()).success).toBe(true)
  })

  it.each(['completed', 'pending'])('refuses when some of the deposit has a %s refund, so what comes back cannot be stated', async (status) => {
    seed({ refunds: [{ id: 'r1', source_type: 'private_booking', source_id: BOOKING, status, amount: 100 }] })

    expect((await send()).error).toContain('Some of this deposit has already been refunded')
    expectNothingSent()
  })

  it('is not put off by a refund that failed, or by a refund on something else', async () => {
    seed({
      refunds: [
        { id: 'r1', source_type: 'private_booking', source_id: BOOKING, status: 'failed', amount: 100 },
        { id: 'r2', source_type: 'table_booking', source_id: BOOKING, status: 'completed', amount: 100 },
        { id: 'r3', source_type: 'private_booking', source_id: 'another-booking', status: 'completed', amount: 100 },
      ],
    })

    expect((await send()).success).toBe(true)
  })

  it('refuses a deduction that is more than the deposit paid', async () => {
    seed({ deduction: deductionRow({ amount: 250.01 }) })

    expect(await send()).toEqual({ error: 'This deduction is more than the deposit paid (£250.00), so it cannot be sent as it is.' })
    expectNothingSent()
  })

  function otherRequest(extra: Row = {}): Row {
    return { id: 'doc-9', kind: 'deposit_deduction_agreement', status: 'sent', context: { deduction_id: OTHER_DEDUCTION }, parties: [], ...extra }
  }

  it.each(['sent', 'part_signed'])('refuses while another deduction on the booking has a request that is %s', async (status) => {
    mocks.listSubject.mockResolvedValue([otherRequest({ status })])

    expect(await send()).toEqual({
      error:
        'Another deduction on this booking is already with the customer to agree, and the amounts coming back would not add up if both were out at once. Wait for that one to be signed, or withdraw it under Signatures, then send this one.',
    })
    expect(mocks.listSubject).toHaveBeenCalledWith('private_booking', BOOKING)
    expectNothingSent()
  })

  it.each(['completed', 'declined', 'voided', 'expired', 'superseded'])(
    'is not held up by another deduction whose request is %s',
    async (status) => {
      mocks.listSubject.mockResolvedValue([otherRequest({ status })])

      expect((await send()).success).toBe(true)
    }
  )

  it('is not held up by its own open request (sending again replaces it), or by an open contract', async () => {
    mocks.listSubject.mockResolvedValue([
      otherRequest({ context: { deduction_id: DEDUCTION } }),
      otherRequest({ id: 'doc-8', kind: 'private_booking_contract', context: {} }),
    ])

    expect((await send()).success).toBe(true)
    expect(mocks.sendTemplate.mock.calls[0][0].seriesKey).toBe(`deduction:${DEDUCTION}`)
  })

  it('fails, and sends nothing, when the other requests cannot be read', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.listSubject.mockRejectedValue(new Error('Could not read signing documents: database down'))

    expect(await send()).toEqual({ error: 'Could not read signing documents: database down' })
    expectNothingSent()
    logged.mockRestore()
  })

  it('refuses a deduction with no reason', async () => {
    seed({ deduction: deductionRow({ reason: '  ' }) })

    expect(await send()).toEqual({ error: 'This deduction has no amount or no reason, so it cannot be sent.' })
    expectNothingSent()
  })

  it('passes on the reason when the template is switched off, in the words the signing service uses', async () => {
    const message = 'The "Deposit deduction agreement" template is switched off. Check its wording and switch it on in Settings, Signing templates.'
    mocks.sendTemplate.mockRejectedValue(new SigningError('template_inactive', message))

    expect(await send()).toEqual({ error: message })
    expect(mocks.audit).not.toHaveBeenCalled()
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })

  it('says which details are missing when the wording asks for one that has no value', async () => {
    mocks.sendTemplate.mockRejectedValue(new TemplateMergeError(['deposit_amount']))

    expect(await send()).toEqual({ error: 'This document needs details that are missing: deposit_amount.' })
  })

  it.each([
    ['private_booking_deductions', 'Could not read the deduction: database down'],
    ['private_bookings', 'Could not read the booking: database down'],
    ['payment_refunds', 'Could not read the deposit refunds: database down'],
  ])('fails, and sends nothing, when %s cannot be read', async (table, message) => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    db.failNext({ table, operation: 'select', message: 'database down' })

    expect(await send()).toEqual({ error: message })
    expectNothingSent()
    logged.mockRestore()
  })
})

describe('where each deduction has got to with the customer', () => {
  function document(extra: Row): Row {
    return {
      id: 'doc-1',
      kind: 'deposit_deduction_agreement',
      status: 'sent',
      version: 1,
      context: { deduction_id: DEDUCTION },
      sent_at: '2026-10-13T10:00:00.000Z',
      completed_at: null,
      voided_at: null,
      void_reason: null,
      expires_at: '2026-11-12T10:00:00.000Z',
      parties: [{ status: 'pending', decline_reason: null }],
      ...extra,
    }
  }

  it('gives the latest request for each deduction, and leaves the booking\'s other documents out', async () => {
    mocks.listSubject.mockResolvedValue([
      document({ id: 'doc-2', version: 2, status: 'declined', parties: [{ status: 'declined', decline_reason: 'The stain was there before' }] }),
      document({ id: 'doc-1', version: 1, status: 'superseded' }),
      document({ id: 'doc-3', context: { deduction_id: OTHER_DEDUCTION }, status: 'voided', voided_at: '2026-10-13T11:00:00.000Z', void_reason: 'Sent in error' }),
      document({ id: 'doc-4', kind: 'private_booking_contract', context: {} }),
      document({ id: 'doc-5', context: {} }),
    ])

    const result = await getDeductionAgreements(BOOKING)

    expect(mocks.listSubject).toHaveBeenCalledWith('private_booking', BOOKING)
    expect(result.data?.canSend).toBe(true)
    expect(result.data?.agreements).toEqual([
      {
        deductionId: DEDUCTION,
        documentId: 'doc-2',
        status: 'declined',
        version: 2,
        sentAt: '2026-10-13T10:00:00.000Z',
        completedAt: null,
        voidedAt: null,
        expiresAt: '2026-11-12T10:00:00.000Z',
        declineReason: 'The stain was there before',
        withdrawnReason: null,
      },
      {
        deductionId: OTHER_DEDUCTION,
        documentId: 'doc-3',
        status: 'voided',
        version: 1,
        sentAt: '2026-10-13T10:00:00.000Z',
        completedAt: null,
        voidedAt: '2026-10-13T11:00:00.000Z',
        expiresAt: '2026-11-12T10:00:00.000Z',
        declineReason: null,
        withdrawnReason: 'Sent in error',
      },
    ])
  })

  it('takes the highest version whichever order the documents arrive in', async () => {
    mocks.listSubject.mockResolvedValue([document({ id: 'doc-1', version: 1, status: 'superseded' }), document({ id: 'doc-2', version: 2 })])

    expect((await getDeductionAgreements(BOOKING)).data?.agreements.map((agreement) => agreement.documentId)).toEqual(['doc-2'])
  })

  it('says whether this person may send, which is a separate permission from seeing', async () => {
    mocks.canSend.mockResolvedValue(false)

    expect((await getDeductionAgreements(BOOKING)).data).toEqual({ agreements: [], canSend: false })
    expect(mocks.canView).toHaveBeenCalledWith('deposit_deduction_agreement', STAFF.id)
  })

  it('refuses a bad id, someone not signed in, and someone who may not see private bookings', async () => {
    expect(await getDeductionAgreements('nope')).toEqual({ error: 'Unknown booking.' })
    mocks.canView.mockResolvedValue(false)
    expect(await getDeductionAgreements(BOOKING)).toEqual({ error: 'Insufficient permissions' })
    mocks.user.mockResolvedValue(null)
    expect(await getDeductionAgreements(BOOKING)).toEqual({ error: 'Unauthorized' })
    expect(mocks.listSubject).not.toHaveBeenCalled()
  })

  it('reports a failed read as an error, never as "nothing sent"', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.listSubject.mockRejectedValue(new Error('Could not read signing documents: database down'))

    expect(await getDeductionAgreements(BOOKING)).toEqual({ error: 'Could not read signing documents: database down' })
    logged.mockRestore()
  })
})
