// @vitest-environment node
// Server code: Buffers and pdf-lib must share one set of typed-array classes, which jsdom splits.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { createFakeDb, type FakeDb } from '../helpers/fakeSupabaseDb'

/**
 * Email Contract, end to end against fake rows: the real contract template, the real division
 * into documents, the real signing service and the real contract email. Only the edges are
 * stand-ins: the database, file storage, the PDF browser and the email transport. Nothing here
 * can reach a customer.
 *
 * The case that matters is the owner's first live test (13 October 2026): a booking with
 * "Outside food" ticked and no catering package was sent a contract with no food agreement.
 */

type Row = Record<string, unknown>

const state = vi.hoisted(() => {
  // env.ts reads the app URL once, when it is first imported, so it is set before any import.
  process.env.NEXT_PUBLIC_APP_URL = 'https://management.example.com'
  return {
    client: null as unknown,
    user: null as { id: string; email: string } | null,
    sendEmail: vi.fn(),
    generatePdf: vi.fn(),
    permission: vi.fn(),
    audit: vi.fn(),
  }
})

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: state.permission }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: state.audit }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) } }),
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => state.client }))
vi.mock('@/lib/email/emailService', () => ({ sendEmail: state.sendEmail }))
// No browser: the "render" is a PDF with one page per sheet of the HTML it was given.
vi.mock('@/lib/pdf-generator', () => ({
  generatePDFFromHTML: state.generatePdf,
  createPdfBrowser: vi.fn(),
  closePdfBrowser: vi.fn(),
}))
vi.mock('@/lib/private-bookings/payment-ledger', () => ({
  readBookingPaymentLedger: async () => ({ payments: [], appliedDepositAmount: 0 }),
}))
vi.mock('@/lib/cron/alerting', () => ({ reportCronFailure: vi.fn(async () => undefined) }))
vi.mock('@/lib/signing/completion-hooks', () => ({ runCompletionHook: vi.fn(async () => undefined) }))
vi.mock('@/lib/paypal', () => ({
  PAYPAL_DEFAULT_CURRENCY: 'GBP',
  createSimplePayPalOrder: vi.fn(),
  capturePayPalPayment: vi.fn(),
  getPayPalOrder: vi.fn(),
}))

import { sendBookingContract } from '@/app/actions/privateBookingActions'
import { hashSigningToken } from '@/lib/signing/tokens'

const BOOKING = '33333333-3333-4333-8333-333333333333'
const STAFF = '99999999-9999-4999-8999-999999999999'
const SIGNED_BUCKET = 'signed-documents'
const BOOKING_DOCUMENTS_BUCKET = 'private-booking-documents'
const SIGNING_LINK = /https:\/\/management\.example\.com\/sign\/([A-Za-z0-9_-]{43})/g

interface SentEmail {
  to: string
  subject: string
  html: string
  text: string
  attachments: Array<{ name: string; content: Buffer; contentType: string }>
  logRedactions: string[]
  privateBookingId: string
  commType: string
}

let db: FakeDb
let uploads: Array<{ bucket: string; path: string; content: Buffer }>
/** Which insert into signing_documents fails (1 is the contract, 2 the food agreement). */
let failDocumentInsert: number | null
let documentInserts: number
let createdAtTick: number

function bookingRow(extra: Row = {}): Row {
  return {
    id: BOOKING,
    status: 'draft',
    customer_id: 'cust-1',
    customer_first_name: 'Sam',
    customer_last_name: 'Example',
    customer_name: 'Sam Example',
    customer_full_name: 'Sam Example',
    contact_phone: '+447700900123',
    contact_email: 'sam@example.com',
    event_date: '2026-12-05',
    start_time: '18:00',
    end_time: '23:00',
    end_time_next_day: false,
    event_type: 'Birthday party',
    guest_count: 40,
    deposit_amount: 250,
    deposit_paid_date: null,
    balance_due_date: null,
    final_payment_date: null,
    discount_amount: 0,
    discount_type: null,
    date_tbd: false,
    internal_notes: null,
    contract_version: 0,
    contract_sent_at: null,
    contract_sent_to: null,
    outside_food: false,
    waiver_status: 'not_required',
    // The contract reads these as embedded relations; the fake hands the row back whole.
    customer: null,
    items: [],
    payments: [],
    ...extra,
  }
}

const WAIVER_PACKAGE_ITEM: Row = {
  item_type: 'catering',
  quantity: 40,
  unit_price: 0,
  line_total: 0,
  discount_value: 0,
  discount_type: null,
  description: 'Catering',
  package: { id: 'pkg-own-food', name: 'Guests bring food', requires_waiver: true },
}

function sheetCount(html: string): number {
  return (html.match(/<section class="sheet"/g) ?? []).length
}

/** A stand-in for the rendered PDF. Page N is 200 + N points wide, so each page can be told apart. */
async function renderedPdf(pages: number): Promise<Buffer> {
  const pdf = await PDFDocument.create()
  for (let page = 1; page <= pages; page += 1) pdf.addPage([200 + page, 300])
  return Buffer.from(await pdf.save())
}

/** Which pages of the rendered PDF a file holds, by their original page number. */
async function pageNumbers(pdf: Buffer): Promise<number[]> {
  const document = await PDFDocument.load(pdf)
  return document.getPages().map((page) => page.getWidth() - 200)
}

/** What signing_record_signature does for the business signing as it sends. The real one is tested on Postgres. */
function recordSignature(args: Row): { data: Row; error: null } {
  const party = db.rows('signing_parties').find((row) => row.id === args.p_party_id)
  if (!party) return { data: { ok: false, reason: 'not_found' }, error: null }
  Object.assign(party, { status: 'signed', method: args.p_method, typed_name: args.p_typed_name, signed_at: '2026-10-13T10:00:00.000Z' })
  const document = db.rows('signing_documents').find((row) => row.id === party.document_id) as Row
  const waiting = db.rows('signing_parties').some((row) => row.document_id === document.id && row.status !== 'signed')
  document.status = waiting ? 'part_signed' : 'completed'
  return { data: { ok: true, document_id: document.id, document_status: document.status, completed: !waiting }, error: null }
}

function seed(booking: Row): void {
  db = createFakeDb({
    private_bookings: [booking],
    employees: [{ id: 'emp-1', auth_user_id: STAFF, first_name: 'Billy', last_name: 'Summers', job_title: 'General Manager' }],
  })
  db.onRpc((name, args) => {
    if (name === 'increment_private_booking_contract_version') {
      const row = db.rows('private_bookings').find((candidate) => candidate.id === args.p_booking_id) as Row
      row.contract_version = Number(row.contract_version ?? 0) + 1
      return { data: row.contract_version, error: null }
    }
    if (name === 'signing_record_signature') return recordSignature(args)
    throw new Error(`Unexpected rpc ${name}`)
  })

  state.client = {
    from: (table: string) => {
      const real = db.client.from(table)
      return {
        ...real,
        // The database fills these in; the fake does not.
        insert: (payload: Row | Row[]) => {
          if (table === 'signing_documents') {
            documentInserts += 1
            if (documentInserts === failDocumentInsert) {
              db.failNext({ table, operation: 'insert', message: 'connection reset', times: 1 })
            }
          }
          const fill = (row: Row): Row => {
            createdAtTick += 1
            return {
              ...(table === 'signing_parties' ? { status: 'pending', email: null, hashed_token: null } : {}),
              created_at: `2026-10-13T10:00:${String(createdAtTick).padStart(2, '0')}.000Z`,
              ...row,
            }
          }
          return real.insert(Array.isArray(payload) ? payload.map(fill) : fill(payload))
        },
      }
    },
    rpc: db.client.rpc,
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, content: Buffer) => {
          uploads.push({ bucket, path, content: Buffer.from(content) })
          return { error: null }
        },
      }),
    },
  }
}

function sentEmail(): SentEmail {
  return state.sendEmail.mock.calls[0][0] as SentEmail
}

function documents(): Row[] {
  return db.rows('signing_documents')
}

function documentOfKind(kind: string): Row {
  const found = documents().find((row) => row.kind === kind)
  if (!found) throw new Error(`No signing document of kind ${kind}`)
  return found
}

function customerPartyOf(document: Row): Row {
  const found = db.rows('signing_parties').find((row) => row.document_id === document.id && row.role === 'customer')
  if (!found) throw new Error('No customer on the signing document')
  return found
}

function linkTokens(text: string): string[] {
  return Array.from(text.matchAll(SIGNING_LINK)).map((match) => match[1])
}

function savedBooking(): Row {
  return db.rows('private_bookings')[0]
}

/** The audit rows for the food agreement status. Generating a contract writes other rows; these are only the status changes. */
function waiverAudit(): Row[] {
  return db.rows('private_booking_audit').filter((row) => row.field_name === 'waiver_status')
}

beforeEach(() => {
  vi.clearAllMocks()
  uploads = []
  failDocumentInsert = null
  documentInserts = 0
  createdAtTick = 0
  state.user = { id: STAFF, email: 'billy@example.test' }
  state.permission.mockResolvedValue(true)
  state.audit.mockResolvedValue(undefined)
  state.sendEmail.mockResolvedValue({ success: true, messageId: 'm1' })
  state.generatePdf.mockImplementation(async (html: string) => renderedPdf(sheetCount(html)))
  seed(bookingRow())
})

describe('emailing the contract for a booking with outside food', () => {
  it.each([
    ['the "Outside food" tick alone, stored as not required', bookingRow({ outside_food: true, waiver_status: 'not_required' })],
    ['a catering package that needs the agreement', bookingRow({ items: [WAIVER_PACKAGE_ITEM], waiver_status: 'required' })],
  ])('sends the contract and the food agreement as two requests in one email: %s', async (_label, booking) => {
    seed(booking)

    const result = await sendBookingContract(BOOKING)

    expect(result).toEqual({ success: true, version: 1, foodAgreementIncluded: true })

    // Two documents to sign, each open, each for this booking and this version of the contract.
    expect(documents().map((row) => row.kind)).toEqual(['private_booking_contract', 'private_booking_waiver'])
    const contract = documentOfKind('private_booking_contract')
    const waiver = documentOfKind('private_booking_waiver')
    for (const document of [contract, waiver]) {
      expect(document).toMatchObject({ subject_type: 'private_booking', subject_id: BOOKING, created_by: STAFF })
      expect((document.context as Row).contract_version).toBe(1)
    }
    // The Anchor signs the contract as it is sent; the food agreement is the customer's alone.
    expect(contract.status).toBe('part_signed')
    expect(waiver.status).toBe('sent')
    expect(db.rows('signing_parties').filter((row) => row.document_id === contract.id).map((row) => row.role)).toEqual(['customer', 'company'])
    expect(db.rows('signing_parties').filter((row) => row.document_id === waiver.id).map((row) => row.role)).toEqual(['customer'])
    expect(customerPartyOf(contract)).toMatchObject({ name: 'Sam Example', email: 'sam@example.com', customer_id: 'cust-1' })
    expect(customerPartyOf(waiver)).toMatchObject({ name: 'Sam Example', email: 'sam@example.com', customer_id: 'cust-1' })

    // One email, and only one: the signing service sends no link emails of its own.
    expect(state.sendEmail).toHaveBeenCalledTimes(1)
    const email = sentEmail()
    expect(email.to).toBe('sam@example.com')
    expect(email.subject).toBe('Your booking contract: Birthday party on Saturday, 5 December 2026')
    expect(email.commType).toBe('private_booking_contract')
    expect(email.privateBookingId).toBe(BOOKING)

    // Both links, in order, and each one opens its own document.
    const tokens = linkTokens(email.html)
    expect(tokens).toHaveLength(2)
    expect(tokens[0]).not.toBe(tokens[1])
    expect(hashSigningToken(tokens[0])).toBe(customerPartyOf(contract).hashed_token)
    expect(hashSigningToken(tokens[1])).toBe(customerPartyOf(waiver).hashed_token)
    expect(linkTokens(email.text)).toEqual(tokens)
    expect(email.html).toContain('1. Read and sign the contract')
    expect(email.html).toContain('2. Read and sign the food agreement')
    // Neither working link is kept in the stored copy of the email.
    expect(email.logRedactions).toEqual(tokens)

    // Both PDFs attached: the contract without the food agreement, and the food agreement alone.
    expect(email.attachments.map((attachment) => attachment.name)).toEqual([
      'The-Anchor-booking-contract-v1.pdf',
      'The-Anchor-self-catering-agreement-v1.pdf',
    ])
    const totalPages = sheetCount(String(state.generatePdf.mock.calls[0][0]))
    const contractPages = Array.from({ length: totalPages - 1 }, (_, index) => index + 1)
    expect(await pageNumbers(email.attachments[0].content)).toEqual(contractPages)
    expect(await pageNumbers(email.attachments[1].content)).toEqual([totalPages])

    // What was attached is exactly what each signer is shown.
    const stored = (path: unknown): Buffer => uploads.find((upload) => upload.bucket === SIGNED_BUCKET && upload.path === path)?.content as Buffer
    expect(stored(contract.source_pdf_path).equals(email.attachments[0].content)).toBe(true)
    expect(stored(waiver.source_pdf_path).equals(email.attachments[1].content)).toBe(true)

    // "Link sent" is on the record for each document, against the customer.
    const sentEvents = db.rows('signing_events').filter((row) => row.event === 'sent')
    expect(sentEvents).toHaveLength(2)
    expect(sentEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ document_id: contract.id, party_id: customerPartyOf(contract).id, actor_user_id: STAFF, meta: { to: 'sam@example.com' } }),
        expect.objectContaining({ document_id: waiver.id, party_id: customerPartyOf(waiver).id, actor_user_id: STAFF, meta: { to: 'sam@example.com' } }),
      ])
    )

    // The booking records the send. Only now, with the email gone, does it say the food agreement was sent.
    const saved = savedBooking()
    expect(saved.contract_sent_at).toBeTruthy()
    expect(saved.contract_sent_to).toBe('sam@example.com')
    expect(saved.waiver_status).toBe('sent')
    expect(waiverAudit()).toEqual([
      expect.objectContaining({
        booking_id: BOOKING,
        action: 'field_updated',
        old_value: booking.waiver_status,
        new_value: 'sent',
        performed_by: STAFF,
        metadata: { via: 'contract_sent', contract_version: 1 },
      }),
    ])
  })

  it.each(['sent', 'overdue'])('leaves a food agreement status of %s as it is when the contract is sent again', async (status) => {
    seed(bookingRow({ outside_food: true, waiver_status: status }))

    expect((await sendBookingContract(BOOKING)).success).toBe(true)

    expect(savedBooking().waiver_status).toBe(status)
    expect(waiverAudit()).toHaveLength(0)
  })

  it('renders the contract once, and keeps every sheet as the booking\'s own record', async () => {
    seed(bookingRow({ outside_food: true }))

    await sendBookingContract(BOOKING)

    expect(state.generatePdf).toHaveBeenCalledTimes(1)
    const snapshot = uploads.find((upload) => upload.bucket === BOOKING_DOCUMENTS_BUCKET && upload.path === `${BOOKING}/contract-v1.pdf`)
    expect(await pageNumbers(snapshot?.content as Buffer)).toEqual([1, 2, 3, 4, 5])
    expect(db.rows('private_booking_documents').find((row) => row.file_name === 'contract-v1.pdf')).toMatchObject({
      booking_id: BOOKING,
      version: 1,
      generated_by: STAFF,
      metadata: { sent_to: 'sam@example.com', includes_food_agreement: true },
    })
  })

  it('signs for The Anchor in the name and job title of whoever sent it', async () => {
    seed(bookingRow({ outside_food: true }))

    await sendBookingContract(BOOKING)

    const contract = documentOfKind('private_booking_contract')
    expect(db.rows('signing_parties').find((row) => row.document_id === contract.id && row.role === 'company')).toMatchObject({
      name: 'Billy Summers',
      status: 'signed',
      method: 'sender',
    })
    expect((contract.context as Row).sender_position).toBe('General Manager')
    expect(String(state.generatePdf.mock.calls[0][0])).toContain('Billy Summers, General Manager')
  })

  it('writes both signing documents into the audit entry', async () => {
    seed(bookingRow({ outside_food: true }))

    await sendBookingContract(BOOKING)

    expect(state.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        resource_id: BOOKING,
        additional_info: expect.objectContaining({
          action: 'contract_sent',
          contract_version: 1,
          signing_document_id: documentOfKind('private_booking_contract').id,
          food_agreement_signing_document_id: documentOfKind('private_booking_waiver').id,
        }),
      })
    )
  })
})

describe('emailing the contract when the food agreement is already signed', () => {
  it.each([
    ['"Outside food" ticked', bookingRow({ outside_food: true, waiver_status: 'signed' })],
    ['a catering package that needs the agreement', bookingRow({ outside_food: true, items: [WAIVER_PACKAGE_ITEM], waiver_status: 'signed' })],
  ])('sends the contract alone, and asks nobody to sign the agreement twice: %s', async (_label, booking) => {
    seed(booking)

    const result = await sendBookingContract(BOOKING)

    expect(result).toEqual({ success: true, version: 1, foodAgreementIncluded: false })

    // Exactly one request, for the contract. No food agreement request exists, open or otherwise.
    expect(documents().map((row) => row.kind)).toEqual(['private_booking_contract'])
    const contract = documentOfKind('private_booking_contract')
    expect(db.rows('signing_parties').every((row) => row.document_id === contract.id)).toBe(true)

    // One email with one button, for the contract.
    expect(state.sendEmail).toHaveBeenCalledTimes(1)
    const email = sentEmail()
    const tokens = linkTokens(email.html)
    expect(tokens).toHaveLength(1)
    expect(hashSigningToken(tokens[0])).toBe(customerPartyOf(contract).hashed_token)
    expect(linkTokens(email.text)).toEqual(tokens)
    expect(email.logRedactions).toEqual(tokens)
    expect(email.html).toContain('Read and sign online')
    expect(email.html).not.toContain('Read and sign the food agreement')
    expect(`${email.subject} ${email.html} ${email.text}`).not.toMatch(/food agreement|self-catering/i)

    // One attachment: the contract pages, without the food agreement page the template still prints.
    const totalSheets = sheetCount(String(state.generatePdf.mock.calls[0][0]))
    const contractPages = Array.from({ length: totalSheets - 1 }, (_, index) => index + 1)
    expect(state.generatePdf).toHaveBeenCalledTimes(1)
    expect(email.attachments.map((attachment) => attachment.name)).toEqual(['The-Anchor-booking-contract-v1.pdf'])
    expect(await pageNumbers(email.attachments[0].content)).toEqual(contractPages)

    // The copy kept for the booking is the contract pages only, and says so.
    const snapshot = uploads.find((upload) => upload.bucket === BOOKING_DOCUMENTS_BUCKET && upload.path === `${BOOKING}/contract-v1.pdf`)
    expect(await pageNumbers(snapshot?.content as Buffer)).toEqual(contractPages)
    expect(db.rows('private_booking_documents').find((row) => row.file_name === 'contract-v1.pdf')?.metadata).toEqual({
      sent_to: 'sam@example.com',
      includes_food_agreement: false,
    })

    // The signature already on record is left exactly as it was.
    expect(savedBooking()).toMatchObject({ waiver_status: 'signed', contract_sent_to: 'sam@example.com' })
    expect(waiverAudit()).toHaveLength(0)
    expect(db.rows('signing_events').filter((row) => row.event === 'sent')).toHaveLength(1)
    expect(state.audit).toHaveBeenCalledWith(
      expect.objectContaining({ additional_info: expect.objectContaining({ food_agreement_signing_document_id: null }) })
    )
  })
})

describe('emailing the contract for a booking with no outside food', () => {
  it('sends one request and one link, and says nothing about a food agreement', async () => {
    const result = await sendBookingContract(BOOKING)

    expect(result).toEqual({ success: true, version: 1, foodAgreementIncluded: false })
    expect(documents().map((row) => row.kind)).toEqual(['private_booking_contract'])

    expect(state.sendEmail).toHaveBeenCalledTimes(1)
    const email = sentEmail()
    const tokens = linkTokens(email.html)
    expect(tokens).toHaveLength(1)
    expect(hashSigningToken(tokens[0])).toBe(customerPartyOf(documentOfKind('private_booking_contract')).hashed_token)
    expect(email.logRedactions).toEqual(tokens)
    expect(email.html).toContain('Read and sign online')
    expect(`${email.subject} ${email.html} ${email.text}`).not.toMatch(/food agreement|self-catering/i)

    expect(email.attachments.map((attachment) => attachment.name)).toEqual(['The-Anchor-booking-contract-v1.pdf'])
    expect(await pageNumbers(email.attachments[0].content)).toEqual([1, 2, 3, 4])

    expect(db.rows('signing_events').filter((row) => row.event === 'sent')).toHaveLength(1)
    // Nothing about a food agreement is touched on a booking that has none.
    expect(savedBooking()).toMatchObject({ waiver_status: 'not_required', contract_sent_to: 'sam@example.com' })
    expect(waiverAudit()).toHaveLength(0)
    expect(db.rows('private_booking_documents').find((row) => row.file_name === 'contract-v1.pdf')?.metadata).toEqual({
      sent_to: 'sam@example.com',
      includes_food_agreement: false,
    })
    expect(state.audit).toHaveBeenCalledWith(
      expect.objectContaining({ additional_info: expect.objectContaining({ food_agreement_signing_document_id: null }) })
    )
  })
})

describe('when the contract cannot be sent', () => {
  it.each([
    ['the provider refuses it', () => state.sendEmail.mockResolvedValue({ success: false, error: 'Mailbox unavailable' }), 'Mailbox unavailable', 'not_required'],
    ['the provider cannot be reached', () => state.sendEmail.mockRejectedValue(new Error('Connection timed out')), 'Connection timed out', 'required'],
  ])('withdraws both requests and tells the user when the email fails: %s', async (_label, breakEmail, message, statusBefore) => {
    seed(bookingRow({ outside_food: true, waiver_status: statusBefore }))
    breakEmail()

    const result = await sendBookingContract(BOOKING)

    // The user sees the failure: never a false success.
    expect(result).toEqual({ error: message })
    expect(result.success).toBeUndefined()

    // Nobody has the links, so neither request is left looking live.
    expect(documents()).toHaveLength(2)
    for (const document of documents()) {
      expect(document).toMatchObject({ status: 'voided', voided_by: STAFF, void_reason: 'The contract email could not be sent' })
    }
    expect(db.rows('signing_events').filter((row) => row.event === 'voided')).toHaveLength(2)
    expect(db.rows('signing_events').filter((row) => row.event === 'sent')).toHaveLength(0)

    // And the booking does not claim the contract went, or that the food agreement did.
    expect(savedBooking()).toMatchObject({ contract_sent_at: null, contract_sent_to: null, waiver_status: statusBefore })
    expect(waiverAudit()).toHaveLength(0)
    expect(state.audit).not.toHaveBeenCalled()
  })

  it('withdraws the contract request and sends nothing when the food agreement request cannot be created', async () => {
    seed(bookingRow({ outside_food: true, waiver_status: 'required' }))
    failDocumentInsert = 2

    const result = await sendBookingContract(BOOKING)

    expect(result).toEqual({ error: 'Could not record the document: connection reset' })
    // The customer is never sent a contract with half of what they must sign.
    expect(state.sendEmail).not.toHaveBeenCalled()
    expect(documents().map((row) => row.kind)).toEqual(['private_booking_contract'])
    expect(documents()[0]).toMatchObject({ status: 'voided', void_reason: 'The food agreement could not be prepared with it' })
    expect(savedBooking()).toMatchObject({ contract_sent_at: null, contract_sent_to: null, waiver_status: 'required' })
    expect(waiverAudit()).toHaveLength(0)
  })

  it.each([
    ['with a food agreement', bookingRow({ outside_food: true, waiver_status: 'required' }), 6, 5],
    ['with no food agreement', bookingRow(), 5, 4],
  ])('sends nothing when a contract %s prints as more pages than it has sheets', async (_label, booking, printedPages, sheets) => {
    seed(booking)
    // A sheet has run onto a second page, so counting pages from the end would cut in the wrong place.
    state.generatePdf.mockResolvedValueOnce(await renderedPdf(printedPages))

    const result = await sendBookingContract(BOOKING)

    expect(result.success).toBeUndefined()
    expect(result.error).toContain(`The document printed as ${printedPages} pages where ${sheets} were expected`)
    expect(state.sendEmail).not.toHaveBeenCalled()
    expect(documents()).toHaveLength(0)
    expect(savedBooking()).toMatchObject({ contract_sent_at: null, contract_sent_to: null, waiver_status: booking.waiver_status })
    expect(waiverAudit()).toHaveLength(0)
  })

  it('sends nothing when the contract request itself cannot be created', async () => {
    seed(bookingRow({ outside_food: true, waiver_status: 'required' }))
    failDocumentInsert = 1

    const result = await sendBookingContract(BOOKING)

    expect(result).toEqual({ error: 'Could not record the document: connection reset' })
    expect(state.sendEmail).not.toHaveBeenCalled()
    expect(documents()).toHaveLength(0)
    expect(savedBooking().waiver_status).toBe('required')
    expect(waiverAudit()).toHaveLength(0)
  })
})

describe('who may email a contract, and for which bookings', () => {
  it('does nothing for someone who is not signed in', async () => {
    state.user = null

    expect(await sendBookingContract(BOOKING)).toEqual({ error: 'Unauthorized' })
    expect(db.writes).toHaveLength(0)
    expect(uploads).toHaveLength(0)
    expect(state.sendEmail).not.toHaveBeenCalled()
  })

  it('does nothing for someone without permission to send contracts', async () => {
    state.permission.mockResolvedValue(false)

    expect(await sendBookingContract(BOOKING)).toEqual({ error: 'You do not have permission to send contracts' })
    expect(state.permission).toHaveBeenCalledWith('private_bookings', 'generate_contracts')
    expect(state.permission).toHaveBeenCalledWith('private_bookings', 'manage')
    expect(db.writes).toHaveLength(0)
    expect(uploads).toHaveLength(0)
    expect(state.sendEmail).not.toHaveBeenCalled()
  })

  it('lets someone who manages private bookings send, without the contracts permission', async () => {
    state.permission.mockImplementation(async (_module: string, action: string) => action === 'manage')

    expect((await sendBookingContract(BOOKING)).success).toBe(true)
    expect(state.sendEmail).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['no contact email address', null],
    ['an empty contact email address', ''],
    // Spaces alone used to pass the check, and left a contract request open with no link to it.
    ['a contact email address that is only spaces', '   '],
  ])('sends nothing, and creates nothing to sign, for a booking with %s', async (_label, contactEmail) => {
    seed(bookingRow({ outside_food: true, waiver_status: 'required', contact_email: contactEmail }))

    expect(await sendBookingContract(BOOKING)).toEqual({
      error: 'This booking has no contact email address. Add one before sending the contract.',
    })
    expect(state.sendEmail).not.toHaveBeenCalled()
    // Not merely none left open: no signing request was created at all.
    expect(documents()).toHaveLength(0)
    expect(db.rows('signing_parties')).toHaveLength(0)
    expect(state.generatePdf).not.toHaveBeenCalled()
    // The booking does not say anything was sent.
    expect(savedBooking()).toMatchObject({ waiver_status: 'required', contract_sent_at: null, contract_sent_to: null })
    // A refused send mints no contract version (BK-158).
    expect(savedBooking().contract_version).toBe(0)
    expect(waiverAudit()).toHaveLength(0)
  })

  it('sends nothing for a booking with no customer name', async () => {
    seed(bookingRow({ outside_food: true, customer_first_name: null, customer_last_name: null, customer_name: null, customer_full_name: null }))

    expect(await sendBookingContract(BOOKING)).toEqual({ error: 'Add the customer\'s name before sending the contract.' })
    expect(state.sendEmail).not.toHaveBeenCalled()
    expect(documents()).toHaveLength(0)
    expect(savedBooking().waiver_status).toBe('not_required')
    expect(waiverAudit()).toHaveLength(0)
  })

  it('reports a booking that does not exist, and sends nothing', async () => {
    expect(await sendBookingContract('44444444-4444-4444-8444-444444444444')).toEqual({ error: 'Booking not found' })
    expect(state.sendEmail).not.toHaveBeenCalled()
    expect(documents()).toHaveLength(0)
  })
})

// BK-154, D25: the terms a contract names are kept, so a later change shows it as out of date.
describe('the terms the contract names', () => {
  const TERMS_NOW = {
    v: 1,
    event_date: '2026-12-05',
    start_time: '18:00',
    end_time: '23:00',
    end_time_next_day: false,
    guest_count: 40,
    space_ids: [],
    total: 0,
  }

  it('keeps them on the booking and with the signing request', async () => {
    expect((await sendBookingContract(BOOKING)).success).toBe(true)

    expect(savedBooking().contract_terms).toEqual(TERMS_NOW)
    expect((documentOfKind('private_booking_contract').context as Row).contract_terms).toEqual(TERMS_NOW)
  })

  it('replaces an acceptance of older terms, so the new version is signed and recorded, and keeps the old one on the audit trail', async () => {
    const oldTerms = { ...TERMS_NOW, guest_count: 30 }
    seed(bookingRow({
      contract_version: 1,
      contract_sent_at: '2026-10-01T10:00:00.000Z',
      contract_accepted_at: '2026-10-02T10:00:00.000Z',
      contract_acceptance_method: 'e_signature',
      contract_terms: oldTerms,
    }))

    expect((await sendBookingContract(BOOKING)).success).toBe(true)

    expect(savedBooking()).toMatchObject({ contract_version: 2, contract_accepted_at: null, contract_acceptance_method: null, contract_terms: TERMS_NOW })
    expect(db.rows('private_booking_audit').filter((row) => row.action === 'contract_acceptance_replaced')).toEqual([
      expect.objectContaining({
        booking_id: BOOKING,
        performed_by: STAFF,
        metadata: expect.objectContaining({
          changes: ['guest numbers'],
          replaced_by_version: 2,
          accepted_at: '2026-10-02T10:00:00.000Z',
          acceptance_method: 'e_signature',
          previous_terms: oldTerms,
        }),
      }),
    ])
  })

  it.each([
    ['the terms are unchanged', TERMS_NOW],
    ['the contract was sent before terms were kept', null],
  ])('leaves an acceptance alone when %s', async (_label, terms) => {
    seed(bookingRow({
      contract_version: 1,
      contract_sent_at: '2026-10-01T10:00:00.000Z',
      contract_accepted_at: '2026-10-02T10:00:00.000Z',
      contract_acceptance_method: 'e_signature',
      contract_terms: terms,
    }))

    expect((await sendBookingContract(BOOKING)).success).toBe(true)

    expect(savedBooking()).toMatchObject({ contract_accepted_at: '2026-10-02T10:00:00.000Z', contract_acceptance_method: 'e_signature' })
    expect(db.rows('private_booking_audit').some((row) => row.action === 'contract_acceptance_replaced')).toBe(false)
  })
})
