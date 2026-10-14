// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * Signing in the staff portal. /api is public at the middleware level, so this endpoint checks
 * the session itself, and a refused signature has to be explained in words a worker can act on.
 */

const mocks = vi.hoisted(() => ({
  worker: vi.fn(),
  partyContext: vi.fn(),
  withdraw: vi.fn(),
  sign: vi.fn(),
  alert: vi.fn(),
}))

vi.mock('@/lib/cron/alerting', () => ({ reportCronFailure: mocks.alert }))
// Who is signed in, and whether the document is theirs. Tested on its own in tests/lib/signing/portal.test.ts.
vi.mock('@/lib/signing/portal', () => ({ getPortalWorker: mocks.worker, getPortalPartyContext: mocks.partyContext }))
vi.mock('@/lib/signing/service', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/signing/service')>()
  return { ...original, withdrawIfSubjectClosed: mocks.withdraw, signSigningParty: mocks.sign }
})

import { POST as signPost } from '@/app/api/portal/signing/[partyId]/sign/route'
import type { SigningPartyContext } from '@/lib/signing/service'

const PARTY = 'party-1'
const WORKER = { userId: '22222222-2222-4222-8222-222222222222', employeeId: 'emp-1' }
const FUTURE = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

function context(party: Record<string, unknown> = {}, document: Record<string, unknown> = {}): SigningPartyContext {
  // Cast: only the fields the endpoint and the state check read are given.
  return {
    party: {
      id: PARTY,
      document_id: 'doc-1',
      status: 'pending',
      token_expires_at: null,
      identity_check: 'date_of_birth',
      identity_check_failures: 0,
      identity_checked_at: null,
      witnessed_by: null,
      ...party,
    },
    document: { id: 'doc-1', status: 'part_signed', expires_at: FUTURE, mode: 'sign', title: 'Worker agreement', ...document },
  } as unknown as SigningPartyContext
}

function request(body?: unknown): NextRequest {
  return new NextRequest(`https://management.example.test/api/portal/signing/${PARTY}/sign`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9', 'user-agent': 'test-agent', 'x-vercel-ip-city': 'Staines' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

const params = { params: Promise.resolve({ partyId: PARTY }) }
const goodSignature = { typed_name: 'Sam Example', agreed: true, agreed_text: 'I agree.' }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.worker.mockResolvedValue(WORKER)
  mocks.partyContext.mockResolvedValue(context())
  // The record behind the document still needs signing, unless a test says otherwise.
  mocks.withdraw.mockImplementation(async (found: SigningPartyContext) => found)
  mocks.alert.mockResolvedValue(undefined)
})

describe('signing in the staff portal', () => {
  it('records the signature as made in the portal, by the worker who is signed in', async () => {
    mocks.sign.mockResolvedValue({ ok: true, completed: true, documentId: 'doc-1' })

    const response = await signPost(request(goodSignature), params)

    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ success: true, signed: true, completed: true })
    expect(mocks.partyContext).toHaveBeenCalledWith(WORKER, PARTY)
    expect(mocks.sign).toHaveBeenCalledTimes(1)
    expect(mocks.sign).toHaveBeenCalledWith(
      expect.objectContaining({
        typedName: 'Sam Example',
        agreedText: 'I agree.',
        via: 'portal',
        authUserId: WORKER.userId,
        evidence: expect.objectContaining({ ip: '203.0.113.9', userAgent: 'test-agent', city: 'Staines' }),
      })
    )
  })

  it('does not ask for a date of birth or hold the worker to a link expiry: being signed in is the check', async () => {
    mocks.partyContext.mockResolvedValue(context({ identity_check: 'date_of_birth', identity_checked_at: null, token_expires_at: null }))
    mocks.sign.mockResolvedValue({ ok: true, completed: false, documentId: 'doc-1' })

    const response = await signPost(request(goodSignature), params)

    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ success: true, signed: true, completed: false })
  })

  it('says a document withdrawn in the moment before signing has been withdrawn', async () => {
    // The page was open and the document was live when the request came in. By the time the
    // signature was about to be recorded, the record behind it had moved on.
    mocks.sign.mockResolvedValue({ ok: false, reason: 'document_voided' })

    const response = await signPost(request(goodSignature), params)

    expect(response.status).toBe(409)
    const body = await response.json()
    expect(body).toMatchObject({ success: false, error: { code: 'REFUSED', reason: 'document_voided' } })
    expect(body.error.message).toBe('This document has been withdrawn. There is nothing for you to sign.')
    // Not the catch-all, which would send them to a manager about a document that no longer exists.
    expect(body.error.message).not.toContain('speak to your manager')
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(mocks.alert).not.toHaveBeenCalled()
  })

  it('explains every other refusal in plain words', async () => {
    for (const [reason, words] of [
      ['name_not_acceptable', 'full name'],
      ['agreement_text_changed', 'reload'],
      ['document_not_viewed', 'open the document'],
      ['already_signed', 'already signed'],
      ['something_new', 'speak to your manager'],
    ] as const) {
      mocks.sign.mockResolvedValue({ ok: false, reason })

      const response = await signPost(request(goodSignature), params)

      expect(response.status, reason).toBe(409)
      const body = await response.json()
      expect(body.error.reason, reason).toBe(reason)
      expect(body.error.message, reason).toContain(words)
    }
  })

  it('needs the tick box, the name and a body', async () => {
    for (const body of [{ ...goodSignature, agreed: false }, { ...goodSignature, typed_name: ' ' }, { agreed: true }, 'not json']) {
      const response = await signPost(request(body), params)
      expect(response.status).toBe(400)
    }
    expect(mocks.sign).not.toHaveBeenCalled()
  })
})

describe('the staff portal signing endpoint fails closed', () => {
  it('turns away someone who is not signed in, before looking anything up', async () => {
    mocks.worker.mockResolvedValue(null)

    const response = await signPost(request(goodSignature), params)

    expect(response.status).toBe(401)
    expect(mocks.partyContext).not.toHaveBeenCalled()
    expect(mocks.sign).not.toHaveBeenCalled()
  })

  it('answers a document that is not theirs exactly as one that does not exist', async () => {
    mocks.partyContext.mockResolvedValue(null)

    const response = await signPost(request(goodSignature), params)

    expect(response.status).toBe(404)
    expect((await response.json()).error.message).toBe('This document was not found.')
    expect(mocks.sign).not.toHaveBeenCalled()
  })

  it('takes no signature for a document already withdrawn when the request arrives', async () => {
    mocks.withdraw.mockImplementation(async (found: SigningPartyContext) => ({
      ...found,
      document: { ...found.document, status: 'voided' },
    }))

    const response = await signPost(request(goodSignature), params)

    expect(response.status).toBe(410)
    expect((await response.json()).error.message).toContain('withdrawn')
    expect(mocks.sign).not.toHaveBeenCalled()
  })

  it('takes no signature from someone who has already signed', async () => {
    mocks.partyContext.mockResolvedValue(context({ status: 'signed' }))

    const response = await signPost(request(goodSignature), params)

    expect(response.status).toBe(410)
    expect(mocks.sign).not.toHaveBeenCalled()
  })

  it('tells the worker it was NOT saved, and alerts us, when the signature cannot be recorded', async () => {
    mocks.sign.mockRejectedValue(new Error('Could not record the signature: connection reset'))

    const response = await signPost(request(goodSignature), params)

    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body.success).toBe(false)
    expect(body.error.code).toBe('SERVER_ERROR')
    expect(body.error.message).toContain('not saved')
    // Our own fault is never passed off as something the worker did wrong.
    expect(body.error.message).not.toContain('connection reset')
    expect(mocks.alert).toHaveBeenCalledTimes(1)
    expect(mocks.alert).toHaveBeenCalledWith(
      expect.stringContaining('portal sign'),
      expect.any(Error),
      expect.objectContaining({ partyId: PARTY })
    )
  })

  it('does the same when the worker or the document cannot be looked up', async () => {
    mocks.worker.mockRejectedValue(new Error('Could not read your employee record: timeout'))

    const response = await signPost(request(goodSignature), params)

    expect(response.status).toBe(500)
    expect(mocks.sign).not.toHaveBeenCalled()
    expect(mocks.alert).toHaveBeenCalledTimes(1)
  })
})
