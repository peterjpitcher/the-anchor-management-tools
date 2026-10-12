// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeDb, type FakeDb } from '../helpers/fakeSupabaseDb'

const mocks = vi.hoisted(() => ({
  client: null as unknown,
  user: vi.fn(),
  canSend: vi.fn(),
  canView: vi.fn(),
  getQuote: vi.fn(),
  quotePdf: vi.fn(),
  createRequest: vi.fn(),
  sendTemplate: vi.fn(),
  listSeries: vi.fn(),
  audit: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: mocks.audit }))
vi.mock('@/app/actions/quotes', () => ({ getQuote: mocks.getQuote }))
vi.mock('@/lib/pdf-generator', () => ({ generateQuotePDF: mocks.quotePdf }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => mocks.client }))
vi.mock('@/lib/signing/staff', () => ({
  getSigningStaffUser: mocks.user,
  canSendSigningKind: mocks.canSend,
  canViewSigningKind: mocks.canView,
}))
vi.mock('@/lib/signing/send-template', () => ({ sendTemplateSigningRequest: mocks.sendTemplate }))
vi.mock('@/lib/signing/service', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/signing/service')>()
  return { ...original, createSigningRequest: mocks.createRequest, listSigningDocumentsForSeries: mocks.listSeries }
})

import {
  getBookingSupplierState,
  sendClientAgreement,
  sendQuoteForAcceptance,
  sendSupplierConfirmation,
} from '@/app/actions/signing-commercial'
import { sendJobOffer } from '@/app/actions/signing-recruitment'
import { SIGNING_COMPLETION_HOOKS } from '@/lib/signing/completion-hooks'
import type { SigningDocumentRow } from '@/lib/signing/types'

const QUOTE = '11111111-1111-4111-8111-111111111111'
const CLIENT = '22222222-2222-4222-8222-222222222222'
const BOOKING = '33333333-3333-4333-8333-333333333333'
const SUPPLIER = '44444444-4444-4444-8444-444444444444'
const OTHER_SUPPLIER = '55555555-5555-4555-8555-555555555555'
const APPLICATION = '66666666-6666-4666-8666-666666666666'
const STAFF = { id: '99999999-9999-4999-8999-999999999999', email: 'peter@example.test', name: 'Peter Pitcher' }
const signer = { signerName: 'Sam Client', signerEmail: 'sam@client.example' }
const sent = { documentId: 'doc-1', version: 1, deliveries: [{ partyId: 'p1', name: 'Sam Client', email: 'sam@client.example', email_status: 'sent' }] }

let db: FakeDb

function quote(status: string) {
  return { quote: { id: QUOTE, quote_number: 'Q-2026-014', status, valid_until: '2026-11-30', vendor_id: CLIENT } }
}

function document(overrides: Partial<SigningDocumentRow>): SigningDocumentRow {
  return { id: 'doc-1', subject_id: QUOTE, context: {}, ...overrides } as SigningDocumentRow
}

beforeEach(() => {
  vi.clearAllMocks()
  db = createFakeDb({
    quotes: [{ id: QUOTE, status: 'draft' }],
    invoice_vendors: [{ id: CLIENT, name: 'Golden Barrels Ltd' }],
    vendors: [
      { id: SUPPLIER, name: 'DJ Example', contact_name: 'Dee Jay', contact_email: 'dj@example.com' },
      { id: OTHER_SUPPLIER, name: 'Not On Booking', contact_name: null, contact_email: null },
    ],
    private_booking_items: [{ id: 'i1', booking_id: BOOKING, vendor_id: SUPPLIER, description: 'DJ, 7pm to midnight' }],
    private_bookings: [{
      id: BOOKING,
      event_date: '2026-12-05',
      date_tbd: false,
      contract_accepted_at: null,
      waiver_status: 'sent',
      items: [
        { description: 'DJ, 7pm to midnight', vendor: { id: SUPPLIER, name: 'DJ Example', contact_name: 'Dee Jay', contact_email: 'dj@example.com' } },
        { description: 'Lighting rig', vendor: { id: SUPPLIER, name: 'DJ Example', contact_name: 'Dee Jay', contact_email: 'dj@example.com' } },
        { description: 'Buffet', vendor: null },
      ],
    }],
    recruitment_applications: [{ id: APPLICATION, status: 'offered', candidate: { id: 'cand-1', first_name: 'Robin', last_name: 'Hopeful', email: 'robin@example.com' } }],
  })
  mocks.client = db.client
  mocks.user.mockResolvedValue(STAFF)
  mocks.canSend.mockResolvedValue(true)
  mocks.canView.mockResolvedValue(true)
  mocks.audit.mockResolvedValue(undefined)
  mocks.quotePdf.mockResolvedValue(Buffer.from('%PDF quote'))
  mocks.createRequest.mockResolvedValue(sent)
  mocks.sendTemplate.mockResolvedValue(sent)
  mocks.listSeries.mockResolvedValue([])
  mocks.getQuote.mockResolvedValue(quote('draft'))
})

describe('sending a quote for acceptance', () => {
  it('sends the quote PDF itself and moves a draft to Sent', async () => {
    const result = await sendQuoteForAcceptance({ quoteId: QUOTE, ...signer })
    expect(result.success).toBe(true)
    const request = mocks.createRequest.mock.calls[0][0]
    expect(request).toMatchObject({ kind: 'quote_acceptance', subjectId: QUOTE, title: 'Quote Q-2026-014' })
    expect(request.pdf.toString()).toBe('%PDF quote')
    expect(request.parties).toEqual([{ role: 'client', name: 'Sam Client', email: 'sam@client.example' }])
    expect(request.summary).toContain('Monday, 30 November 2026')
    expect(db.rows('quotes')[0].status).toBe('sent')
  })

  it('refuses a quote that is already accepted, rejected or expired', async () => {
    for (const [status, words] of [['accepted', 'already been accepted'], ['rejected', 'rejected'], ['expired', 'expired']] as const) {
      mocks.getQuote.mockResolvedValue(quote(status))
      expect((await sendQuoteForAcceptance({ quoteId: QUOTE, ...signer })).error).toContain(words)
    }
    expect(mocks.createRequest).not.toHaveBeenCalled()
  })

  it('needs permission and a real email address', async () => {
    mocks.canSend.mockResolvedValueOnce(false)
    expect(await sendQuoteForAcceptance({ quoteId: QUOTE, ...signer })).toEqual({ error: 'Insufficient permissions' })
    expect((await sendQuoteForAcceptance({ quoteId: QUOTE, signerName: 'Sam Client', signerEmail: 'nope' })).error).toContain('email')
    expect(mocks.createRequest).not.toHaveBeenCalled()
  })

  it('marks the quote Accepted when signed, but leaves one staff have since changed', async () => {
    db.rows('quotes')[0].status = 'sent'
    await SIGNING_COMPLETION_HOOKS.quote_acceptance(document({ subject_id: QUOTE }), [])
    expect(db.rows('quotes')[0].status).toBe('accepted')

    db.rows('quotes')[0].status = 'rejected'
    await SIGNING_COMPLETION_HOOKS.quote_acceptance(document({ subject_id: QUOTE }), [])
    expect(db.rows('quotes')[0].status).toBe('rejected')
  })
})

describe('client agreements', () => {
  const details = { vendorId: CLIENT, ...signer, servicesSummary: 'Monthly marketing support.', feesSummary: '£500 a month plus VAT.', startDate: '2026-11-01' }

  it('fills the template with the client and the terms typed in', async () => {
    expect((await sendClientAgreement(details)).success).toBe(true)
    expect(mocks.sendTemplate.mock.calls[0][0]).toMatchObject({
      kind: 'client_agreement',
      slug: 'client-agreement',
      subjectId: CLIENT,
      mergeValues: {
        client_name: 'Golden Barrels Ltd',
        services_summary: 'Monthly marketing support.',
        fees_summary: '£500 a month plus VAT.',
        start_date: 'Sunday, 1 November 2026',
      },
    })
  })

  it('refuses an unknown client and thin details', async () => {
    expect((await sendClientAgreement({ ...details, vendorId: '77777777-7777-4777-8777-777777777777' })).error).toBe('Client not found.')
    expect((await sendClientAgreement({ ...details, servicesSummary: 'short' })).error).toContain('work')
    expect((await sendClientAgreement({ ...details, startDate: '01/11/2026' })).error).toContain('start date')
    expect(mocks.sendTemplate).not.toHaveBeenCalled()
  })
})

describe('supplier confirmations', () => {
  const details = { bookingId: BOOKING, vendorId: SUPPLIER, signerName: 'Dee Jay', signerEmail: 'dj@example.com', serviceSummary: 'DJ, 7pm to midnight', eventDate: 'Saturday 5 December 2026, 6pm to midnight', feeSummary: '£300, paid on the night' }

  it('lists the suppliers on the booking, each once, with what they are providing', async () => {
    const result = await getBookingSupplierState(BOOKING)
    expect(result.data?.suppliers).toEqual([
      { vendorId: SUPPLIER, name: 'DJ Example', contactName: 'Dee Jay', contactEmail: 'dj@example.com', services: ['DJ, 7pm to midnight', 'Lighting rig'] },
    ])
    expect(result.data?.eventDate).toBe('Saturday, 5 December 2026')
    expect(mocks.listSeries).toHaveBeenCalledWith('vendor', `booking:${BOOKING}`)
  })

  it('files the confirmation under the supplier and the booking', async () => {
    expect((await sendSupplierConfirmation(details)).success).toBe(true)
    expect(mocks.sendTemplate.mock.calls[0][0]).toMatchObject({
      kind: 'supplier_confirmation',
      subjectId: SUPPLIER,
      seriesKey: `booking:${BOOKING}`,
      context: { private_booking_id: BOOKING },
      mergeValues: { supplier_name: 'DJ Example', fee_summary: '£300, paid on the night' },
    })
  })

  it('refuses a supplier who is not on the booking', async () => {
    expect((await sendSupplierConfirmation({ ...details, vendorId: OTHER_SUPPLIER })).error).toBe('That supplier is not on this booking.')
    expect(mocks.sendTemplate).not.toHaveBeenCalled()
  })
})

describe('job offers', () => {
  const offer = { applicationId: APPLICATION, jobTitle: 'Bar team member', startDate: '2026-11-02', payDetails: '£12.21 an hour, paid weekly.' }

  it('sends only once the application is at Offered', async () => {
    db.rows('recruitment_applications')[0].status = 'interviewed'
    expect((await sendJobOffer(offer)).error).toContain('Offered')
    expect(mocks.sendTemplate).not.toHaveBeenCalled()

    db.rows('recruitment_applications')[0].status = 'offered'
    expect((await sendJobOffer(offer)).success).toBe(true)
    expect(mocks.sendTemplate.mock.calls[0][0]).toMatchObject({
      kind: 'job_offer',
      subjectId: APPLICATION,
      parties: [{ role: 'candidate', name: 'Robin Hopeful', email: 'robin@example.com' }],
      mergeValues: { candidate_name: 'Robin Hopeful', job_title: 'Bar team member', start_date: 'Monday, 2 November 2026' },
      context: { candidate_id: 'cand-1' },
    })
  })

  it('needs the candidate to have an email address', async () => {
    ;(db.rows('recruitment_applications')[0].candidate as { email: string | null }).email = null
    expect((await sendJobOffer(offer)).error).toContain('email')
  })

  it('notes an accepted offer on the candidate without moving the application on', async () => {
    await SIGNING_COMPLETION_HOOKS.job_offer(
      document({ subject_id: APPLICATION, context: { candidate_id: 'cand-1' } }),
      [{ role: 'candidate', typed_name: 'Robin Hopeful' } as never]
    )
    expect(db.rows('recruitment_candidate_notes')[0]).toMatchObject({ candidate_id: 'cand-1', application_id: APPLICATION, kind: 'note' })
    expect(db.rows('recruitment_candidate_notes')[0].content).toContain('accepted by Robin Hopeful')
    expect(db.rows('recruitment_applications')[0].status).toBe('offered')
  })
})

describe('private booking hooks', () => {
  it('marks the contract accepted by e-signature, and the waiver signed when it was included', async () => {
    await SIGNING_COMPLETION_HOOKS.private_booking_contract(
      document({ subject_id: BOOKING, context: { contract_version: 3, includes_waiver: true } }),
      []
    )
    expect(db.rows('private_bookings')[0]).toMatchObject({ contract_acceptance_method: 'e_signature', waiver_status: 'signed' })
    expect(db.rows('private_bookings')[0].contract_accepted_at).toBeTruthy()
    expect(db.rows('private_booking_audit').map((row) => row.action)).toEqual(['contract_accepted', 'field_updated'])
  })

  it('never overwrites an acceptance already made by paying the deposit', async () => {
    Object.assign(db.rows('private_bookings')[0], { contract_accepted_at: '2026-10-01T10:00:00.000Z', contract_acceptance_method: 'deposit_payment' })
    await SIGNING_COMPLETION_HOOKS.private_booking_contract(document({ subject_id: BOOKING, context: { includes_waiver: false } }), [])
    expect(db.rows('private_bookings')[0]).toMatchObject({
      contract_accepted_at: '2026-10-01T10:00:00.000Z',
      contract_acceptance_method: 'deposit_payment',
      waiver_status: 'sent',
    })
    expect(db.rows('private_booking_audit')).toHaveLength(0)
  })

  it('is safe to run twice', async () => {
    const doc = document({ subject_id: BOOKING, context: { includes_waiver: true } })
    await SIGNING_COMPLETION_HOOKS.private_booking_contract(doc, [])
    const acceptedAt = db.rows('private_bookings')[0].contract_accepted_at
    await SIGNING_COMPLETION_HOOKS.private_booking_contract(doc, [])
    await SIGNING_COMPLETION_HOOKS.private_booking_waiver(doc, [])
    expect(db.rows('private_bookings')[0].contract_accepted_at).toBe(acceptedAt)
    expect(db.rows('private_booking_audit')).toHaveLength(2)
  })

  it('ticks the onboarding checklist when a worker agreement is signed', async () => {
    await SIGNING_COMPLETION_HOOKS.employment_agreement(document({ subject_id: 'emp-1' }), [])
    expect(db.rows('employee_onboarding_checklist')[0]).toMatchObject({ employee_id: 'emp-1', employee_agreement_accepted: true })
  })
})
