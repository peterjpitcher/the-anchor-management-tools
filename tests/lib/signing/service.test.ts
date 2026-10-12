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
}))

vi.mock('@/lib/env', () => ({ getAppUrl: () => 'https://management.example.test' }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => state.client }))
vi.mock('@/lib/email/emailService', () => ({ sendEmail: (...args: unknown[]) => state.sendEmail(...args) }))
vi.mock('@/lib/email/invoice-sender', () => ({ invoiceEmailRouting: () => ({ from: 'Orange Jelly <billing@example.test>' }) }))
vi.mock('@/lib/pdf-generator', () => ({ generatePDFFromHTML: (...args: unknown[]) => state.generatePdf(...args) }))
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
  listSigningDocumentsForSubject,
  readSourcePdf,
  recordSigningOpened,
  resendSigningLink,
  resolveSigningPartyState,
  signSigningParty,
  startInPersonSigning,
  viewSigningDocument,
  voidSigningDocument,
  type SigningPartyContext,
} from '@/lib/signing/service'
import { hashSigningToken, sha256Hex } from '@/lib/signing/tokens'
import type { SigningDocumentRow, SigningPartyRow } from '@/lib/signing/types'

const SUBJECT = '11111111-1111-4111-8111-111111111111'
const STAFF = '22222222-2222-4222-8222-222222222222'
const EVIDENCE = { ip: '203.0.113.9', userAgent: 'test-agent', city: 'Staines', region: 'ENG', country: 'GB' }

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
  if (remaining === 0) document.completed_at = '2026-10-12T13:05:09.000Z'
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
})

async function send(overrides: Partial<Parameters<typeof createSigningRequest>[0]> = {}) {
  return createSigningRequest({
    kind: 'private_booking_contract',
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

  it('numbers versions per record and withdraws the earlier unsigned request', async () => {
    const first = await send()
    const second = await send()
    expect(document(second.documentId).version).toBe(2)
    expect(document(first.documentId)).toMatchObject({ status: 'voided', void_reason: 'Replaced by version 2' })

    // A different series on the same record is left alone.
    const waiver = await send({ kind: 'private_booking_waiver', title: 'Waiver' })
    expect(document(waiver.documentId).version).toBe(1)
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

  it('says so when we hold no date of birth to compare with', async () => {
    db.rows('employees')[0].date_of_birth = null
    const partyId = await newStarter()
    expect(await checkSigningIdentity(await contextFor(partyId), '2000-03-14', EVIDENCE)).toMatchObject({ ok: false, reason: 'no_record' })
    expect(party(partyId).identity_check_failures).toBe(0)
  })
})

describe('signing', () => {
  async function readyToSign(parties = [{ role: 'customer' as const, name: 'Sam Example', email: 'sam@example.com' }]) {
    const result = await send({ parties })
    for (const delivery of result.deliveries) {
      await viewSigningDocument(await contextFor(delivery.partyId), EVIDENCE)
    }
    return result
  }
  const agreed = buildAgreedText({ mode: 'sign', title: 'Booking contract' })

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

  it('retries the record update when it fails, without sending the copies twice', async () => {
    const result = await readyToSign()
    state.hook = vi.fn(async () => {
      throw new Error('booking update failed')
    })
    await signSigningParty({ context: await contextFor(result.deliveries[0].partyId), typedName: 'Sam Example', agreedText: agreed, via: 'link', evidence: EVIDENCE })
    expect(document(result.documentId)).toMatchObject({ completion_applied_at: null })
    expect(document(result.documentId).final_pdf_path).toBeTruthy()
    expect(state.alert).toHaveBeenCalled()
    const emailsSoFar = state.sendEmail.mock.calls.length

    state.hook = vi.fn(async () => undefined)
    await finaliseSigningDocument(result.documentId)
    expect(state.hook).toHaveBeenCalledTimes(1)
    expect(document(result.documentId).completion_applied_at).toBeTruthy()
    // The signed copy was already written, so this caller does not send copies again.
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
