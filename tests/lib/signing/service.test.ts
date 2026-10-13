// @vitest-environment node
// Server code: Buffers and pdf-lib must share one set of typed-array classes, which jsdom splits.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { createFakeDb, type FakeDb } from '../../helpers/fakeSupabaseDb'

type Row = Record<string, unknown>

type AnyMock = import('vitest').Mock<(...args: any[]) => any>

const state = vi.hoisted(() => ({
  client: null as unknown,
  sendEmail: null as unknown as AnyMock,
  generatePdf: null as unknown as AnyMock,
  alert: null as unknown as AnyMock,
  hook: null as unknown as AnyMock,
  closure: null as unknown as AnyMock,
  closeBrowser: null as unknown as AnyMock,
  browser: { fake: 'browser' },
}))

vi.mock('@/lib/env', () => ({ getAppUrl: () => 'https://management.example.test' }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => state.client }))
vi.mock('@/lib/email/emailService', () => ({ sendEmail: (...args: unknown[]) => state.sendEmail(...args) }))
vi.mock('@/lib/email/invoice-sender', () => ({ invoiceEmailRouting: () => ({ from: 'Orange Jelly <billing@example.test>' }) }))
vi.mock('@/lib/pdf-generator', () => ({
  generatePDFFromHTML: (...args: unknown[]) => state.generatePdf(...args),
  createPdfBrowser: async () => state.browser,
  closePdfBrowser: (...args: unknown[]) => state.closeBrowser(...args),
}))
// Whether the record behind a document still needs signing. Tested on its own in subject-state.test.ts.
vi.mock('@/lib/signing/subject-state', () => ({ findSubjectClosure: (...args: unknown[]) => state.closure(...args) }))
vi.mock('@/lib/cron/alerting', () => ({ reportCronFailure: (...args: unknown[]) => state.alert(...args) }))
vi.mock('@/lib/signing/completion-hooks', () => ({ runCompletionHook: (...args: unknown[]) => state.hook(...args) }))

import { buildAgreedText } from '@/lib/signing/agreement-text'
import {
  MAX_IDENTITY_CHECK_FAILURES,
  SigningError,
  checkSigningIdentity,
  createSigningRequest,
  declineSigningParty,
  downloadSigningPdf,
  finaliseSigningDocument,
  getSigningPartyById,
  getSigningPartyByToken,
  listOtherDocumentsToSign,
  listSigningDocumentsForSubject,
  readSourcePdf,
  recordSigningOpened,
  resendSigningLink,
  resolveSigningPartyState,
  signSigningParty,
  startInPersonSigning,
  viewSigningDocument,
  voidSigningDocument,
  withdrawIfSubjectClosed,
  type SigningPartyContext,
} from '@/lib/signing/service'
import { PdfSheetOverflowError } from '@/lib/pdf/sheet-overflow'
import { readSigningRenderSpec } from '@/lib/signing/render'
import { initialsSlot, signatureSlot } from '@/lib/signing/signature-slots'
import { hashSigningToken, sha256Hex } from '@/lib/signing/tokens'
import type { SigningDocumentRow, SigningPartyRow } from '@/lib/signing/types'

const SUBJECT = '11111111-1111-4111-8111-111111111111'
const STAFF = '22222222-2222-4222-8222-222222222222'
const EVIDENCE = { ip: '203.0.113.9', userAgent: 'test-agent', city: 'Staines', region: 'ENG', country: 'GB' }
/** Whoever sent a document: the address the fake user lookup gives every member of staff. */
const SENDER_EMAIL = 'sender@example.test'
const SAM = { role: 'customer' as const, name: 'Sam Example', email: 'sam@example.com' }
const PAT = { role: 'customer' as const, name: 'Pat Example', email: 'pat@example.com' }
const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

const PARTY_DEFAULTS: Row = {
  status: 'pending',
  identity_check: 'none',
  identity_check_failures: 0,
  identity_checked_at: null,
  first_opened_at: null,
  document_viewed_at: null,
  last_reminded_at: null,
  reminder_count: 0,
  method: null,
  typed_name: null,
  agreed_text: null,
  signed_at: null,
  witnessed_by: null,
  email: null,
  hashed_token: null,
  token_expires_at: null,
  employee_id: null,
  customer_id: null,
}
const DOCUMENT_DEFAULTS: Row = {
  final_pdf_path: null,
  final_sha256: null,
  completed_at: null,
  completion_applied_at: null,
  copies_sent_at: null,
  voided_at: null,
  void_reason: null,
}

let db: FakeDb
let files: Map<string, Buffer>
let uploadFailure: string | null
let createdAtTick: number

async function tinyPdf(pages = 1): Promise<Buffer> {
  const pdf = await PDFDocument.create()
  for (let index = 0; index < pages; index += 1) pdf.addPage([595, 842])
  return Buffer.from(await pdf.save())
}

/** A PDF whose pages have the widths given, so one file's pages can be told apart from another's. */
async function sizedPdf(widths: number[]): Promise<Buffer> {
  const pdf = await PDFDocument.create()
  for (const width of widths) pdf.addPage([width, 842])
  return Buffer.from(await pdf.save())
}

/** The width of each page, in order: which pages a PDF holds. */
async function pageWidths(pdf: Buffer): Promise<number[]> {
  const loaded = await PDFDocument.load(pdf)
  return loaded.getPages().map((page) => Math.round(page.getWidth()))
}

/** What signing_record_signature does, against the fake rows. The real one is tested on Postgres. */
function fakeRecordSignature(args: Row): { data: Row; error: null } {
  const party = db.rows('signing_parties').find((row) => row.id === args.p_party_id)
  if (!party) return { data: { ok: false, reason: 'not_found' }, error: null }
  const document = db.rows('signing_documents').find((row) => row.id === party.document_id) as Row
  if (party.status === 'signed') return { data: { ok: false, reason: 'already_signed' }, error: null }
  if (!['sent', 'part_signed'].includes(document.status as string)) {
    return { data: { ok: false, reason: `document_${document.status}` }, error: null }
  }
  if (args.p_method !== 'sender' && !party.document_viewed_at) {
    return { data: { ok: false, reason: 'document_not_viewed' }, error: null }
  }
  Object.assign(party, {
    status: 'signed',
    method: args.p_method,
    typed_name: args.p_typed_name,
    agreed_text: args.p_agreed_text,
    signed_at: '2026-10-12T13:05:09.000Z',
    signed_ip: args.p_ip ?? null,
    signed_user_agent: args.p_user_agent ?? null,
    signed_city: args.p_city ?? null,
    signed_region: args.p_region ?? null,
    signed_country: args.p_country ?? null,
    auth_user_id: args.p_auth_user_id ?? null,
    witnessed_by: args.p_witnessed_by ?? null,
  })
  db.rows('signing_events').push({ id: `event-${Math.random()}`, document_id: document.id, party_id: party.id, event: 'signed' })
  const remaining = db.rows('signing_parties').filter((row) => row.document_id === document.id && row.status !== 'signed').length
  document.status = remaining === 0 ? 'completed' : 'part_signed'
  // The moment it was completed, as the real function records it. How long ago a document was
  // signed decides whether a refused copy is tried again, so a fixed date here would change what
  // these tests do a few days after it.
  if (remaining === 0) document.completed_at = new Date().toISOString()
  return { data: { ok: true, document_id: document.id, document_status: document.status, completed: remaining === 0 }, error: null }
}

function fakeRecordDecline(args: Row): { data: Row; error: null } {
  const party = db.rows('signing_parties').find((row) => row.id === args.p_party_id) as Row
  const document = db.rows('signing_documents').find((row) => row.id === party.document_id) as Row
  party.status = 'declined'
  party.decline_reason = args.p_reason ?? null
  document.status = 'declined'
  return { data: { ok: true, document_id: document.id, document_status: 'declined' }, error: null }
}

beforeEach(() => {
  db = createFakeDb({
    employees: [{ id: 'e1', employee_id: 'emp-1', date_of_birth: '2000-03-14', first_name: 'Sam', last_name: 'Example' }],
  })
  files = new Map()
  uploadFailure = null
  createdAtTick = 0
  db.onRpc((name, args) => {
    if (name === 'signing_record_signature') return fakeRecordSignature(args)
    if (name === 'signing_record_decline') return fakeRecordDecline(args)
    throw new Error(`Unexpected rpc ${name}`)
  })

  const defaultsFor = (table: string): Row =>
    table === 'signing_parties' ? PARTY_DEFAULTS : table === 'signing_documents' ? DOCUMENT_DEFAULTS : {}

  state.client = {
    from: (table: string) => {
      const real = db.client.from(table)
      return {
        ...real,
        // The database fills these in; the fake does not.
        insert: (payload: Row | Row[]) => {
          const rows = (Array.isArray(payload) ? payload : [payload]).map((row) => {
            createdAtTick += 1
            return { ...defaultsFor(table), created_at: `2026-10-12T12:00:${String(createdAtTick).padStart(2, '0')}.000Z`, ...row }
          })
          return real.insert(Array.isArray(payload) ? rows : rows[0])
        },
      }
    },
    rpc: db.client.rpc,
    storage: {
      from: () => ({
        upload: async (path: string, content: Buffer, options: { upsert?: boolean }) => {
          if (uploadFailure) return { error: { message: uploadFailure } }
          if (files.has(path) && !options?.upsert) return { error: { message: 'The resource already exists', statusCode: '409' } }
          files.set(path, Buffer.from(content))
          return { error: null }
        },
        download: async (path: string) => {
          const file = files.get(path)
          if (!file) return { data: null, error: { message: 'Object not found' } }
          return { data: { arrayBuffer: async () => file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) }, error: null }
        },
      }),
    },
    auth: {
      admin: {
        getUserById: async (id: string) => ({
          data: { user: { id, email: 'sender@example.test', user_metadata: { full_name: 'Billy Summers' } } },
        }),
      },
    },
  }

  state.sendEmail = vi.fn(async () => ({ success: true, messageId: 'm1' }))
  state.generatePdf = vi.fn(async () => tinyPdf())
  state.alert = vi.fn(async () => undefined)
  state.hook = vi.fn(async () => undefined)
  state.closure = vi.fn(async () => null)
  state.closeBrowser = vi.fn(async () => undefined)
})

async function send(overrides: Partial<Parameters<typeof createSigningRequest>[0]> = {}) {
  return createSigningRequest({
    // A kind with one signer and no business signatory, so each case has exactly one signature to
    // follow. The booking contract, which the business signs too, has its own cases below.
    kind: 'private_booking_waiver',
    subjectId: SUBJECT,
    title: 'Booking contract',
    summary: 'Your event on 5 December.',
    pdf: await tinyPdf(2),
    parties: [{ role: 'customer', name: 'Sam Example', email: 'sam@example.com' }],
    createdBy: STAFF,
    createdByName: 'Billy Summers',
    ...overrides,
  })
}

function tokenFromEmail(callIndex = 0): string {
  const text = (state.sendEmail.mock.calls[callIndex][0] as { text: string }).text
  const match = text.match(/\/sign\/([A-Za-z0-9_-]{43})/)
  if (!match) throw new Error('No signing link in the email')
  return match[1]
}

async function contextFor(partyId: string): Promise<SigningPartyContext> {
  const context = await getSigningPartyById(partyId)
  if (!context) throw new Error('party not found')
  return context
}

function party(id: string): SigningPartyRow {
  return db.rows('signing_parties').find((row) => row.id === id) as unknown as SigningPartyRow
}

function document(id: string): SigningDocumentRow {
  return db.rows('signing_documents').find((row) => row.id === id) as unknown as SigningDocumentRow
}

/** The words a signer agrees to for a document titled "Booking contract", which is what `send` sends. */
const AGREED = buildAgreedText({ mode: 'sign', title: 'Booking contract' })

/** Send a document and have every signer open it, so each is ready to sign. */
async function readyToSign(parties: Array<{ role: 'customer'; name: string; email: string }> = [SAM]) {
  const result = await send({ parties })
  for (const delivery of result.deliveries) {
    await viewSigningDocument(await contextFor(delivery.partyId), EVIDENCE)
  }
  return result
}

type SentRequest = Awaited<ReturnType<typeof readyToSign>>

/** Every signer signs, in order. The last signature completes the document and finishes it off. */
async function everyoneSigns(result: SentRequest): Promise<void> {
  for (const delivery of result.deliveries) {
    const outcome = await signSigningParty({
      context: await contextFor(delivery.partyId),
      typedName: delivery.name,
      agreedText: AGREED,
      via: 'link',
      evidence: EVIDENCE,
    })
    expect(outcome).toMatchObject({ ok: true })
  }
}

type EmailOutcome = { success: boolean; error?: string; uncertain?: boolean; code?: string; messageId?: string }

/**
 * Answer each email by who it is to, from here on. Anyone not named gets `otherwise`, a plain
 * success unless one is given. It replaces the mock, so the calls counted afterwards are only
 * the emails sent since.
 */
function answerEmails(
  byRecipient: Record<string, EmailOutcome | (() => EmailOutcome)> = {},
  otherwise: EmailOutcome = { success: true, messageId: 'm1' }
): void {
  state.sendEmail = vi.fn(async (options: { to: string }) => {
    const answer = byRecipient[options.to] ?? otherwise
    return typeof answer === 'function' ? answer() : answer
  })
}

const REFUSED: EmailOutcome = { success: false, error: 'mailbox unavailable' }
const UNCERTAIN: EmailOutcome = { success: false, error: 'the connection dropped', uncertain: true }
const SUSPENDED: EmailOutcome = { success: false, error: 'Email is switched off', code: 'email_suspended' }

function emailsTo(address: string): Array<{ to: string; subject: string }> {
  return state.sendEmail.mock.calls
    .map((call) => call[0] as { to: string; subject: string })
    .filter((email) => email.to === address)
}

/** The marks on the trail that say a signed copy went to a signer, or the notice went to the sender. */
function trail(documentId: string, what: 'signed_copy' | 'sender_notice'): Row[] {
  return db
    .rows('signing_events')
    .filter((row) => row.document_id === documentId && row.event === 'sent' && (row.meta as { what?: string } | null)?.what === what)
}

/** Every alert raised so far: what it was about, and what the error said. */
function alerts(): Array<{ what: string; message: string }> {
  return state.alert.mock.calls.map((call) => ({
    what: String(call[0]),
    message: call[1] instanceof Error ? call[1].message : String(call[1]),
  }))
}

/** Move the moment a document was completed into the past. */
function completedAgo(documentId: string, milliseconds: number): void {
  document(documentId).completed_at = new Date(Date.now() - milliseconds).toISOString()
}

describe('sending a document for signature', () => {
  it('stores the exact PDF with its fingerprint and emails a personal link', async () => {
    const pdf = await tinyPdf(2)
    const result = await send({ pdf })

    const saved = document(result.documentId)
    expect(saved.status).toBe('sent')
    expect(saved.version).toBe(1)
    expect(saved.brand).toBe('guest')
    expect(saved.subject_type).toBe('private_booking')
    expect(saved.source_sha256).toBe(sha256Hex(pdf))
    expect(files.get(saved.source_pdf_path)?.equals(pdf)).toBe(true)
    expect(new Date(saved.expires_at).getTime() - new Date(saved.sent_at).getTime()).toBe(30 * 24 * 60 * 60 * 1000)

    expect(result.deliveries).toEqual([
      { partyId: expect.any(String), name: 'Sam Example', email: 'sam@example.com', email_status: 'sent', error: undefined },
    ])
    const sent = state.sendEmail.mock.calls[0][0] as { to: string; cc?: string[]; bcc?: string[]; privateBookingId: string }
    expect(sent.to).toBe('sam@example.com')
    // Whoever holds the link can sign, so it is never copied to anyone.
    expect(sent.cc).toBeUndefined()
    expect(sent.bcc).toBeUndefined()
    // The email log keeps a copy of every email. It must not keep a working link.
    expect((sent as unknown as { logRedactions: string[] }).logRedactions).toEqual([tokenFromEmail()])
    expect(sent.privateBookingId).toBe(SUBJECT)
  })

  it('keeps only a hash of the link, never the link itself', async () => {
    const result = await send()
    const rawToken = tokenFromEmail()
    const stored = party(result.deliveries[0].partyId)
    expect(stored.hashed_token).toBe(hashSigningToken(rawToken))
    expect(JSON.stringify(db.rows('signing_parties'))).not.toContain(rawToken)
    expect(JSON.stringify(db.rows('signing_events'))).not.toContain(rawToken)
    expect((await getSigningPartyByToken(rawToken))?.party.id).toBe(stored.id)
    expect(await getSigningPartyByToken('not-a-token')).toBeNull()
    expect(await getSigningPartyByToken('a'.repeat(43))).toBeNull()
  })

  it('signs for the business as it sends, where the kind has a business signatory', async () => {
    const result = await send({
      kind: 'employment_agreement',
      title: 'Worker agreement',
      parties: [{ role: 'worker', name: 'Sam Example', email: 'sam@example.com', employeeId: 'emp-1', identityCheck: 'date_of_birth' }],
    })
    const parties = db.rows('signing_parties').filter((row) => row.document_id === result.documentId)
    const company = parties.find((row) => row.role === 'company') as Row
    expect(company).toMatchObject({ status: 'signed', method: 'sender', typed_name: 'Billy Summers', auth_user_id: STAFF })
    expect(document(result.documentId).status).toBe('part_signed')
    expect(parties.find((row) => row.role === 'worker')).toMatchObject({ status: 'pending', identity_check: 'date_of_birth' })
  })

  it('signs the booking contract for the venue as it is sent, in the name and position of whoever sent it', async () => {
    const result = await send({ kind: 'private_booking_contract', createdByPosition: 'General Manager' })
    const saved = document(result.documentId)
    expect(saved.status).toBe('part_signed')
    expect(saved.context.sender_position).toBe('General Manager')
    const parties = db.rows('signing_parties').filter((row) => row.document_id === result.documentId)
    const venue = parties.find((row) => row.role === 'company')
    const customer = parties.find((row) => row.role === 'customer')
    expect(parties).toHaveLength(2)
    expect(venue).toMatchObject({ status: 'signed', method: 'sender', typed_name: 'Billy Summers' })
    expect(customer).toMatchObject({ status: 'pending', method: null })
    // Only the customer is sent a link.
    expect(result.deliveries.map((delivery) => delivery.email)).toEqual(['sam@example.com'])
  })

  it('keeps the document source beside the PDF, with its signature places still marked', async () => {
    const html = `<html><body><p>Terms</p>${signatureSlot('contract:host')}${initialsSlot()}</body></html>`
    const result = await send({
      render: { html, profile: 'a4_css_page', pages: { skipLast: 1 }, slots: { 'contract:host': 'customer' }, hasInitials: true },
    })
    const saved = document(result.documentId)
    const htmlPath = `private_booking/${SUBJECT}/${result.documentId}/document.html`
    expect(files.get(htmlPath)?.toString('utf-8')).toBe(html)
    // The record says where the source is, its fingerprint and how to print it. It never holds
    // the source itself.
    expect(saved.context.render).toEqual({
      htmlPath,
      htmlSha256: sha256Hex(Buffer.from(html, 'utf-8')),
      profile: 'a4_css_page',
      pages: { skipLast: 1 },
      slots: { 'contract:host': 'customer' },
      hasInitials: true,
    })
  })

  it('fingerprints the document source exactly as it was stored, so the signed copy can be checked against it', async () => {
    // Characters that take more than one byte each: the fingerprint is of the bytes stored.
    const html = `<html><body><p>Deposit £250, café tables, naïve test</p>${signatureSlot('doc:customer')}</body></html>`
    const result = await send({ render: { html, profile: 'a4_margins', slots: { 'doc:customer': 'customer' } } })

    const stored = files.get(`private_booking/${SUBJECT}/${result.documentId}/document.html`) as Buffer
    const spec = readSigningRenderSpec(document(result.documentId).context)
    expect(spec).not.toBeNull()
    expect(spec?.htmlSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(spec?.htmlSha256).toBe(sha256Hex(stored))
    // A different document has a different fingerprint.
    const other = await send({
      kind: 'private_booking_contract',
      render: { html: html.replace('£250', '£251'), profile: 'a4_margins', slots: { 'doc:customer': 'customer' } },
    })
    expect(readSigningRenderSpec(document(other.documentId).context)?.htmlSha256).not.toBe(spec?.htmlSha256)
  })

  it('records nothing when the document source cannot be stored', async () => {
    const realClient = state.client as { storage: { from: () => { upload: (path: string, content: Buffer, options: { upsert?: boolean }) => Promise<{ error: unknown }> } } }
    const bucket = realClient.storage.from()
    realClient.storage.from = () => ({
      ...bucket,
      upload: async (path: string, content: Buffer, options: { upsert?: boolean }) =>
        path.endsWith('document.html') ? { error: { message: 'disk full' } } : bucket.upload(path, content, options),
    })
    await expect(
      send({ render: { html: `<p>${signatureSlot('doc:customer')}</p>`, profile: 'a4_margins', slots: { 'doc:customer': 'customer' } } })
    ).rejects.toThrow('disk full')
    expect(db.rows('signing_documents')).toHaveLength(0)
    expect(db.rows('signing_parties')).toHaveLength(0)
  })

  it('numbers versions per record and withdraws the earlier unsigned request', async () => {
    const first = await send()
    const second = await send()
    expect(document(second.documentId).version).toBe(2)
    expect(document(first.documentId)).toMatchObject({ status: 'voided', void_reason: 'Replaced by version 2' })

    // A different series on the same record is left alone.
    const contract = await send({ kind: 'private_booking_contract', title: 'Contract' })
    expect(document(contract.documentId).version).toBe(1)
    expect(document(second.documentId).status).toBe('sent')
  })

  it('reports a link that could not be emailed without undoing the request', async () => {
    state.sendEmail = vi.fn(async () => ({ success: false, error: 'mailbox unavailable' }))
    const result = await send()
    expect(result.deliveries[0]).toMatchObject({ email_status: 'failed', error: 'mailbox unavailable' })
    expect(document(result.documentId).status).toBe('sent')
    expect(db.rows('signing_events').filter((row) => row.event === 'sent')).toHaveLength(0)
  })

  it('gives a signer with no email no link, for in-person signing', async () => {
    const result = await send({ parties: [{ role: 'customer', name: 'Sam Example' }] })
    expect(result.deliveries[0].email_status).toBe('none')
    expect(party(result.deliveries[0].partyId).hashed_token).toBeNull()
    expect(state.sendEmail).not.toHaveBeenCalled()
  })

  it('records nothing when the document cannot be stored', async () => {
    uploadFailure = 'storage offline'
    await expect(send()).rejects.toThrow('Could not store the document')
    expect(db.rows('signing_documents')).toHaveLength(0)
    expect(state.sendEmail).not.toHaveBeenCalled()
  })

  it('withdraws the document if the business signature cannot be recorded', async () => {
    db.onRpc(() => ({ data: { ok: false, reason: 'not_found' }, error: null }))
    await expect(
      send({ kind: 'employment_agreement', parties: [{ role: 'worker', name: 'Sam Example', email: 'sam@example.com', employeeId: 'emp-1' }] })
    ).rejects.toThrow('Could not sign for the business')
    // Left open, the worker could complete it in the portal with no business signature on it.
    expect(db.rows('signing_documents')[0]).toMatchObject({ status: 'voided' })
    expect(state.sendEmail).not.toHaveBeenCalled()
  })

  it('withdraws the document if the signers cannot be recorded', async () => {
    db.failNext({ table: 'signing_parties', operation: 'insert', message: 'boom', times: 1 })
    await expect(send()).rejects.toThrow('Could not record the signers')
    expect(db.rows('signing_documents')[0]).toMatchObject({ status: 'voided' })
    expect(state.sendEmail).not.toHaveBeenCalled()
  })

  it('refuses an empty document, no signers, and a signer with no name', async () => {
    await expect(send({ pdf: Buffer.alloc(0) })).rejects.toBeInstanceOf(SigningError)
    await expect(send({ parties: [] })).rejects.toBeInstanceOf(SigningError)
    await expect(send({ parties: [{ role: 'customer', name: '  ' }] })).rejects.toBeInstanceOf(SigningError)
  })
})

describe('opening and reading', () => {
  it('notes the first opening only, and the first reading only', async () => {
    const result = await send()
    const partyId = result.deliveries[0].partyId
    await recordSigningOpened(await contextFor(partyId), EVIDENCE)
    await recordSigningOpened(await contextFor(partyId), EVIDENCE)
    expect(db.rows('signing_events').filter((row) => row.event === 'opened')).toHaveLength(1)

    const pdf = await viewSigningDocument(await contextFor(partyId), EVIDENCE)
    await viewSigningDocument(await contextFor(partyId), EVIDENCE)
    expect(sha256Hex(pdf)).toBe(document(result.documentId).source_sha256)
    expect(party(partyId).document_viewed_at).toBeTruthy()
    const viewed = db.rows('signing_events').filter((row) => row.event === 'document_viewed')
    expect(viewed).toHaveLength(1)
    expect(viewed[0]).toMatchObject({ ip: '203.0.113.9', city: 'Staines', country: 'GB' })
  })

  it('refuses to serve a stored file that no longer matches its fingerprint, and raises an alert', async () => {
    const result = await send()
    const saved = document(result.documentId)
    files.set(saved.source_pdf_path, await tinyPdf(5))
    await expect(readSourcePdf(saved)).rejects.toMatchObject({ code: 'fingerprint_mismatch' })
    expect(state.alert).toHaveBeenCalledTimes(1)
  })
})

describe('what the signer sees', () => {
  const base = (): SigningPartyContext => ({
    party: {
      ...PARTY_DEFAULTS,
      id: 'p',
      document_id: 'd',
      role: 'worker',
      name: 'Sam',
      token_expires_at: '2026-11-01T00:00:00.000Z',
    } as unknown as SigningPartyRow,
    document: { status: 'sent', expires_at: '2026-11-11T00:00:00.000Z' } as SigningDocumentRow,
  })
  const now = new Date('2026-10-12T12:00:00.000Z')
  const withParty = (changes: Partial<SigningPartyRow>): SigningPartyContext => ({ ...base(), party: { ...base().party, ...changes } })
  const withDocument = (changes: Partial<SigningDocumentRow>): SigningPartyContext => ({ ...base(), document: { ...base().document, ...changes } })

  it('resolves every state', () => {
    expect(resolveSigningPartyState(base(), 'link', now)).toBe('ready')
    expect(resolveSigningPartyState(withParty({ status: 'signed' }), 'link', now)).toBe('signed')
    expect(resolveSigningPartyState(withParty({ status: 'declined' }), 'link', now)).toBe('declined')
    expect(resolveSigningPartyState(withDocument({ status: 'voided' }), 'link', now)).toBe('voided')
    expect(resolveSigningPartyState(withDocument({ status: 'superseded' }), 'link', now)).toBe('superseded')
    expect(resolveSigningPartyState(withDocument({ status: 'declined' }), 'link', now)).toBe('document_declined')
    expect(resolveSigningPartyState(withDocument({ status: 'expired' }), 'link', now)).toBe('expired')
    expect(resolveSigningPartyState(withDocument({ expires_at: '2026-10-12T11:59:59.000Z' }), 'link', now)).toBe('expired')
    expect(resolveSigningPartyState(withParty({ token_expires_at: '2026-10-12T11:59:59.000Z' }), 'link', now)).toBe('link_expired')
    expect(resolveSigningPartyState(withParty({ token_expires_at: null }), 'link', now)).toBe('link_expired')
  })

  it('asks a new starter for their date of birth by link, but not in the portal or in person', () => {
    const needsCheck = withParty({ identity_check: 'date_of_birth' })
    expect(resolveSigningPartyState(needsCheck, 'link', now)).toBe('needs_identity_check')
    expect(resolveSigningPartyState(needsCheck, 'portal', now)).toBe('ready')
    expect(resolveSigningPartyState(withParty({ identity_check: 'date_of_birth', witnessed_by: STAFF }), 'link', now)).toBe('ready')
    expect(resolveSigningPartyState(withParty({ identity_check: 'date_of_birth', identity_checked_at: '2026-10-12T10:00:00.000Z' }), 'link', now)).toBe('ready')
    expect(resolveSigningPartyState(withParty({ identity_check: 'date_of_birth', identity_check_failures: MAX_IDENTITY_CHECK_FAILURES }), 'link', now)).toBe('locked')
  })

  it('does not hold portal signing to the link expiry', () => {
    expect(resolveSigningPartyState(withParty({ token_expires_at: null }), 'portal', now)).toBe('ready')
  })
})

describe('date of birth check', () => {
  async function newStarter(): Promise<string> {
    const result = await send({
      kind: 'employment_agreement',
      title: 'Worker agreement',
      parties: [{ role: 'worker', name: 'Sam Example', email: 'sam@example.com', employeeId: 'emp-1', identityCheck: 'date_of_birth' }],
    })
    return result.deliveries[0].partyId
  }

  it('passes on the date we hold and records it', async () => {
    const partyId = await newStarter()
    expect(await checkSigningIdentity(await contextFor(partyId), '2000-03-14', EVIDENCE)).toEqual({ ok: true })
    expect(party(partyId).identity_checked_at).toBeTruthy()
    expect(db.rows('signing_events').some((row) => row.event === 'identity_check_passed')).toBe(true)
    // Asking again once passed costs nothing and changes nothing.
    expect(await checkSigningIdentity(await contextFor(partyId), '1999-01-01', EVIDENCE)).toEqual({ ok: true })
  })

  it('counts wrong answers and locks the link after five', async () => {
    const partyId = await newStarter()
    for (let attempt = 1; attempt <= MAX_IDENTITY_CHECK_FAILURES; attempt += 1) {
      const result = await checkSigningIdentity(await contextFor(partyId), '1999-01-01', EVIDENCE)
      expect(result).toEqual({
        ok: false,
        reason: attempt === MAX_IDENTITY_CHECK_FAILURES ? 'locked' : 'mismatch',
        attemptsLeft: MAX_IDENTITY_CHECK_FAILURES - attempt,
      })
    }
    // Even the right answer is refused once locked.
    expect(await checkSigningIdentity(await contextFor(partyId), '2000-03-14', EVIDENCE)).toMatchObject({ ok: false, reason: 'locked' })
    expect(db.rows('signing_events').filter((row) => row.event === 'identity_check_failed')).toHaveLength(MAX_IDENTITY_CHECK_FAILURES)
    expect(party(partyId).identity_checked_at).toBeNull()
  })

  it('checks only one of two guesses sent at the same moment', async () => {
    const partyId = await newStarter()
    // Both requests read the row before either wrote to it.
    const first = await contextFor(partyId)
    const second = await contextFor(partyId)
    expect(await checkSigningIdentity(first, '1999-01-01', EVIDENCE)).toMatchObject({ ok: false, reason: 'mismatch' })
    // The second lost the race for the attempt, so its guess is not compared at all, even though it is right.
    expect(await checkSigningIdentity(second, '2000-03-14', EVIDENCE)).toMatchObject({ ok: false, reason: 'busy' })
    expect(party(partyId)).toMatchObject({ identity_check_failures: 1, identity_checked_at: null })
  })

  it('says so when we hold no date of birth to compare with', async () => {
    db.rows('employees')[0].date_of_birth = null
    const partyId = await newStarter()
    expect(await checkSigningIdentity(await contextFor(partyId), '2000-03-14', EVIDENCE)).toMatchObject({ ok: false, reason: 'no_record' })
    expect(party(partyId).identity_check_failures).toBe(0)
  })
})

describe('signing', () => {
  const agreed = AGREED

  it('refuses a scribble for a name and wording that is not what we would show', async () => {
    const result = await readyToSign()
    const context = await contextFor(result.deliveries[0].partyId)
    expect(await signSigningParty({ context, typedName: 'x', agreedText: agreed, via: 'link', evidence: EVIDENCE })).toEqual({ ok: false, reason: 'name_not_acceptable' })
    expect(await signSigningParty({ context, typedName: 'Sam Example', agreedText: 'I agree to anything', via: 'link', evidence: EVIDENCE })).toEqual({ ok: false, reason: 'agreement_text_changed' })
    expect(party(context.party.id).status).toBe('pending')
  })

  it('records the last signature, writes the signed copy, updates the record and sends copies', async () => {
    const result = await readyToSign()
    const partyId = result.deliveries[0].partyId
    state.sendEmail.mockClear()

    const outcome = await signSigningParty({ context: await contextFor(partyId), typedName: 'Sam Example', agreedText: agreed, via: 'link', evidence: EVIDENCE })
    expect(outcome).toEqual({ ok: true, completed: true, documentId: result.documentId })

    expect(party(partyId)).toMatchObject({ status: 'signed', method: 'link', typed_name: 'Sam Example', agreed_text: agreed, signed_ip: '203.0.113.9', signed_city: 'Staines' })

    const saved = document(result.documentId)
    expect(saved.status).toBe('completed')
    expect(saved.final_pdf_path).toMatch(/signed\.pdf$/)
    const finalFile = files.get(saved.final_pdf_path as string) as Buffer
    expect(saved.final_sha256).toBe(sha256Hex(finalFile))
    // Two pages of document plus one page of signing record.
    expect((await PDFDocument.load(finalFile)).getPageCount()).toBe(3)
    // The document as sent is untouched.
    expect(sha256Hex(files.get(saved.source_pdf_path) as Buffer)).toBe(saved.source_sha256)

    expect(state.hook).toHaveBeenCalledTimes(1)
    expect(saved.completion_applied_at).toBeTruthy()

    const certificateHtml = state.generatePdf.mock.calls[0][0] as string
    expect(certificateHtml).toContain('Sam Example')
    expect(certificateHtml).toContain(saved.source_sha256)
    expect(certificateHtml).toContain('Staines, ENG, GB')

    const emails = state.sendEmail.mock.calls.map((call) => call[0] as { to: string; subject: string; attachments?: Array<{ name: string; contentType: string; content: Buffer }> })
    const copy = emails.find((email) => email.to === 'sam@example.com')
    expect(copy?.subject).toBe('Signed: Booking contract')
    expect(copy?.attachments?.[0]).toMatchObject({ name: 'Booking-contract.pdf', contentType: 'application/pdf' })
    expect(copy?.attachments?.[0].content.equals(finalFile)).toBe(true)
    expect(emails.find((email) => email.to === 'sender@example.test')?.subject).toContain('Signed: Booking contract')
  })

  it('prints each signature where it belongs on the signed copy, from the source kept when it was sent', async () => {
    const html = `<html><body><h1>Contract</h1><div>${signatureSlot('contract:host')}</div><div>${signatureSlot('contract:anchor')}</div><footer>${initialsSlot()}</footer></body></html>`
    const result = await send({
      kind: 'private_booking_contract',
      createdByPosition: 'General Manager',
      render: {
        html,
        profile: 'a4_css_page',
        pages: { skipLast: 1 },
        slots: { 'contract:host': 'customer', 'contract:anchor': 'company' },
        hasInitials: true,
      },
    })
    const partyId = result.deliveries[0].partyId
    await viewSigningDocument(await contextFor(partyId), EVIDENCE)
    // First the document (three pages, the last belonging to another document), then the record page.
    state.generatePdf = vi.fn()
      .mockImplementationOnce(async () => tinyPdf(3))
      .mockImplementationOnce(async () => tinyPdf(1))

    const outcome = await signSigningParty({ context: await contextFor(partyId), typedName: 'Samuel Example', agreedText: agreed, via: 'link', evidence: EVIDENCE })
    expect(outcome).toEqual({ ok: true, completed: true, documentId: result.documentId })

    const [printedHtml, options, browserOption] = state.generatePdf.mock.calls[0] as [
      string,
      { preferCSSPageSize: boolean },
      { browser: unknown; refuseClippedSheets?: boolean },
    ]
    const reference = result.documentId.replace(/-/g, '').slice(0, 8).toUpperCase()
    // The customer's panel: the name they typed, when, where and how.
    expect(printedHtml).toContain('Samuel Example')
    expect(printedHtml).toContain('Signed electronically')
    expect(printedHtml).toContain('Staines, ENG, GB (approximate location)')
    expect(printedHtml).toContain('By a personal link sent by email')
    expect(printedHtml).toContain(`ref ${reference}`)
    // The venue's panel: whoever sent it, with their position.
    expect(printedHtml).toContain('Billy Summers, General Manager')
    expect(printedHtml).toContain('On sending, signed in to the management app')
    // No marker is left behind, and nothing but the panels changed.
    expect(printedHtml).not.toContain('<!--signing-')
    expect(printedHtml).toContain('<h1>Contract</h1>')
    expect(printedHtml).toContain(`Signed electronically, ref ${reference}`)
    expect(options.preferCSSPageSize).toBe(true)
    // Printed in the browser already started, and refused if anything runs off a fixed sheet.
    expect(browserOption.browser).toBe(state.browser)
    expect(browserOption.refuseClippedSheets).toBe(true)
    expect(state.closeBrowser).toHaveBeenCalledWith(state.browser)

    const certificateHtml = state.generatePdf.mock.calls[1][0] as string
    expect(certificateHtml).toContain('each signature panel completed')

    const saved = document(result.documentId)
    const finalFile = files.get(saved.final_pdf_path as string) as Buffer
    // Two pages of contract (the third page was the other document's) plus the signing record.
    expect((await PDFDocument.load(finalFile)).getPageCount()).toBe(3)
    // The file each signer was shown is untouched, and so is its fingerprint.
    expect(sha256Hex(files.get(saved.source_pdf_path) as Buffer)).toBe(saved.source_sha256)
  })

  it('does not hand out a signed copy when the stored source has gone, and raises an alert', async () => {
    const result = await send({
      render: { html: `<p>${signatureSlot('doc:customer')}</p>`, profile: 'a4_margins', slots: { 'doc:customer': 'customer' } },
    })
    const partyId = result.deliveries[0].partyId
    await viewSigningDocument(await contextFor(partyId), EVIDENCE)
    files.delete(`private_booking/${SUBJECT}/${result.documentId}/document.html`)

    const outcome = await signSigningParty({ context: await contextFor(partyId), typedName: 'Sam Example', agreedText: agreed, via: 'link', evidence: EVIDENCE })
    // The signature stands. The finishing step is what failed, and it says so.
    expect(outcome).toMatchObject({ ok: true, completed: true })
    expect(document(result.documentId)).toMatchObject({ status: 'completed', final_pdf_path: null })
    expect(state.alert).toHaveBeenCalledWith(expect.stringContaining('signed but not finalised'), expect.any(Error), expect.objectContaining({ documentId: result.documentId }))
    expect(state.closeBrowser).toHaveBeenCalledTimes(1)
  })

  describe('when the second print, with the signatures in place, cannot be trusted', () => {
    const html = `<html><body><p>Hire fee £500</p><div>${signatureSlot('contract:host')}</div><footer>${initialsSlot()}</footer></body></html>`
    /** The file each signer is shown: two pages, 200 and 300 points wide. */
    const AS_SENT = [200, 300]
    /** The signing record page the fake generator prints: A4. */
    const RECORD_PAGE = 595
    const IN_PLACE_ALERT = 'the signed copy could not show the signatures in place, so the document as sent was used'

    async function sentForASecondPrint(pages?: { skipLast?: number; onlyLast?: number; total?: number }) {
      const result = await send({
        pdf: await sizedPdf(AS_SENT),
        render: { html, profile: 'a4_css_page', pages, slots: { 'contract:host': 'customer' }, hasInitials: true },
      })
      const partyId = result.deliveries[0].partyId
      await viewSigningDocument(await contextFor(partyId), EVIDENCE)
      answerEmails()
      return { documentId: result.documentId, partyId, htmlPath: `private_booking/${SUBJECT}/${result.documentId}/document.html` }
    }

    async function samSigns(partyId: string) {
      return signSigningParty({ context: await contextFor(partyId), typedName: 'Sam Example', agreedText: agreed, via: 'link', evidence: EVIDENCE })
    }

    /** The second print is the first thing the generator is asked for; the record page is the second. */
    function secondPrint(outcome: () => Promise<Buffer>): void {
      state.generatePdf = vi.fn().mockImplementationOnce(outcome).mockImplementation(async () => tinyPdf())
    }

    /** The document finished, and the signed copy is the file as sent plus the signing record. */
    async function expectTheFileAsSentWasUsed(documentId: string): Promise<void> {
      const saved = document(documentId)
      expect(saved.status).toBe('completed')
      expect(saved.final_pdf_path).toMatch(/signed\.pdf$/)
      const finalFile = files.get(saved.final_pdf_path as string) as Buffer
      expect(saved.final_sha256).toBe(sha256Hex(finalFile))
      expect(await pageWidths(finalFile)).toEqual([...AS_SENT, RECORD_PAGE])
      // The record page says the pages before it are the file itself, not a completed version of it.
      const recordHtml = state.generatePdf.mock.calls[state.generatePdf.mock.calls.length - 1][0] as string
      expect(recordHtml).toContain('The pages before this one are that file.')
      expect(recordHtml).not.toContain('each signature panel completed')
      // Everything else about finishing happened as usual.
      const copies = state.sendEmail.mock.calls
        .map((call) => call[0] as { to: string; attachments?: Array<{ content: Buffer }> })
        .filter((email) => email.to === 'sam@example.com')
      expect(copies).toHaveLength(1)
      expect(copies[0].attachments?.[0].content.equals(finalFile)).toBe(true)
      expect(emailsTo(SENDER_EMAIL)).toHaveLength(1)
      expect(trail(documentId, 'signed_copy')).toHaveLength(1)
      expect(saved.copies_sent_at).toBeTruthy()
      expect(state.hook).toHaveBeenCalledTimes(1)
      expect(saved.completion_applied_at).toBeTruthy()
      expect(state.closeBrowser).toHaveBeenCalledTimes(1)
      expect(state.closeBrowser).toHaveBeenCalledWith(state.browser)
      // The file each signer was shown is untouched.
      expect(sha256Hex(files.get(saved.source_pdf_path) as Buffer)).toBe(saved.source_sha256)
    }

    it('uses the print with the signatures in place when nothing is wrong with it', async () => {
      const { documentId, partyId } = await sentForASecondPrint()
      secondPrint(async () => sizedPdf([400, 410]))

      expect(await samSigns(partyId)).toEqual({ ok: true, completed: true, documentId })

      const finalFile = files.get(document(documentId).final_pdf_path as string) as Buffer
      expect(await pageWidths(finalFile)).toEqual([400, 410, RECORD_PAGE])
      expect(state.generatePdf.mock.calls[1][0]).toContain('each signature panel completed')
      expect(state.alert).not.toHaveBeenCalled()
    })

    it('uses the file as sent when the stored source has been changed, prints nothing from it, and raises an alert', async () => {
      const { documentId, partyId, htmlPath } = await sentForASecondPrint()
      // One character of the stored source is not what was fingerprinted when it was sent.
      files.set(htmlPath, Buffer.from(html.replace('£500', '£50'), 'utf-8'))
      state.generatePdf = vi.fn(async () => tinyPdf())

      expect(await samSigns(partyId)).toEqual({ ok: true, completed: true, documentId })

      await expectTheFileAsSentWasUsed(documentId)
      // Only the record page was printed. The changed source never reached the printer.
      expect(state.generatePdf).toHaveBeenCalledTimes(1)
      for (const call of state.generatePdf.mock.calls) expect(call[0]).not.toContain('Hire fee')
      expect(alerts()).toEqual([{ what: expect.stringContaining(IN_PLACE_ALERT), message: 'The stored document source does not match its fingerprint.' }])
      expect(state.alert).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ code: 'fingerprint_mismatch' }),
        expect.objectContaining({ documentId })
      )
    })

    it('uses the file as sent when the second print runs off the bottom of a page, and raises an alert', async () => {
      const { documentId, partyId } = await sentForASecondPrint()
      secondPrint(async () => {
        throw new PdfSheetOverflowError([2])
      })

      expect(await samSigns(partyId)).toEqual({ ok: true, completed: true, documentId })

      await expectTheFileAsSentWasUsed(documentId)
      expect(alerts()).toHaveLength(1)
      expect(alerts()[0].what).toContain(IN_PLACE_ALERT)
      expect(alerts()[0].message).toContain('does not fit on its pages (page 2)')
      expect(state.alert.mock.calls[0][1]).toBeInstanceOf(PdfSheetOverflowError)
    })

    it('uses the file as sent when the second print has a different number of pages from the first, and raises an alert', async () => {
      // Sent as five pages, the last of which belongs to another document.
      const { documentId, partyId } = await sentForASecondPrint({ skipLast: 1, total: 5 })
      secondPrint(async () => sizedPdf([400, 410, 420, 430, 440, 450]))

      expect(await samSigns(partyId)).toEqual({ ok: true, completed: true, documentId })

      await expectTheFileAsSentWasUsed(documentId)
      expect(alerts()).toHaveLength(1)
      expect(alerts()[0].what).toContain(IN_PLACE_ALERT)
      expect(alerts()[0].message).toContain('6 pages where 5 were expected')
      expect((state.alert.mock.calls[0][1] as Error).name).toBe('SigningPageCountError')
    })

    it('uses the file as sent when the pages to keep are not in the second print at all, and raises an alert', async () => {
      // Three pages are to be dropped from the end, with no page count recorded to check against.
      const { documentId, partyId } = await sentForASecondPrint({ skipLast: 3 })
      secondPrint(async () => sizedPdf([400, 410]))

      expect(await samSigns(partyId)).toEqual({ ok: true, completed: true, documentId })

      // It finishes on the file as sent. It used to fail here on every attempt.
      await expectTheFileAsSentWasUsed(documentId)
      expect(alerts()).toHaveLength(1)
      expect(alerts()[0].what).toContain(IN_PLACE_ALERT)
      expect(alerts()[0].message).toContain('Cannot select pages')
      expect((state.alert.mock.calls[0][1] as Error).name).toBe('SigningPageRangeError')
    })

    it('falls back the same way when finishing is asked for later, by a download or the daily job', async () => {
      const { documentId, partyId } = await sentForASecondPrint()
      // The browser would not start at all when it was signed, so nothing was made.
      state.generatePdf = vi.fn(async () => {
        throw new Error('browser would not start')
      })
      await samSigns(partyId)
      expect(document(documentId).final_pdf_path).toBeNull()
      state.alert.mockClear()
      state.closeBrowser.mockClear()
      answerEmails()
      secondPrint(async () => {
        throw new PdfSheetOverflowError([1, 3])
      })

      await finaliseSigningDocument(documentId)

      await expectTheFileAsSentWasUsed(documentId)
      expect(alerts()).toHaveLength(1)
      expect(alerts()[0].message).toContain('page 1, 3')
    })

    it('still fails the finishing step for any other fault in the second print, and does not fall back', async () => {
      const { documentId, partyId } = await sentForASecondPrint()
      secondPrint(async () => {
        throw new Error('Failed to generate PDF')
      })

      // The signature stands. The finishing step is what failed, and it says so.
      expect(await samSigns(partyId)).toEqual({ ok: true, completed: true, documentId })

      expect(party(partyId).status).toBe('signed')
      expect(document(documentId)).toMatchObject({ status: 'completed', final_pdf_path: null, final_sha256: null, copies_sent_at: null })
      expect(files.has(`private_booking/${SUBJECT}/${documentId}/signed.pdf`)).toBe(false)
      expect(state.sendEmail).not.toHaveBeenCalled()
      expect(state.hook).not.toHaveBeenCalled()
      expect(alerts()).toEqual([{ what: expect.stringContaining('signed but not finalised'), message: 'Failed to generate PDF' }])
      // The browser it started to print with is closed again.
      expect(state.closeBrowser).toHaveBeenCalledTimes(1)

      // Once the printer is well again, the same document finishes with its signatures in place.
      secondPrint(async () => sizedPdf([400, 410]))
      await finaliseSigningDocument(documentId)
      const finalFile = files.get(document(documentId).final_pdf_path as string) as Buffer
      expect(await pageWidths(finalFile)).toEqual([400, 410, RECORD_PAGE])
      expect(emailsTo('sam@example.com')).toHaveLength(1)
    })

    it('still fails the finishing step when the record page itself cannot be printed', async () => {
      const { documentId, partyId, htmlPath } = await sentForASecondPrint()
      // The fallback is in use, and then the printer fails on the record page.
      files.set(htmlPath, Buffer.from(html.replace('£500', '£50'), 'utf-8'))
      state.generatePdf = vi.fn(async () => {
        throw new Error('Failed to generate PDF')
      })

      expect(await samSigns(partyId)).toEqual({ ok: true, completed: true, documentId })

      expect(document(documentId)).toMatchObject({ status: 'completed', final_pdf_path: null })
      expect(state.sendEmail).not.toHaveBeenCalled()
      expect(alerts().map((alert) => alert.what)).toEqual([
        expect.stringContaining(IN_PLACE_ALERT),
        expect.stringContaining('signed but not finalised'),
      ])
      expect(state.closeBrowser).toHaveBeenCalledTimes(1)
    })
  })

  it('uses the PDF as sent, with no second print, for a document whose stored source has no fingerprint', async () => {
    const result = await send({
      render: { html: `<p>${signatureSlot('doc:customer')}</p>`, profile: 'a4_margins', slots: { 'doc:customer': 'customer' } },
    })
    const partyId = result.deliveries[0].partyId
    await viewSigningDocument(await contextFor(partyId), EVIDENCE)
    // As a document sent before the source was fingerprinted would be recorded.
    const stored = document(result.documentId).context.render as Record<string, unknown>
    delete stored.htmlSha256
    state.generatePdf = vi.fn(async () => tinyPdf())

    const outcome = await signSigningParty({ context: await contextFor(partyId), typedName: 'Sam Example', agreedText: agreed, via: 'link', evidence: EVIDENCE })

    expect(outcome).toMatchObject({ ok: true, completed: true })
    // Only the signing record page was printed. The pages before it are the file that was signed.
    expect(state.generatePdf).toHaveBeenCalledTimes(1)
    expect(state.generatePdf.mock.calls[0][0]).not.toContain('each signature panel completed')
    expect(state.closeBrowser).not.toHaveBeenCalled()
    const saved = document(result.documentId)
    const finalFile = files.get(saved.final_pdf_path as string) as Buffer
    // Two pages as sent plus the signing record.
    expect((await PDFDocument.load(finalFile)).getPageCount()).toBe(3)
    expect(state.alert).not.toHaveBeenCalled()
  })

  it('withdraws the request instead of taking a signature for a record that has moved on', async () => {
    const result = await readyToSign()
    const partyId = result.deliveries[0].partyId
    state.closure = vi.fn(async () => 'This booking was cancelled.')

    const outcome = await signSigningParty({ context: await contextFor(partyId), typedName: 'Sam Example', agreedText: agreed, via: 'link', evidence: EVIDENCE })
    expect(outcome).toEqual({ ok: false, reason: 'document_voided' })
    expect(party(partyId).status).toBe('pending')
    expect(document(result.documentId)).toMatchObject({ status: 'voided', void_reason: 'This booking was cancelled.' })
    expect(db.rows('signing_events').filter((row) => row.event === 'voided')).toEqual([
      expect.objectContaining({ document_id: result.documentId, meta: { reason: 'This booking was cancelled.', automatic: true } }),
    ])
    expect(state.hook).not.toHaveBeenCalled()
  })

  it('still withdraws the request, and raises an alert, when the withdrawal could not be written to the trail', async () => {
    const result = await readyToSign()
    const partyId = result.deliveries[0].partyId
    state.closure = vi.fn(async () => 'This booking was cancelled.')
    db.failNext({ table: 'signing_events', operation: 'insert', message: 'connection reset', times: 1 })

    const after = await withdrawIfSubjectClosed(await contextFor(partyId))

    // Withdrawn, with the reason on the document, even though the trail has no line for it yet.
    expect(after.document).toMatchObject({ id: result.documentId, status: 'voided', void_reason: 'This booking was cancelled.' })
    expect(document(result.documentId)).toMatchObject({ status: 'voided', void_reason: 'This booking was cancelled.' })
    expect(document(result.documentId).voided_at).toBeTruthy()
    expect(db.rows('signing_events').some((row) => row.event === 'voided')).toBe(false)
    expect(alerts()).toEqual([
      { what: expect.stringContaining('a withdrawn request was not written to the trail'), message: expect.stringContaining('connection reset') },
    ])
    expect(state.alert).toHaveBeenCalledWith(expect.any(String), expect.any(Error), expect.objectContaining({ documentId: result.documentId }))
  })

  it('refuses the signature as withdrawn, not as a fault on our side, when that trail line could not be written', async () => {
    const result = await readyToSign()
    const partyId = result.deliveries[0].partyId
    state.closure = vi.fn(async () => 'This booking was cancelled.')
    db.failNext({ table: 'signing_events', operation: 'insert', message: 'connection reset', times: 1 })

    const outcome = await signSigningParty({ context: await contextFor(partyId), typedName: 'Sam Example', agreedText: agreed, via: 'link', evidence: EVIDENCE })

    expect(outcome).toEqual({ ok: false, reason: 'document_voided' })
    expect(party(partyId).status).toBe('pending')
    expect(document(result.documentId).status).toBe('voided')
    expect(state.hook).not.toHaveBeenCalled()
  })

  it('leaves a signed document alone whatever has happened to the record since', async () => {
    const result = await readyToSign()
    const partyId = result.deliveries[0].partyId
    await signSigningParty({ context: await contextFor(partyId), typedName: 'Sam Example', agreedText: agreed, via: 'link', evidence: EVIDENCE })
    state.closure = vi.fn(async () => 'This booking was cancelled.')

    const after = await withdrawIfSubjectClosed(await contextFor(partyId))
    expect(after.document.status).toBe('completed')
    expect(state.closure).not.toHaveBeenCalled()
  })

  it('waits for everyone before completing', async () => {
    const result = await readyToSign([
      { role: 'customer', name: 'Sam Example', email: 'sam@example.com' },
      { role: 'customer', name: 'Pat Example', email: 'pat@example.com' },
    ])
    const first = await signSigningParty({ context: await contextFor(result.deliveries[0].partyId), typedName: 'Sam Example', agreedText: agreed, via: 'link', evidence: EVIDENCE })
    expect(first).toMatchObject({ ok: true, completed: false })
    expect(document(result.documentId)).toMatchObject({ status: 'part_signed', final_pdf_path: null })
    expect(state.hook).not.toHaveBeenCalled()

    const second = await signSigningParty({ context: await contextFor(result.deliveries[1].partyId), typedName: 'Pat Example', agreedText: agreed, via: 'link', evidence: EVIDENCE })
    expect(second).toMatchObject({ ok: true, completed: true })
    expect(state.hook).toHaveBeenCalledTimes(1)
  })

  it('keeps the signature when the finishing step fails, raises an alert, and finishes on download', async () => {
    const result = await readyToSign()
    const partyId = result.deliveries[0].partyId
    state.generatePdf = vi.fn(async () => {
      throw new Error('browser would not start')
    })

    const outcome = await signSigningParty({ context: await contextFor(partyId), typedName: 'Sam Example', agreedText: agreed, via: 'link', evidence: EVIDENCE })
    expect(outcome).toMatchObject({ ok: true, completed: true })
    expect(party(partyId).status).toBe('signed')
    expect(document(result.documentId)).toMatchObject({ status: 'completed', final_pdf_path: null })
    expect(state.alert).toHaveBeenCalledWith(expect.stringContaining('signed but not finalised'), expect.any(Error), expect.objectContaining({ documentId: result.documentId }))

    // The browser comes back. A staff download finishes the job.
    state.generatePdf = vi.fn(async () => tinyPdf())
    const download = await downloadSigningPdf({ documentId: result.documentId, userId: STAFF })
    expect(download).toMatchObject({ signed: true, fileName: 'Booking-contract-signed.pdf' })
    expect(document(result.documentId).final_pdf_path).toBeTruthy()
    expect(state.hook).toHaveBeenCalledTimes(1)
  })

  it('finishes once however many times it is asked', async () => {
    const result = await readyToSign()
    await signSigningParty({ context: await contextFor(result.deliveries[0].partyId), typedName: 'Sam Example', agreedText: agreed, via: 'link', evidence: EVIDENCE })
    const emailsAfterFirst = state.sendEmail.mock.calls.length
    const fingerprint = document(result.documentId).final_sha256

    await finaliseSigningDocument(result.documentId)
    await finaliseSigningDocument(result.documentId)
    expect(state.sendEmail.mock.calls.length).toBe(emailsAfterFirst)
    expect(state.hook).toHaveBeenCalledTimes(1)
    expect(document(result.documentId).final_sha256).toBe(fingerprint)
    expect(db.rows('signing_events').filter((row) => row.event === 'finalised')).toHaveLength(1)
  })

  it('sends the signer their copy even when the record update fails, then retries the update without sending it twice', async () => {
    const result = await readyToSign()
    state.sendEmail.mockClear()
    state.hook = vi.fn(async () => {
      throw new Error('booking update failed')
    })
    await signSigningParty({ context: await contextFor(result.deliveries[0].partyId), typedName: 'Sam Example', agreedText: agreed, via: 'link', evidence: EVIDENCE })
    expect(document(result.documentId)).toMatchObject({ completion_applied_at: null })
    expect(document(result.documentId).final_pdf_path).toBeTruthy()
    expect(document(result.documentId).copies_sent_at).toBeTruthy()
    expect(state.alert).toHaveBeenCalled()
    // The person who signed has their copy, whatever happened to the booking afterwards.
    const copies = state.sendEmail.mock.calls.filter((call) => (call[0] as { to: string }).to === 'sam@example.com')
    expect(copies).toHaveLength(1)
    expect((copies[0][0] as { subject: string }).subject).toBe('Signed: Booking contract')
    const emailsSoFar = state.sendEmail.mock.calls.length

    state.hook = vi.fn(async () => undefined)
    await finaliseSigningDocument(result.documentId)
    expect(state.hook).toHaveBeenCalledTimes(1)
    expect(document(result.documentId).completion_applied_at).toBeTruthy()
    // The copies were already sent, so this caller does not send them again.
    expect(state.sendEmail.mock.calls.length).toBe(emailsSoFar)
  })

  it('uses the signed copy another caller stored first', async () => {
    const result = await readyToSign()
    const saved = document(result.documentId)
    const stored = await tinyPdf(4)
    files.set(saved.source_pdf_path.replace('document.pdf', 'signed.pdf'), stored)
    await signSigningParty({ context: await contextFor(result.deliveries[0].partyId), typedName: 'Sam Example', agreedText: agreed, via: 'link', evidence: EVIDENCE })
    expect(document(result.documentId).final_sha256).toBe(sha256Hex(stored))
  })

  it('marks the earlier signed version as replaced once a newer one is signed', async () => {
    const first = await readyToSign()
    await signSigningParty({ context: await contextFor(first.deliveries[0].partyId), typedName: 'Sam Example', agreedText: agreed, via: 'link', evidence: EVIDENCE })
    const second = await readyToSign()
    // Sending the new version leaves the signed one in force.
    expect(document(first.documentId).status).toBe('completed')
    await signSigningParty({ context: await contextFor(second.deliveries[0].partyId), typedName: 'Sam Example', agreedText: agreed, via: 'link', evidence: EVIDENCE })
    expect(document(first.documentId).status).toBe('superseded')
    expect(document(second.documentId).status).toBe('completed')
  })

  it('does not call the finishing step done when the earlier version could not be marked as replaced, and does both on the next pass', async () => {
    const first = await readyToSign()
    await everyoneSigns(first)
    const second = await readyToSign()
    // The record update itself works. The write straight after it, which retires the earlier
    // version, fails once.
    const failTheNextDocumentWrite = vi.fn(async () => {
      db.failNext({ table: 'signing_documents', operation: 'update', message: 'connection reset', times: 1 })
    })
    state.hook = failTheNextDocumentWrite
    state.alert.mockClear()

    await everyoneSigns(second)

    // The signature stands and the signed copy exists, but the step is left to be done again.
    expect(document(second.documentId)).toMatchObject({ status: 'completed', completion_applied_at: null })
    expect(document(second.documentId).final_pdf_path).toBeTruthy()
    expect(document(first.documentId).status).toBe('completed')
    expect(db.rows('signing_events').some((row) => row.event === 'superseded')).toBe(false)
    expect(alerts()).toEqual([
      { what: expect.stringContaining('signed but not finalised'), message: 'Could not mark the earlier version as replaced: connection reset' },
    ])

    // Called directly, the same fault is an error, never a quiet success.
    await expect(finaliseSigningDocument(second.documentId)).rejects.toThrow(
      'Could not mark the earlier version as replaced: connection reset'
    )
    expect(document(second.documentId).completion_applied_at).toBeNull()
    expect(document(first.documentId).status).toBe('completed')

    // The database is back. The next pass retires the earlier version and records the step.
    state.hook = vi.fn(async () => undefined)
    await finaliseSigningDocument(second.documentId)
    expect(state.hook).toHaveBeenCalledTimes(1)
    expect(document(first.documentId).status).toBe('superseded')
    expect(document(second.documentId).completion_applied_at).toBeTruthy()
    expect(db.rows('signing_events').filter((row) => row.event === 'superseded')).toEqual([
      expect.objectContaining({ document_id: first.documentId, meta: { superseded_by: second.documentId } }),
    ])
  })

  it('refuses to finish a document that is not fully signed', async () => {
    const result = await send()
    await expect(finaliseSigningDocument(result.documentId)).rejects.toMatchObject({ code: 'not_completed' })
    await expect(finaliseSigningDocument('missing')).rejects.toMatchObject({ code: 'not_found' })
  })

  it('records a refusal and tells the sender', async () => {
    const result = await send()
    state.sendEmail.mockClear()
    const outcome = await declineSigningParty({ context: await contextFor(result.deliveries[0].partyId), reason: 'The date is wrong', evidence: EVIDENCE })
    expect(outcome).toMatchObject({ ok: true, completed: false })
    expect(document(result.documentId).status).toBe('declined')
    const notice = state.sendEmail.mock.calls[0][0] as { to: string; text: string }
    expect(notice.to).toBe('sender@example.test')
    expect(notice.text).toContain('The date is wrong')
  })

  it('keeps a refusal, and raises an alert, when the sender could not be told about it', async () => {
    const result = await send()
    answerEmails({ [SENDER_EMAIL]: { success: false, error: 'staff mailbox full' } })

    const outcome = await declineSigningParty({ context: await contextFor(result.deliveries[0].partyId), reason: 'The date is wrong', evidence: EVIDENCE })

    expect(outcome).toMatchObject({ ok: true, completed: false })
    expect(document(result.documentId).status).toBe('declined')
    expect(emailsTo(SENDER_EMAIL)).toHaveLength(1)
    expect(alerts()).toEqual([
      { what: expect.stringContaining('declined but the sender was not told'), message: expect.stringContaining('staff mailbox full') },
    ])
  })

  it('keeps a refusal, and raises an alert, when it could not find out who to tell', async () => {
    const result = await send()
    const users = (state.client as { auth: { admin: { getUserById: (id: string) => Promise<unknown> } } }).auth.admin
    users.getUserById = async () => {
      throw new Error('auth service timeout')
    }
    answerEmails()

    const outcome = await declineSigningParty({ context: await contextFor(result.deliveries[0].partyId), reason: 'The date is wrong', evidence: EVIDENCE })

    expect(outcome).toMatchObject({ ok: true, completed: false })
    expect(document(result.documentId).status).toBe('declined')
    expect(state.sendEmail).not.toHaveBeenCalled()
    expect(alerts()).toHaveLength(1)
    expect(alerts()[0].what).toContain('declined but the sender was not told')
    expect(alerts()[0].message).toContain('could not be read')
    expect(alerts()[0].message).toContain('auth service timeout')
  })
})

describe('a link that has been replaced', () => {
  it('takes no signature from the earlier link once a new one has been emailed', async () => {
    const result = await readyToSign()
    const partyId = result.deliveries[0].partyId
    // The signing page was opened with the first link, and is still open in a browser.
    const pageOpenedWithFirstLink = (await getSigningPartyByToken(tokenFromEmail(0))) as SigningPartyContext
    await resendSigningLink({ partyId, userId: STAFF, isReminder: false })
    // Only the replaced link stands in the way: the document counts as opened.
    party(partyId).document_viewed_at = new Date().toISOString()

    const outcome = await signSigningParty({ context: pageOpenedWithFirstLink, typedName: 'Sam Example', agreedText: AGREED, via: 'link', evidence: EVIDENCE })

    expect(outcome).toEqual({ ok: false, reason: 'link_replaced' })
    expect(party(partyId)).toMatchObject({ status: 'pending', typed_name: null, signed_at: null, method: null })
    expect(document(result.documentId).status).toBe('sent')
    expect(db.rows('signing_events').some((row) => row.event === 'signed')).toBe(false)
    expect(state.hook).not.toHaveBeenCalled()

    // The link in the newer email signs as usual.
    const pageOpenedWithNewLink = (await getSigningPartyByToken(tokenFromEmail(1))) as SigningPartyContext
    expect(
      await signSigningParty({ context: pageOpenedWithNewLink, typedName: 'Sam Example', agreedText: AGREED, via: 'link', evidence: EVIDENCE })
    ).toEqual({ ok: true, completed: true, documentId: result.documentId })
    expect(party(partyId)).toMatchObject({ status: 'signed', method: 'link' })
  })

  it('takes no signature from an emailed link once in-person signing has started', async () => {
    const result = await readyToSign()
    const partyId = result.deliveries[0].partyId
    const pageOpenedWithEmailedLink = await contextFor(partyId)
    const { url } = await startInPersonSigning({ partyId, userId: STAFF })
    party(partyId).document_viewed_at = new Date().toISOString()

    const outcome = await signSigningParty({ context: pageOpenedWithEmailedLink, typedName: 'Sam Example', agreedText: AGREED, via: 'link', evidence: EVIDENCE })

    expect(outcome).toEqual({ ok: false, reason: 'link_replaced' })
    expect(party(partyId).status).toBe('pending')

    // The session on the device in the manager's hand is the live one.
    const inPerson = (await getSigningPartyByToken(url.split('/sign/')[1])) as SigningPartyContext
    expect(
      await signSigningParty({ context: inPerson, typedName: 'Sam Example', agreedText: AGREED, via: 'link', evidence: EVIDENCE })
    ).toMatchObject({ ok: true })
    expect(party(partyId)).toMatchObject({ status: 'signed', method: 'in_person', witnessed_by: STAFF })
  })

  it('takes no signature from a link that has been taken away altogether', async () => {
    const result = await readyToSign()
    const partyId = result.deliveries[0].partyId
    const pageStillOpen = await contextFor(partyId)
    party(partyId).hashed_token = null

    expect(
      await signSigningParty({ context: pageStillOpen, typedName: 'Sam Example', agreedText: AGREED, via: 'link', evidence: EVIDENCE })
    ).toEqual({ ok: false, reason: 'link_replaced' })
    expect(party(partyId).status).toBe('pending')
  })

  it('still takes a signature in the staff portal after a new link was emailed, since the portal does not use the link', async () => {
    const result = await readyToSign()
    const partyId = result.deliveries[0].partyId
    const portalPage = await contextFor(partyId)
    await resendSigningLink({ partyId, userId: STAFF, isReminder: true })
    party(partyId).document_viewed_at = new Date().toISOString()

    const outcome = await signSigningParty({
      context: portalPage,
      typedName: 'Sam Example',
      agreedText: AGREED,
      via: 'portal',
      evidence: EVIDENCE,
      authUserId: STAFF,
    })

    expect(outcome).toEqual({ ok: true, completed: true, documentId: result.documentId })
    expect(party(partyId)).toMatchObject({ status: 'signed', method: 'portal', auth_user_id: STAFF })
  })

  it('fails, and records nothing, when it cannot tell whether the link is still the latest one', async () => {
    const result = await readyToSign()
    const partyId = result.deliveries[0].partyId
    const context = await contextFor(partyId)
    db.failNext({ table: 'signing_parties', operation: 'select', message: 'connection reset', times: 1 })

    await expect(
      signSigningParty({ context, typedName: 'Sam Example', agreedText: AGREED, via: 'link', evidence: EVIDENCE })
    ).rejects.toThrow('Could not check the signing link: connection reset')
    expect(party(partyId).status).toBe('pending')
    expect(db.rows('signing_events').some((row) => row.event === 'signed')).toBe(false)
  })
})

describe('signed copies by email', () => {
  it('sends each signer their copy, tells the sender, and writes each delivery to the trail', async () => {
    const result = await readyToSign([SAM, PAT])
    answerEmails()

    await everyoneSigns(result)

    expect(emailsTo('sam@example.com')).toEqual([expect.objectContaining({ subject: 'Signed: Booking contract' })])
    expect(emailsTo('pat@example.com')).toEqual([expect.objectContaining({ subject: 'Signed: Booking contract' })])
    expect(emailsTo(SENDER_EMAIL)).toHaveLength(1)
    expect(state.sendEmail).toHaveBeenCalledTimes(3)

    const copies = trail(result.documentId, 'signed_copy')
    expect(copies).toHaveLength(2)
    expect(copies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ party_id: result.deliveries[0].partyId, meta: expect.objectContaining({ what: 'signed_copy', to: 'sam@example.com' }) }),
        expect.objectContaining({ party_id: result.deliveries[1].partyId, meta: expect.objectContaining({ what: 'signed_copy', to: 'pat@example.com' }) }),
      ])
    )
    // A delivered copy is not marked as one whose outcome is unknown.
    for (const copy of copies) expect((copy.meta as { outcome?: string }).outcome).toBeUndefined()
    expect(trail(result.documentId, 'sender_notice')).toEqual([
      expect.objectContaining({ party_id: null, meta: expect.objectContaining({ what: 'sender_notice' }) }),
    ])
    expect(document(result.documentId).copies_sent_at).toBeTruthy()
    expect(state.alert).not.toHaveBeenCalled()

    // Nothing is sent a second time, however often it is finished again.
    await finaliseSigningDocument(result.documentId)
    expect(state.sendEmail).toHaveBeenCalledTimes(3)
  })

  it('sends again only to the signer who missed out when one email was refused, and tells the sender once', async () => {
    const result = await readyToSign([SAM, PAT])
    const [sam, pat] = result.deliveries
    answerEmails({ 'pat@example.com': REFUSED })

    await everyoneSigns(result)

    // Sam has a copy and the sender was told. Pat has nothing, and the step is open to try again.
    expect(emailsTo('sam@example.com')).toHaveLength(1)
    expect(emailsTo('pat@example.com')).toHaveLength(1)
    expect(emailsTo(SENDER_EMAIL)).toHaveLength(1)
    expect(trail(result.documentId, 'signed_copy').map((row) => row.party_id)).toEqual([sam.partyId])
    expect(trail(result.documentId, 'sender_notice')).toHaveLength(1)
    expect(document(result.documentId).copies_sent_at).toBeNull()
    expect(alerts()).toEqual([
      {
        what: expect.stringContaining('signed copies were not all sent, and will be tried again'),
        message: 'Signed copy not sent to Pat Example: mailbox unavailable',
      },
    ])
    // The rest of the finishing was not held up.
    expect(state.hook).toHaveBeenCalledTimes(1)
    expect(document(result.documentId).completion_applied_at).toBeTruthy()

    // The next pass: the mailbox takes it this time.
    answerEmails()
    state.alert.mockClear()
    await finaliseSigningDocument(result.documentId)

    expect(emailsTo('pat@example.com')).toEqual([expect.objectContaining({ subject: 'Signed: Booking contract' })])
    expect(emailsTo('sam@example.com')).toHaveLength(0)
    expect(emailsTo(SENDER_EMAIL)).toHaveLength(0)
    expect(state.sendEmail).toHaveBeenCalledTimes(1)
    expect(trail(result.documentId, 'signed_copy').map((row) => row.party_id).sort()).toEqual([sam.partyId, pat.partyId].sort())
    expect(trail(result.documentId, 'sender_notice')).toHaveLength(1)
    expect(document(result.documentId).copies_sent_at).toBeTruthy()
    expect(state.alert).not.toHaveBeenCalled()
    expect(state.hook).toHaveBeenCalledTimes(1)

    // And after that there is nothing left to send.
    await finaliseSigningDocument(result.documentId)
    expect(state.sendEmail).toHaveBeenCalledTimes(1)
  })

  it('keeps trying a refused signer on each pass until the email goes', async () => {
    const result = await readyToSign()
    answerEmails({ 'sam@example.com': REFUSED })
    await everyoneSigns(result)
    expect(document(result.documentId).copies_sent_at).toBeNull()

    await finaliseSigningDocument(result.documentId)
    await finaliseSigningDocument(result.documentId)

    // Three attempts, three refusals, and still open for the next one. The sender was told once.
    expect(emailsTo('sam@example.com')).toHaveLength(3)
    expect(emailsTo(SENDER_EMAIL)).toHaveLength(1)
    expect(trail(result.documentId, 'signed_copy')).toHaveLength(0)
    expect(document(result.documentId).copies_sent_at).toBeNull()
    expect(alerts().map((alert) => alert.message)).toEqual([
      'Signed copy not sent to Sam Example: mailbox unavailable',
      'Signed copy not sent to Sam Example: mailbox unavailable',
      'Signed copy not sent to Sam Example: mailbox unavailable',
    ])
  })

  it('does not send again where it cannot tell whether the email went', async () => {
    const result = await readyToSign()
    const partyId = result.deliveries[0].partyId
    answerEmails({ 'sam@example.com': UNCERTAIN })

    await everyoneSigns(result)

    // It may have arrived, so it is marked and the step stays closed.
    expect(trail(result.documentId, 'signed_copy')).toEqual([
      expect.objectContaining({
        party_id: partyId,
        meta: expect.objectContaining({ what: 'signed_copy', outcome: 'uncertain' }),
      }),
    ])
    expect(document(result.documentId).copies_sent_at).toBeTruthy()
    expect(alerts()).toHaveLength(1)
    expect(alerts()[0].what).toContain('signed copies were not all sent')
    expect(alerts()[0].what).not.toContain('tried again')
    expect(alerts()[0].message).toContain('Sam Example')
    expect(alerts()[0].message).toContain('the connection dropped')
    expect(alerts()[0].message).toContain('it may have been sent')

    answerEmails()
    await finaliseSigningDocument(result.documentId)
    expect(state.sendEmail).not.toHaveBeenCalled()

    // Even if the step were opened again, that signer is never emailed a second copy.
    document(result.documentId).copies_sent_at = null
    await finaliseSigningDocument(result.documentId)
    expect(state.sendEmail).not.toHaveBeenCalled()
    expect(trail(result.documentId, 'signed_copy')).toHaveLength(1)
  })

  it('tries the refused signer again, and only them, when another signer may already have theirs', async () => {
    const result = await readyToSign([SAM, PAT])
    const [sam, pat] = result.deliveries
    answerEmails({ 'sam@example.com': UNCERTAIN, 'pat@example.com': REFUSED })

    await everyoneSigns(result)

    expect(trail(result.documentId, 'signed_copy').map((row) => row.party_id)).toEqual([sam.partyId])
    expect(document(result.documentId).copies_sent_at).toBeNull()
    expect(alerts()).toHaveLength(1)
    expect(alerts()[0].what).toContain('will be tried again')
    expect(alerts()[0].message).toContain('Sam Example: the connection dropped (it may have been sent')
    expect(alerts()[0].message).toContain('Pat Example: mailbox unavailable')

    answerEmails()
    await finaliseSigningDocument(result.documentId)

    expect(emailsTo('pat@example.com')).toHaveLength(1)
    expect(emailsTo('sam@example.com')).toHaveLength(0)
    expect(state.sendEmail).toHaveBeenCalledTimes(1)
    expect(trail(result.documentId, 'signed_copy').map((row) => row.party_id).sort()).toEqual([sam.partyId, pat.partyId].sort())
    expect(document(result.documentId).copies_sent_at).toBeTruthy()
  })

  it('keeps trying while email is switched off, however long ago the document was signed', async () => {
    const result = await readyToSign()
    answerEmails({}, SUSPENDED)

    await everyoneSigns(result)

    expect(document(result.documentId).copies_sent_at).toBeNull()
    expect(trail(result.documentId, 'signed_copy')).toHaveLength(0)
    expect(trail(result.documentId, 'sender_notice')).toHaveLength(0)
    expect(alerts()).toHaveLength(1)
    expect(alerts()[0].what).toContain('will be tried again')
    expect(alerts()[0].message).toContain('Sam Example: Email is switched off')
    expect(alerts()[0].message).toContain('the member of staff who sent it')

    // Ten days on, email is still off. The step is left open again.
    completedAgo(result.documentId, 10 * DAY_MS)
    await finaliseSigningDocument(result.documentId)
    expect(document(result.documentId).copies_sent_at).toBeNull()
    expect(trail(result.documentId, 'signed_copy')).toHaveLength(0)

    // Email comes back. The signer gets their copy and the sender is told, once each.
    answerEmails()
    await finaliseSigningDocument(result.documentId)
    expect(emailsTo('sam@example.com')).toHaveLength(1)
    expect(emailsTo(SENDER_EMAIL)).toHaveLength(1)
    expect(trail(result.documentId, 'signed_copy')).toHaveLength(1)
    expect(trail(result.documentId, 'sender_notice')).toHaveLength(1)
    expect(document(result.documentId).copies_sent_at).toBeTruthy()

    await finaliseSigningDocument(result.documentId)
    expect(state.sendEmail).toHaveBeenCalledTimes(2)
  })

  it('stops trying a refused email by itself once the document was signed more than three days ago', async () => {
    const result = await readyToSign()
    // Held while email was off, so the step is still open when the days have passed.
    answerEmails({}, SUSPENDED)
    await everyoneSigns(result)
    expect(document(result.documentId).copies_sent_at).toBeNull()
    completedAgo(result.documentId, 3 * DAY_MS + HOUR_MS)
    answerEmails({ 'sam@example.com': REFUSED })
    state.alert.mockClear()

    await finaliseSigningDocument(result.documentId)

    // Refused, and too long ago to keep trying: the step stays closed and a person is told.
    expect(emailsTo('sam@example.com')).toHaveLength(1)
    expect(document(result.documentId).copies_sent_at).toBeTruthy()
    expect(trail(result.documentId, 'signed_copy')).toHaveLength(0)
    expect(alerts()).toEqual([
      { what: expect.stringContaining('signed copies were not all sent'), message: 'Signed copy not sent to Sam Example: mailbox unavailable' },
    ])
    expect(alerts()[0].what).not.toContain('tried again')

    answerEmails()
    await finaliseSigningDocument(result.documentId)
    expect(state.sendEmail).not.toHaveBeenCalled()
  })

  it('still tries a refused email again just inside three days', async () => {
    const result = await readyToSign()
    answerEmails({}, SUSPENDED)
    await everyoneSigns(result)
    completedAgo(result.documentId, 3 * DAY_MS - HOUR_MS)
    answerEmails({ 'sam@example.com': REFUSED })
    state.alert.mockClear()

    await finaliseSigningDocument(result.documentId)

    expect(document(result.documentId).copies_sent_at).toBeNull()
    expect(alerts()).toHaveLength(1)
    expect(alerts()[0].what).toContain('will be tried again')

    answerEmails()
    await finaliseSigningDocument(result.documentId)
    expect(emailsTo('sam@example.com')).toHaveLength(1)
    expect(document(result.documentId).copies_sent_at).toBeTruthy()
  })

  it('does not try again by itself after an error part way through, and keeps what had already gone', async () => {
    const result = await readyToSign([SAM, PAT])
    const [sam] = result.deliveries
    answerEmails({
      'pat@example.com': () => {
        throw new Error('socket hang up')
      },
    })

    await everyoneSigns(result)

    // Sam's copy went and is on the trail. Pat's attempt blew up, and nothing after it ran.
    expect(emailsTo('sam@example.com')).toHaveLength(1)
    expect(emailsTo(SENDER_EMAIL)).toHaveLength(0)
    expect(trail(result.documentId, 'signed_copy').map((row) => row.party_id)).toEqual([sam.partyId])
    expect(trail(result.documentId, 'sender_notice')).toHaveLength(0)
    expect(document(result.documentId).copies_sent_at).toBeTruthy()
    expect(alerts()).toHaveLength(1)
    expect(alerts()[0].what).toContain('signed copies were not all sent')
    expect(alerts()[0].what).not.toContain('tried again')
    // The alert names who is still without a copy, and only them, and keeps the original error.
    expect(alerts()[0].message).toContain('Pat Example')
    expect(alerts()[0].message).not.toContain('Sam Example')
    expect(alerts()[0].message).toContain('socket hang up')
    // The record was still updated.
    expect(state.hook).toHaveBeenCalledTimes(1)
    expect(document(result.documentId).completion_applied_at).toBeTruthy()

    answerEmails()
    await finaliseSigningDocument(result.documentId)
    expect(state.sendEmail).not.toHaveBeenCalled()
  })

  it('names everyone still waiting when the very first copy blows up', async () => {
    const result = await readyToSign([SAM, PAT])
    answerEmails({
      'sam@example.com': () => {
        throw new Error('socket hang up')
      },
    })

    await everyoneSigns(result)

    expect(trail(result.documentId, 'signed_copy')).toHaveLength(0)
    expect(emailsTo('pat@example.com')).toHaveLength(0)
    expect(alerts()).toHaveLength(1)
    expect(alerts()[0].message).toContain('Sam Example')
    expect(alerts()[0].message).toContain('Pat Example')
    expect(alerts()[0].message).toContain('socket hang up')
  })

  it('names the signer with no mark when the copy before theirs may or may not have gone', async () => {
    const result = await readyToSign([SAM, PAT])
    const [sam] = result.deliveries
    answerEmails({
      'sam@example.com': UNCERTAIN,
      'pat@example.com': () => {
        throw new Error('socket hang up')
      },
    })

    await everyoneSigns(result)

    // Sam is marked, as possibly delivered. Pat has no mark at all.
    expect(trail(result.documentId, 'signed_copy').map((row) => row.party_id)).toEqual([sam.partyId])
    expect(alerts()).toHaveLength(1)
    expect(alerts()[0].message).toContain('Pat Example')
    expect(alerts()[0].message).toContain('socket hang up')
  })

  it('still raises the alert, with the original error, when it cannot work out who is waiting', async () => {
    const result = await readyToSign([SAM, PAT])
    answerEmails({
      'pat@example.com': () => {
        // The trail cannot be read either, when it comes to listing who is left.
        db.failNext({ table: 'signing_events', operation: 'select', message: 'connection reset', times: 1 })
        throw new Error('socket hang up')
      },
    })

    await everyoneSigns(result)

    expect(alerts()).toHaveLength(1)
    expect(alerts()[0].what).toContain('signed copies were not all sent')
    expect(alerts()[0].message).toContain('socket hang up')
    expect(alerts()[0].message).toContain('could not be worked out')
    expect(document(result.documentId).copies_sent_at).toBeTruthy()
  })

  it('sends once when two callers finish the same document at the same moment', async () => {
    const result = await readyToSign([SAM, PAT])
    // Signed, but the finishing step could not run at the time.
    state.generatePdf = vi.fn(async () => {
      throw new Error('browser would not start')
    })
    await everyoneSigns(result)
    expect(document(result.documentId).final_pdf_path).toBeNull()
    state.generatePdf = vi.fn(async () => tinyPdf())
    answerEmails()
    state.alert.mockClear()

    await Promise.all([finaliseSigningDocument(result.documentId), finaliseSigningDocument(result.documentId)])

    expect(emailsTo('sam@example.com')).toHaveLength(1)
    expect(emailsTo('pat@example.com')).toHaveLength(1)
    expect(emailsTo(SENDER_EMAIL)).toHaveLength(1)
    expect(trail(result.documentId, 'signed_copy')).toHaveLength(2)
    expect(trail(result.documentId, 'sender_notice')).toHaveLength(1)
    expect(db.rows('signing_events').filter((row) => row.event === 'finalised')).toHaveLength(1)
    expect(document(result.documentId).copies_sent_at).toBeTruthy()
    expect(state.alert).not.toHaveBeenCalled()
  })

  it('reports a notice to the sender that was refused, without sending the signer a second copy', async () => {
    const result = await readyToSign()
    answerEmails({ [SENDER_EMAIL]: { success: false, error: 'staff mailbox full' } })

    await everyoneSigns(result)

    expect(emailsTo('sam@example.com')).toHaveLength(1)
    expect(emailsTo(SENDER_EMAIL)).toHaveLength(1)
    expect(trail(result.documentId, 'signed_copy')).toHaveLength(1)
    expect(trail(result.documentId, 'sender_notice')).toHaveLength(0)
    // A missed notice to our own staff does not reopen the step.
    expect(document(result.documentId).copies_sent_at).toBeTruthy()
    expect(alerts()).toHaveLength(1)
    expect(alerts()[0].what).toContain('signed copies were not all sent')
    expect(alerts()[0].what).not.toContain('tried again')
    expect(alerts()[0].message).toContain('the member of staff who sent it')
    expect(alerts()[0].message).toContain('staff mailbox full')
    expect(alerts()[0].message).not.toContain('Sam Example')

    // Whatever happens next, Sam is not sent a second copy.
    answerEmails()
    await finaliseSigningDocument(result.documentId)
    expect(emailsTo('sam@example.com')).toHaveLength(0)
    expect(trail(result.documentId, 'signed_copy')).toHaveLength(1)
  })

  it('tells the sender on the next pass when their notice and a signer were both refused the first time', async () => {
    const result = await readyToSign([SAM, PAT])
    answerEmails({ 'pat@example.com': REFUSED, [SENDER_EMAIL]: { success: false, error: 'staff mailbox full' } })

    await everyoneSigns(result)

    expect(document(result.documentId).copies_sent_at).toBeNull()
    expect(alerts()[0].message).toContain('Pat Example: mailbox unavailable')
    expect(alerts()[0].message).toContain('the member of staff who sent it')

    answerEmails()
    await finaliseSigningDocument(result.documentId)

    // Pat and the sender, who both missed out. Sam, who has a copy, is not sent another.
    expect(emailsTo('pat@example.com')).toHaveLength(1)
    expect(emailsTo(SENDER_EMAIL)).toHaveLength(1)
    expect(emailsTo('sam@example.com')).toHaveLength(0)
    expect(trail(result.documentId, 'signed_copy')).toHaveLength(2)
    expect(trail(result.documentId, 'sender_notice')).toHaveLength(1)
    expect(document(result.documentId).copies_sent_at).toBeTruthy()
  })

  it('does not mark the sender as told when their address could not be read, and tells them on a later pass', async () => {
    const result = await readyToSign([SAM, PAT])
    const users = (state.client as { auth: { admin: { getUserById: (id: string) => Promise<unknown> } } }).auth.admin
    const lookUp = users.getUserById
    users.getUserById = async () => {
      throw new Error('auth service timeout')
    }
    // Pat's copy is refused, so the step is left open for another pass.
    answerEmails({ 'pat@example.com': REFUSED })

    await everyoneSigns(result)

    // No notice went, so the trail does not say one did.
    expect(emailsTo(SENDER_EMAIL)).toHaveLength(0)
    expect(trail(result.documentId, 'sender_notice')).toHaveLength(0)
    expect(document(result.documentId).copies_sent_at).toBeNull()

    // On the next pass the address can be read.
    users.getUserById = lookUp
    answerEmails()
    await finaliseSigningDocument(result.documentId)

    expect(emailsTo(SENDER_EMAIL)).toHaveLength(1)
    expect(trail(result.documentId, 'sender_notice')).toHaveLength(1)
    expect(emailsTo('pat@example.com')).toHaveLength(1)
    expect(emailsTo('sam@example.com')).toHaveLength(0)

    document(result.documentId).copies_sent_at = null
    await finaliseSigningDocument(result.documentId)
    expect(emailsTo(SENDER_EMAIL)).toHaveLength(1)
  })

  it('writes no notice to the trail for a document with nobody to tell', async () => {
    const result = await readyToSign()
    // No member of staff is recorded as having sent it.
    document(result.documentId).created_by = null
    answerEmails()

    await everyoneSigns(result)

    expect(emailsTo('sam@example.com')).toHaveLength(1)
    expect(state.sendEmail).toHaveBeenCalledTimes(1)
    expect(trail(result.documentId, 'signed_copy')).toHaveLength(1)
    expect(trail(result.documentId, 'sender_notice')).toHaveLength(0)
    expect(document(result.documentId).copies_sent_at).toBeTruthy()
    // Nobody to tell is not a fault.
    expect(state.alert).not.toHaveBeenCalled()
  })

  it('writes no notice, and raises no alert, for a sender whose account has no email address', async () => {
    const result = await readyToSign()
    const users = (state.client as { auth: { admin: { getUserById: (id: string) => Promise<unknown> } } }).auth.admin
    users.getUserById = async (id: string) => ({ data: { user: { id, email: null, user_metadata: {} } }, error: null })
    answerEmails()

    await everyoneSigns(result)

    expect(emailsTo('sam@example.com')).toHaveLength(1)
    expect(state.sendEmail).toHaveBeenCalledTimes(1)
    expect(trail(result.documentId, 'sender_notice')).toHaveLength(0)
    expect(state.alert).not.toHaveBeenCalled()
  })

  const UNREADABLE_SENDERS: Array<{ how: string; lookUp: () => Promise<unknown> }> = [
    {
      how: 'the lookup blows up',
      lookUp: async () => {
        throw new Error('auth service timeout')
      },
    },
    { how: 'the lookup comes back with an error', lookUp: async () => ({ data: { user: null }, error: { message: 'auth service timeout' } }) },
  ]

  for (const { how, lookUp } of UNREADABLE_SENDERS) {
    it(`raises an alert, and marks nobody as told, when the address of the sender cannot be read because ${how}`, async () => {
      const result = await readyToSign()
      const users = (state.client as { auth: { admin: { getUserById: (id: string) => Promise<unknown> } } }).auth.admin
      users.getUserById = lookUp
      answerEmails()

      await everyoneSigns(result)

      // The signer has their copy. Not being able to find out who to tell is a fault, said out loud.
      expect(emailsTo('sam@example.com')).toHaveLength(1)
      expect(emailsTo(SENDER_EMAIL)).toHaveLength(0)
      expect(trail(result.documentId, 'signed_copy')).toHaveLength(1)
      expect(trail(result.documentId, 'sender_notice')).toHaveLength(0)
      expect(alerts()).toHaveLength(1)
      expect(alerts()[0].what).toContain('signed copies were not all sent')
      expect(alerts()[0].message).toContain('the member of staff who sent it')
      expect(alerts()[0].message).toContain('could not be read')
      expect(alerts()[0].message).toContain('auth service timeout')
      expect(alerts()[0].message).not.toContain('Sam Example')
      // The rest of the finishing was not held up.
      expect(state.hook).toHaveBeenCalledTimes(1)
      expect(document(result.documentId).completion_applied_at).toBeTruthy()
    })
  }

  it('says so when a refused copy could not be queued to send again', async () => {
    const result = await readyToSign()
    answerEmails({
      'sam@example.com': () => {
        // The write that reopens the step is the next one to this table.
        db.failNext({ table: 'signing_documents', operation: 'update', message: 'connection reset', times: 1 })
        return REFUSED
      },
    })

    await everyoneSigns(result)

    expect(document(result.documentId).copies_sent_at).toBeTruthy()
    expect(alerts().map((alert) => alert.what)).toEqual([
      expect.stringContaining('signed copies were not all sent, and will be tried again'),
      expect.stringContaining('signed copies could not be queued to send again'),
    ])
    expect(alerts()[1].message).toBe('connection reset')
  })

  it('skips the business and anyone with no email address', async () => {
    // The booking contract is signed for the venue as it is sent, so it has a company signer.
    const result = await send({ kind: 'private_booking_contract', parties: [SAM, { role: 'customer', name: 'Pat Example' }] })
    const [sam, pat] = result.deliveries
    answerEmails()
    await viewSigningDocument(await contextFor(sam.partyId), EVIDENCE)
    await signSigningParty({ context: await contextFor(sam.partyId), typedName: 'Sam Example', agreedText: AGREED, via: 'link', evidence: EVIDENCE })
    // Pat has no email address, so signs on a device handed over by a manager.
    const { url } = await startInPersonSigning({ partyId: pat.partyId, userId: STAFF })
    const inPerson = (await getSigningPartyByToken(url.split('/sign/')[1])) as SigningPartyContext
    await viewSigningDocument(inPerson, EVIDENCE)
    await signSigningParty({ context: await contextFor(pat.partyId), typedName: 'Pat Example', agreedText: AGREED, via: 'link', evidence: EVIDENCE })

    expect(document(result.documentId).status).toBe('completed')
    expect(emailsTo('sam@example.com')).toHaveLength(1)
    expect(state.sendEmail).toHaveBeenCalledTimes(2)
    expect(trail(result.documentId, 'signed_copy').map((row) => row.party_id)).toEqual([result.deliveries[0].partyId])
    expect(state.alert).not.toHaveBeenCalled()
  })
})

describe('the signed copy is checked before it leaves', () => {
  it('refuses to download a signed copy that no longer matches its fingerprint, and raises an alert', async () => {
    const result = await readyToSign()
    await everyoneSigns(result)
    const saved = document(result.documentId)
    files.set(saved.final_pdf_path as string, await tinyPdf(7))
    state.alert.mockClear()

    await expect(downloadSigningPdf({ documentId: result.documentId, userId: STAFF })).rejects.toMatchObject({ code: 'fingerprint_mismatch' })

    expect(alerts()).toEqual([
      { what: expect.stringContaining('signed copy does not match its fingerprint'), message: 'The signed copy does not match its fingerprint.' },
    ])
    expect(state.alert).toHaveBeenCalledWith(expect.any(String), expect.any(Error), expect.objectContaining({ documentId: result.documentId }))
    // Nothing was handed over, so nothing is recorded as downloaded.
    expect(db.rows('signing_events').some((row) => row.event === 'downloaded')).toBe(false)
  })

  it('refuses to download a signed copy that has no fingerprint recorded', async () => {
    const result = await readyToSign()
    await everyoneSigns(result)
    document(result.documentId).final_sha256 = null
    state.alert.mockClear()

    await expect(downloadSigningPdf({ documentId: result.documentId, userId: STAFF })).rejects.toMatchObject({ code: 'fingerprint_mismatch' })

    expect(alerts()).toEqual([
      { what: expect.stringContaining('signed copy does not match its fingerprint'), message: 'The signed copy does not match its fingerprint.' },
    ])
    expect(db.rows('signing_events').some((row) => row.event === 'downloaded')).toBe(false)
  })

  it('downloads a signed copy that matches, and notes who took it', async () => {
    const result = await readyToSign()
    await everyoneSigns(result)
    const saved = document(result.documentId)

    const download = await downloadSigningPdf({ documentId: result.documentId, userId: STAFF })

    expect(download).toMatchObject({ signed: true, fileName: 'Booking-contract-signed.pdf' })
    expect(sha256Hex(download.buffer)).toBe(saved.final_sha256)
    expect(db.rows('signing_events').filter((row) => row.event === 'downloaded')).toEqual([
      expect.objectContaining({ document_id: result.documentId, actor_user_id: STAFF, meta: { signed: true } }),
    ])
    expect(state.alert).not.toHaveBeenCalled()
  })

  const SPOILED_COPIES: Array<{ how: string; spoil: (documentId: string) => Promise<void> }> = [
    {
      how: 'no longer matches its fingerprint',
      spoil: async (documentId) => {
        files.set(document(documentId).final_pdf_path as string, await tinyPdf(7))
      },
    },
    {
      how: 'has no fingerprint recorded',
      spoil: async (documentId) => {
        document(documentId).final_sha256 = null
      },
    },
  ]

  for (const { how, spoil } of SPOILED_COPIES) {
    it(`emails nobody a signed copy that ${how}, and raises an alert`, async () => {
      const result = await readyToSign([SAM, PAT])
      // Email was off when it was signed, so the copies are still to go.
      answerEmails({}, SUSPENDED)
      await everyoneSigns(result)
      expect(document(result.documentId).copies_sent_at).toBeNull()
      await spoil(result.documentId)
      answerEmails()
      state.alert.mockClear()

      await finaliseSigningDocument(result.documentId)

      expect(state.sendEmail).not.toHaveBeenCalled()
      expect(trail(result.documentId, 'signed_copy')).toHaveLength(0)
      expect(trail(result.documentId, 'sender_notice')).toHaveLength(0)
      expect(alerts().some((alert) => alert.what.includes('signed copy does not match its fingerprint'))).toBe(true)
      // The alert about the copies names both signers, since neither has theirs, and says why.
      const notSent = alerts().find((alert) => alert.what.includes('signed copies were not all sent'))
      expect(notSent?.message).toContain('Sam Example')
      expect(notSent?.message).toContain('Pat Example')
      expect(notSent?.message).toContain('The signed copy does not match its fingerprint.')
      // It waits for a person: the step is not left open to run again every morning.
      expect(document(result.documentId).copies_sent_at).toBeTruthy()

      await finaliseSigningDocument(result.documentId)
      expect(state.sendEmail).not.toHaveBeenCalled()
    })
  }
})

describe('downloading a signed document whose finishing was left undone', () => {
  it('finishes the record update that failed when it was signed, and hands over the signed copy', async () => {
    const result = await readyToSign()
    state.hook = vi.fn(async () => {
      throw new Error('booking update failed')
    })
    await everyoneSigns(result)
    expect(document(result.documentId)).toMatchObject({ completion_applied_at: null })
    expect(document(result.documentId).final_pdf_path).toBeTruthy()
    state.hook = vi.fn(async () => undefined)
    answerEmails()
    state.alert.mockClear()

    const download = await downloadSigningPdf({ documentId: result.documentId, userId: STAFF })

    expect(download).toMatchObject({ signed: true, fileName: 'Booking-contract-signed.pdf' })
    expect(state.hook).toHaveBeenCalledTimes(1)
    expect(document(result.documentId).completion_applied_at).toBeTruthy()
    // The copies went when it was signed. They are not sent again.
    expect(state.sendEmail).not.toHaveBeenCalled()
    expect(state.alert).not.toHaveBeenCalled()
  })

  it('sends the copies that are still to go', async () => {
    const result = await readyToSign()
    answerEmails({ 'sam@example.com': REFUSED })
    await everyoneSigns(result)
    expect(document(result.documentId).copies_sent_at).toBeNull()
    answerEmails()

    const download = await downloadSigningPdf({ documentId: result.documentId, userId: STAFF })

    expect(download.signed).toBe(true)
    expect(emailsTo('sam@example.com')).toHaveLength(1)
    expect(document(result.documentId).copies_sent_at).toBeTruthy()
  })

  it('still hands over the signed copy, and raises an alert, when the finishing fails again', async () => {
    const result = await readyToSign()
    state.hook = vi.fn(async () => {
      throw new Error('booking update failed')
    })
    await everyoneSigns(result)
    const saved = document(result.documentId)
    state.alert.mockClear()

    const download = await downloadSigningPdf({ documentId: result.documentId, userId: STAFF })

    expect(download).toMatchObject({ signed: true, fileName: 'Booking-contract-signed.pdf' })
    expect(sha256Hex(download.buffer)).toBe(saved.final_sha256)
    expect(alerts()).toEqual([{ what: expect.stringContaining('finishing on download failed'), message: 'booking update failed' }])
    expect(state.alert).toHaveBeenCalledWith(expect.any(String), expect.any(Error), expect.objectContaining({ documentId: result.documentId }))
    expect(document(result.documentId).completion_applied_at).toBeNull()
    expect(db.rows('signing_events').filter((row) => row.event === 'downloaded')).toEqual([
      expect.objectContaining({ actor_user_id: STAFF, meta: { signed: true } }),
    ])
  })

  it('does the same for a version that has since been replaced', async () => {
    const result = await readyToSign()
    state.hook = vi.fn(async () => {
      throw new Error('booking update failed')
    })
    await everyoneSigns(result)
    document(result.documentId).status = 'superseded'
    state.hook = vi.fn(async () => undefined)

    const download = await downloadSigningPdf({ documentId: result.documentId, userId: STAFF })

    expect(download.signed).toBe(true)
    expect(state.hook).toHaveBeenCalledTimes(1)
    expect(document(result.documentId).completion_applied_at).toBeTruthy()
  })

  it('hands over a signed copy that was only just made, and raises an alert, when a later step then fails', async () => {
    const result = await readyToSign()
    state.generatePdf = vi.fn(async () => {
      throw new Error('browser would not start')
    })
    await everyoneSigns(result)
    expect(document(result.documentId).final_pdf_path).toBeNull()
    // The browser is back, so the signed copy can be made. The record update then fails.
    state.generatePdf = vi.fn(async () => tinyPdf())
    state.hook = vi.fn(async () => {
      throw new Error('booking update failed')
    })
    answerEmails()
    state.alert.mockClear()

    const download = await downloadSigningPdf({ documentId: result.documentId, userId: STAFF })

    const saved = document(result.documentId)
    expect(saved.final_pdf_path).toMatch(/signed\.pdf$/)
    expect(download).toMatchObject({ signed: true, fileName: 'Booking-contract-signed.pdf' })
    expect(sha256Hex(download.buffer)).toBe(saved.final_sha256)
    expect(alerts()).toEqual([{ what: expect.stringContaining('finishing on download failed'), message: 'booking update failed' }])
    expect(state.alert).toHaveBeenCalledWith(expect.any(String), expect.any(Error), expect.objectContaining({ documentId: result.documentId }))
    // The step that failed is left to be done again. The copy by email had already gone.
    expect(saved.completion_applied_at).toBeNull()
    expect(emailsTo('sam@example.com')).toHaveLength(1)
    expect(db.rows('signing_events').filter((row) => row.event === 'downloaded')).toEqual([
      expect.objectContaining({ actor_user_id: STAFF, meta: { signed: true } }),
    ])
  })

  it('fails when there is no signed copy and one still cannot be made', async () => {
    const result = await readyToSign()
    state.generatePdf = vi.fn(async () => {
      throw new Error('browser would not start')
    })
    await everyoneSigns(result)
    expect(document(result.documentId).final_pdf_path).toBeNull()

    await expect(downloadSigningPdf({ documentId: result.documentId, userId: STAFF })).rejects.toThrow('browser would not start')

    // The unsigned file is never handed over as if it were the signed one.
    expect(db.rows('signing_events').some((row) => row.event === 'downloaded')).toBe(false)
  })

  it('does not run the finishing again for a document that is fully finished', async () => {
    const result = await readyToSign()
    await everyoneSigns(result)
    expect(state.hook).toHaveBeenCalledTimes(1)
    answerEmails()

    await downloadSigningPdf({ documentId: result.documentId, userId: STAFF })
    await downloadSigningPdf({ documentId: result.documentId, userId: STAFF })

    expect(state.hook).toHaveBeenCalledTimes(1)
    expect(state.sendEmail).not.toHaveBeenCalled()
    expect(db.rows('signing_events').filter((row) => row.event === 'finalised')).toHaveLength(1)
  })
})

describe('staff actions', () => {
  it('lists documents with their signers and never the link hashes', async () => {
    await send()
    const list = await listSigningDocumentsForSubject('private_booking', SUBJECT)
    expect(list).toHaveLength(1)
    expect(list[0].parties).toHaveLength(1)
    expect(list[0].parties[0]).not.toHaveProperty('hashed_token')
    expect(await listSigningDocumentsForSubject('private_booking', '33333333-3333-4333-8333-333333333333')).toEqual([])
  })

  it('names the other documents the same person still has to sign on the same record', async () => {
    const waiver = await send({ title: 'Self-catering agreement' })
    const contract = await send({ kind: 'private_booking_contract', title: 'Booking contract' })
    const waiverParty = waiver.deliveries[0].partyId
    const contractParty = contract.deliveries[0].partyId

    expect(await listOtherDocumentsToSign(await contextFor(waiverParty))).toEqual(['Booking contract'])
    expect(await listOtherDocumentsToSign(await contextFor(contractParty))).toEqual(['Self-catering agreement'])

    // Once the other one is signed there is nothing left to mention.
    await viewSigningDocument(await contextFor(waiverParty), EVIDENCE)
    await signSigningParty({
      context: await contextFor(waiverParty),
      typedName: 'Sam Example',
      agreedText: buildAgreedText({ mode: 'sign', title: 'Self-catering agreement' }),
      via: 'link',
      evidence: EVIDENCE,
    })
    expect(await listOtherDocumentsToSign(await contextFor(contractParty))).toEqual([])
  })

  it('does not name a document that is for somebody else, or on another record', async () => {
    const mine = await send({ title: 'Self-catering agreement' })
    await send({ kind: 'private_booking_contract', title: 'Booking contract', parties: [{ role: 'customer', name: 'Pat Other', email: 'pat@example.com' }] })
    await send({ kind: 'private_booking_contract', title: 'Another booking', subjectId: '33333333-3333-4333-8333-333333333333' })
    expect(await listOtherDocumentsToSign(await contextFor(mine.deliveries[0].partyId))).toEqual([])
  })

  it('sends a fresh link on a reminder and kills the earlier one', async () => {
    const result = await send()
    const partyId = result.deliveries[0].partyId
    const firstToken = tokenFromEmail(0)

    await resendSigningLink({ partyId, userId: STAFF, isReminder: true })
    const secondToken = tokenFromEmail(1)
    expect(secondToken).not.toBe(firstToken)
    expect(await getSigningPartyByToken(firstToken)).toBeNull()
    expect((await getSigningPartyByToken(secondToken))?.party.id).toBe(partyId)
    expect(party(partyId)).toMatchObject({ reminder_count: 1 })
    expect((state.sendEmail.mock.calls[1][0] as { subject: string }).subject).toBe('Reminder: Booking contract')
    expect(db.rows('signing_events').some((row) => row.event === 'reminded' && row.actor_user_id === STAFF)).toBe(true)
  })

  it('says so when the reminder email fails, and does not record it as sent', async () => {
    const result = await send()
    state.sendEmail = vi.fn(async () => ({ success: false, error: 'mailbox unavailable' }))
    await expect(resendSigningLink({ partyId: result.deliveries[0].partyId, userId: STAFF, isReminder: true })).rejects.toMatchObject({ code: 'email_failed' })
    expect(db.rows('signing_events').some((row) => row.event === 'reminded')).toBe(false)
  })

  describe('sending a fresh link', () => {
    /** What the earlier link had been used for, so a test can see what a new link keeps or clears. */
    function earlierLinkState() {
      return {
        identity_check_failures: 2,
        identity_checked_at: '2026-10-12T12:30:00.000Z',
        document_viewed_at: '2026-10-12T12:31:00.000Z',
        witnessed_by: STAFF,
        // Its own expiry, different from the request's, so putting it back can be told apart.
        token_expires_at: new Date(Date.now() + 5 * DAY_MS).toISOString(),
      }
    }

    async function sentWithEarlierLinkInUse(): Promise<{
      documentId: string
      partyId: string
      firstToken: string
      firstHash: string
      earlier: ReturnType<typeof earlierLinkState>
    }> {
      const result = await send()
      const partyId = result.deliveries[0].partyId
      const earlier = earlierLinkState()
      Object.assign(party(partyId), earlier)
      return { documentId: result.documentId, partyId, firstToken: tokenFromEmail(0), firstHash: party(partyId).hashed_token as string, earlier }
    }

    it('starts the new link from nothing: the date of birth check, the opening and the attempts all begin again', async () => {
      const { partyId, firstToken } = await sentWithEarlierLinkInUse()

      await resendSigningLink({ partyId, userId: STAFF, isReminder: false })

      const newToken = tokenFromEmail(1)
      const stored = party(partyId)
      expect(stored).toMatchObject({
        hashed_token: hashSigningToken(newToken),
        identity_check_failures: 0,
        identity_checked_at: null,
        document_viewed_at: null,
        witnessed_by: null,
      })
      // The new link lasts as long as the request does, not as long as the earlier link did.
      expect(stored.token_expires_at).toBe(document(stored.document_id).expires_at)
      expect(await getSigningPartyByToken(firstToken)).toBeNull()
      expect((await getSigningPartyByToken(newToken))?.party.id).toBe(partyId)

      // Whoever holds the new link has to open the document themselves before they can sign.
      const withNewLink = (await getSigningPartyByToken(newToken)) as SigningPartyContext
      expect(
        await signSigningParty({ context: withNewLink, typedName: 'Sam Example', agreedText: AGREED, via: 'link', evidence: EVIDENCE })
      ).toEqual({ ok: false, reason: 'document_not_viewed' })
    })

    it('counts a reminder, with the time, once the email has gone', async () => {
      const { documentId, partyId } = await sentWithEarlierLinkInUse()
      const before = Date.now()

      await resendSigningLink({ partyId, userId: null, isReminder: true })

      const stored = party(partyId)
      expect(stored.reminder_count).toBe(1)
      expect(new Date(stored.last_reminded_at as string).getTime()).toBeGreaterThanOrEqual(before - 1000)
      expect(db.rows('signing_events').filter((row) => row.event === 'reminded')).toEqual([
        expect.objectContaining({ document_id: documentId, party_id: partyId, actor_user_id: null, meta: { to: 'sam@example.com' } }),
      ])

      await resendSigningLink({ partyId, userId: null, isReminder: true })
      expect(party(partyId).reminder_count).toBe(2)
    })

    it('does not count a link sent again by staff as a reminder', async () => {
      const { documentId, partyId } = await sentWithEarlierLinkInUse()

      await resendSigningLink({ partyId, userId: STAFF, isReminder: false })

      expect(party(partyId)).toMatchObject({ reminder_count: 0, last_reminded_at: null })
      expect((state.sendEmail.mock.calls[1][0] as { subject: string }).subject).not.toContain('Reminder')
      expect(db.rows('signing_events').some((row) => row.event === 'reminded')).toBe(false)
      expect(db.rows('signing_events').filter((row) => row.event === 'resent')).toEqual([
        expect.objectContaining({ document_id: documentId, party_id: partyId, actor_user_id: STAFF }),
      ])
    })

    it('puts the earlier link back exactly when the email was definitely refused, so the link they hold still works', async () => {
      const { documentId, partyId, firstToken, firstHash, earlier } = await sentWithEarlierLinkInUse()
      answerEmails({ 'sam@example.com': REFUSED })

      await expect(resendSigningLink({ partyId, userId: STAFF, isReminder: true })).rejects.toMatchObject({
        code: 'email_failed',
        message: expect.stringContaining('mailbox unavailable'),
      })

      // Everything known about the earlier link is as it was.
      expect(party(partyId)).toMatchObject({ hashed_token: firstHash, ...earlier })
      expect(earlier.token_expires_at).not.toBe(document(documentId).expires_at)
      // A reminder that did not go is not counted, so it is tried again tomorrow.
      expect(party(partyId)).toMatchObject({ reminder_count: 0, last_reminded_at: null })
      expect(db.rows('signing_events').some((row) => row.event === 'reminded' || row.event === 'resent')).toBe(false)
      expect(state.alert).not.toHaveBeenCalled()

      // The link in the email that never arrived is dead. The one they already hold is live.
      const refusedToken = tokenFromEmail(0)
      expect(refusedToken).not.toBe(firstToken)
      expect(await getSigningPartyByToken(refusedToken)).toBeNull()
      const withEarlierLink = await getSigningPartyByToken(firstToken)
      expect(withEarlierLink?.party.id).toBe(partyId)

      // And it signs, with the opening it already had.
      answerEmails()
      expect(
        await signSigningParty({ context: withEarlierLink as SigningPartyContext, typedName: 'Sam Example', agreedText: AGREED, via: 'link', evidence: EVIDENCE })
      ).toEqual({ ok: true, completed: true, documentId })
    })

    it('keeps the new link when it cannot tell whether the email went, since they may be holding it', async () => {
      const { partyId, firstToken } = await sentWithEarlierLinkInUse()
      answerEmails({ 'sam@example.com': UNCERTAIN })

      const refusal = await resendSigningLink({ partyId, userId: STAFF, isReminder: true }).then(
        () => null,
        (error: unknown) => error as { code?: string; message: string }
      )

      // It still fails, and says that the email may not have gone, not that it did not.
      expect(refusal).toMatchObject({ code: 'email_failed' })
      expect(refusal?.message).toContain('may not have been sent')
      expect(refusal?.message).toContain('the connection dropped')
      expect(refusal?.message).not.toContain('could not be sent')

      const newToken = tokenFromEmail(0)
      expect((await getSigningPartyByToken(newToken))?.party.id).toBe(partyId)
      expect(await getSigningPartyByToken(firstToken)).toBeNull()
      expect(party(partyId)).toMatchObject({
        hashed_token: hashSigningToken(newToken),
        identity_check_failures: 0,
        identity_checked_at: null,
        document_viewed_at: null,
        witnessed_by: null,
      })
    })

    it('counts a reminder that may or may not have gone, so the daily job does not send another and kill a link they may hold', async () => {
      const { partyId } = await sentWithEarlierLinkInUse()
      const before = Date.now()
      answerEmails({ 'sam@example.com': UNCERTAIN })

      await expect(resendSigningLink({ partyId, userId: null, isReminder: true })).rejects.toMatchObject({ code: 'email_failed' })

      const stored = party(partyId)
      expect(stored.reminder_count).toBe(1)
      expect(new Date(stored.last_reminded_at as string).getTime()).toBeGreaterThanOrEqual(before - 1000)
      expect(state.alert).not.toHaveBeenCalled()
    })

    it('writes a reminder of unknown outcome to the trail, marked as such', async () => {
      const { documentId, partyId } = await sentWithEarlierLinkInUse()
      answerEmails({ 'sam@example.com': UNCERTAIN })

      await expect(resendSigningLink({ partyId, userId: null, isReminder: true })).rejects.toMatchObject({ code: 'email_failed' })

      expect(db.rows('signing_events').filter((row) => row.event === 'reminded')).toEqual([
        expect.objectContaining({
          document_id: documentId,
          party_id: partyId,
          actor_user_id: null,
          meta: expect.objectContaining({ to: 'sam@example.com', outcome: 'uncertain' }),
        }),
      ])
    })

    it('does not mark a reminder that went as one of unknown outcome', async () => {
      const { partyId } = await sentWithEarlierLinkInUse()

      await resendSigningLink({ partyId, userId: null, isReminder: true })

      const reminded = db.rows('signing_events').filter((row) => row.event === 'reminded')
      expect(reminded).toHaveLength(1)
      expect((reminded[0].meta as { outcome?: string }).outcome).toBeUndefined()
    })

    it('writes nothing to the trail for a refused reminder, or for a link sent again by staff whose outcome is not known', async () => {
      const refused = await sentWithEarlierLinkInUse()
      answerEmails({ 'sam@example.com': REFUSED })
      await expect(resendSigningLink({ partyId: refused.partyId, userId: null, isReminder: true })).rejects.toMatchObject({ code: 'email_failed' })

      answerEmails({ 'sam@example.com': UNCERTAIN })
      await expect(resendSigningLink({ partyId: refused.partyId, userId: STAFF, isReminder: false })).rejects.toMatchObject({ code: 'email_failed' })

      expect(db.rows('signing_events').some((row) => row.event === 'reminded' || row.event === 'resent')).toBe(false)
    })

    it('raises an alert when a reminder of unknown outcome could not be written to the trail, and still reports the email', async () => {
      const { documentId, partyId } = await sentWithEarlierLinkInUse()
      answerEmails({
        'sam@example.com': () => {
          // The line on the trail is the next thing written to this table.
          db.failNext({ table: 'signing_events', operation: 'insert', message: 'connection reset', times: 1 })
          return UNCERTAIN
        },
      })

      await expect(resendSigningLink({ partyId, userId: null, isReminder: true })).rejects.toMatchObject({
        code: 'email_failed',
        message: expect.stringContaining('may not have been sent'),
      })

      expect(alerts()).toEqual([
        { what: expect.stringContaining('a reminder of unknown outcome was not written to the trail'), message: expect.stringContaining('connection reset') },
      ])
      expect(state.alert).toHaveBeenCalledWith(expect.any(String), expect.any(Error), { documentId, partyId })
      // It is still counted, so the daily job does not send another.
      expect(party(partyId).reminder_count).toBe(1)
      expect(db.rows('signing_events').some((row) => row.event === 'reminded')).toBe(false)
    })

    it('counts a reminder whose sending blew up part way, for the same reason', async () => {
      const { partyId } = await sentWithEarlierLinkInUse()
      state.sendEmail = vi.fn(async () => {
        throw new Error('socket hang up')
      })

      const refusal = await resendSigningLink({ partyId, userId: null, isReminder: true }).then(
        () => null,
        (error: unknown) => error as { code?: string; message: string }
      )

      expect(refusal).toMatchObject({ code: 'email_failed' })
      expect(refusal?.message).toContain('may not have been sent')
      expect(refusal?.message).toContain('socket hang up')
      expect(party(partyId).reminder_count).toBe(1)
    })

    it('does not count a refused reminder, however many times it is refused', async () => {
      const { partyId, firstHash } = await sentWithEarlierLinkInUse()
      answerEmails({ 'sam@example.com': REFUSED })

      for (let attempt = 0; attempt < 3; attempt += 1) {
        const refusal = await resendSigningLink({ partyId, userId: null, isReminder: true }).then(
          () => null,
          (error: unknown) => error as { code?: string; message: string }
        )
        expect(refusal).toMatchObject({ code: 'email_failed' })
        expect(refusal?.message).toContain('could not be sent')
        expect(refusal?.message).not.toContain('may not have been sent')
      }

      // Tried again tomorrow, and the link they hold still works meanwhile.
      expect(party(partyId)).toMatchObject({ reminder_count: 0, last_reminded_at: null, hashed_token: firstHash })
    })

    it('does not count a link sent again by staff as a reminder when its outcome is not known', async () => {
      const { partyId } = await sentWithEarlierLinkInUse()
      answerEmails({ 'sam@example.com': UNCERTAIN })

      await expect(resendSigningLink({ partyId, userId: STAFF, isReminder: false })).rejects.toMatchObject({ code: 'email_failed' })

      expect(party(partyId)).toMatchObject({ reminder_count: 0, last_reminded_at: null })
    })

    it('raises an alert when a reminder of unknown outcome could not be counted, and still reports the email', async () => {
      const { documentId, partyId } = await sentWithEarlierLinkInUse()
      answerEmails({
        'sam@example.com': () => {
          // The write that counts the reminder is the next one to this table.
          db.failNext({ table: 'signing_parties', operation: 'update', message: 'connection reset', times: 1 })
          return UNCERTAIN
        },
      })

      await expect(resendSigningLink({ partyId, userId: null, isReminder: true })).rejects.toMatchObject({
        code: 'email_failed',
        message: expect.stringContaining('may not have been sent'),
      })

      expect(alerts()).toEqual([
        { what: expect.stringContaining('a reminder of unknown outcome could not be counted'), message: 'connection reset' },
      ])
      expect(state.alert).toHaveBeenCalledWith(expect.any(String), expect.any(Error), { documentId, partyId })
    })

    it('keeps the new link when sending the email blew up part way', async () => {
      const { partyId, firstToken } = await sentWithEarlierLinkInUse()
      let attemptedText = ''
      state.sendEmail = vi.fn(async (options: { text: string }) => {
        attemptedText = options.text
        throw new Error('socket hang up')
      })

      await expect(resendSigningLink({ partyId, userId: STAFF, isReminder: false })).rejects.toMatchObject({
        name: 'SigningError',
        code: 'email_failed',
        message: expect.stringContaining('socket hang up'),
      })

      const newToken = (attemptedText.match(/\/sign\/([A-Za-z0-9_-]{43})/) as RegExpMatchArray)[1]
      expect((await getSigningPartyByToken(newToken))?.party.id).toBe(partyId)
      expect(await getSigningPartyByToken(firstToken)).toBeNull()
      expect(db.rows('signing_events').some((row) => row.event === 'resent')).toBe(false)
    })

    it('sends nothing when another send replaced the link first, and leaves that link alone', async () => {
      const { partyId, earlier } = await sentWithEarlierLinkInUse()
      answerEmails()
      // Between this send reading the signer and writing the new link, another send wrote its own.
      let otherSendGotThere = false
      db.beforeUpdate((table, matched) => {
        if (table !== 'signing_parties' || otherSendGotThere) return
        otherSendGotThere = true
        for (const row of matched) row.hashed_token = 'the-link-the-other-send-issued'
      })

      await expect(resendSigningLink({ partyId, userId: STAFF, isReminder: true })).rejects.toMatchObject({ code: 'busy' })

      expect(otherSendGotThere).toBe(true)
      expect(state.sendEmail).not.toHaveBeenCalled()
      // The other send's link stands, with everything else as it was.
      expect(party(partyId)).toMatchObject({ hashed_token: 'the-link-the-other-send-issued', ...earlier, reminder_count: 0 })
      expect(db.rows('signing_events').some((row) => row.event === 'reminded')).toBe(false)
    })

    it('sends one working link when two sends are asked for at the same moment', async () => {
      const { partyId, firstToken } = await sentWithEarlierLinkInUse()
      answerEmails()

      const outcomes = await Promise.allSettled([
        resendSigningLink({ partyId, userId: STAFF, isReminder: false }),
        resendSigningLink({ partyId, userId: STAFF, isReminder: false }),
      ])

      expect(outcomes.map((outcome) => outcome.status).sort()).toEqual(['fulfilled', 'rejected'])
      const refused = outcomes.find((outcome) => outcome.status === 'rejected') as PromiseRejectedResult
      expect(refused.reason).toMatchObject({ code: 'busy' })
      // One email, and the link in it is the one that works.
      expect(state.sendEmail).toHaveBeenCalledTimes(1)
      expect((await getSigningPartyByToken(tokenFromEmail(0)))?.party.id).toBe(partyId)
      expect(await getSigningPartyByToken(firstToken)).toBeNull()
    })

    it('issues a first link to a signer who had none', async () => {
      const { partyId } = await sentWithEarlierLinkInUse()
      Object.assign(party(partyId), { hashed_token: null, token_expires_at: null })
      answerEmails()

      await resendSigningLink({ partyId, userId: STAFF, isReminder: false })

      expect((await getSigningPartyByToken(tokenFromEmail(0)))?.party.id).toBe(partyId)
    })

    it('raises an alert when the earlier link could not be put back after a refused email', async () => {
      const { documentId, partyId } = await sentWithEarlierLinkInUse()
      answerEmails({
        'sam@example.com': () => {
          // The write that puts the earlier link back is the next one to this table.
          db.failNext({ table: 'signing_parties', operation: 'update', message: 'connection reset', times: 1 })
          return REFUSED
        },
      })

      await expect(resendSigningLink({ partyId, userId: STAFF, isReminder: false })).rejects.toMatchObject({ code: 'email_failed' })

      expect(alerts()).toEqual([
        { what: expect.stringContaining('the earlier signing link could not be restored after a failed email'), message: 'connection reset' },
      ])
      expect(state.alert).toHaveBeenCalledWith(expect.any(String), expect.any(Error), { documentId, partyId })
    })

    it('says so when a reminder went but could not be counted, and does not record it as sent', async () => {
      const { partyId } = await sentWithEarlierLinkInUse()
      answerEmails({
        'sam@example.com': () => {
          db.failNext({ table: 'signing_parties', operation: 'update', message: 'connection reset', times: 1 })
          return { success: true, messageId: 'm2' }
        },
      })

      await expect(resendSigningLink({ partyId, userId: null, isReminder: true })).rejects.toThrow(
        'The reminder went, but could not be counted: connection reset'
      )

      expect(party(partyId).reminder_count).toBe(0)
      // The link in the email that went is the live one.
      expect((await getSigningPartyByToken(tokenFromEmail(0)))?.party.id).toBe(partyId)
    })
  })

  it('makes someone signing in person open the document on that device, whatever they opened by link before', async () => {
    const result = await readyToSign()
    const partyId = result.deliveries[0].partyId
    expect(party(partyId).document_viewed_at).toBeTruthy()

    const { url } = await startInPersonSigning({ partyId, userId: STAFF })

    expect(party(partyId)).toMatchObject({ document_viewed_at: null, witnessed_by: STAFF })
    const inPerson = (await getSigningPartyByToken(url.split('/sign/')[1])) as SigningPartyContext
    // Signing straight away is refused: the document has not been opened in front of the manager.
    expect(
      await signSigningParty({ context: inPerson, typedName: 'Sam Example', agreedText: AGREED, via: 'link', evidence: EVIDENCE })
    ).toEqual({ ok: false, reason: 'document_not_viewed' })
    expect(party(partyId).status).toBe('pending')

    await viewSigningDocument(inPerson, EVIDENCE)
    expect(
      await signSigningParty({ context: await contextFor(partyId), typedName: 'Sam Example', agreedText: AGREED, via: 'link', evidence: EVIDENCE })
    ).toMatchObject({ ok: true, completed: true })
    expect(party(partyId)).toMatchObject({ status: 'signed', method: 'in_person', witnessed_by: STAFF })
  })

  it('starts in-person signing with a half-hour link that names the manager present', async () => {
    const result = await send({ parties: [{ role: 'customer', name: 'Sam Example' }] })
    const partyId = result.deliveries[0].partyId
    const before = Date.now()
    const { url } = await startInPersonSigning({ partyId, userId: STAFF })
    const token = url.split('/sign/')[1]
    const context = await getSigningPartyByToken(token)
    expect(context?.party.witnessed_by).toBe(STAFF)
    const lifetime = new Date(context?.party.token_expires_at as string).getTime() - before
    expect(lifetime).toBeGreaterThan(29 * 60 * 1000)
    expect(lifetime).toBeLessThanOrEqual(30 * 60 * 1000 + 1000)

    await viewSigningDocument(context as SigningPartyContext, EVIDENCE)
    const outcome = await signSigningParty({
      context: await contextFor(partyId),
      typedName: 'Sam Example',
      agreedText: buildAgreedText({ mode: 'sign', title: 'Booking contract' }),
      via: 'link',
      evidence: EVIDENCE,
    })
    expect(outcome).toMatchObject({ ok: true })
    expect(party(partyId)).toMatchObject({ method: 'in_person', witnessed_by: STAFF })
    expect(state.generatePdf.mock.calls[0][0]).toContain('Billy Summers')
  })

  it('withdraws an open request and refuses to withdraw a signed one', async () => {
    const result = await send()
    await voidSigningDocument({ documentId: result.documentId, userId: STAFF, reason: 'Sent to the wrong person' })
    expect(document(result.documentId)).toMatchObject({ status: 'voided', voided_by: STAFF, void_reason: 'Sent to the wrong person' })
    await expect(voidSigningDocument({ documentId: result.documentId, userId: STAFF, reason: 'Again' })).rejects.toMatchObject({ code: 'not_open' })
    await expect(resendSigningLink({ partyId: result.deliveries[0].partyId, userId: STAFF, isReminder: false })).rejects.toMatchObject({ code: 'not_open' })
    await expect(startInPersonSigning({ partyId: result.deliveries[0].partyId, userId: STAFF })).rejects.toMatchObject({ code: 'not_open' })
  })

  it('downloads the document as sent while it is unsigned, and notes who took it', async () => {
    const result = await send()
    const download = await downloadSigningPdf({ documentId: result.documentId, userId: STAFF })
    expect(download).toMatchObject({ signed: false, fileName: 'Booking-contract.pdf' })
    expect(db.rows('signing_events').some((row) => row.event === 'downloaded' && row.actor_user_id === STAFF)).toBe(true)
  })
})
