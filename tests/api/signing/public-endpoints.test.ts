// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  throttle: vi.fn(),
  getParty: vi.fn(),
  view: vi.fn(),
  sign: vi.fn(),
  decline: vi.fn(),
  identity: vi.fn(),
  alert: vi.fn(),
}))

vi.mock('@/lib/guest/token-throttle', () => ({ checkGuestTokenThrottle: mocks.throttle }))
vi.mock('@/lib/cron/alerting', () => ({ reportCronFailure: mocks.alert }))
vi.mock('@/lib/signing/service', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/signing/service')>()
  return {
    ...original,
    getSigningPartyByToken: mocks.getParty,
    viewSigningDocument: mocks.view,
    signSigningParty: mocks.sign,
    declineSigningParty: mocks.decline,
    checkSigningIdentity: mocks.identity,
  }
})

import { POST as declinePost } from '@/app/api/sign/[token]/decline/route'
import { GET as documentGet } from '@/app/api/sign/[token]/document/route'
import { POST as identityPost } from '@/app/api/sign/[token]/identity/route'
import { POST as signPost } from '@/app/api/sign/[token]/sign/route'
import type { SigningPartyContext } from '@/lib/signing/service'

const TOKEN = 'A'.repeat(43)
const FUTURE = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

function context(party: Record<string, unknown> = {}, document: Record<string, unknown> = {}): SigningPartyContext {
  return {
    party: {
      id: 'party-1',
      document_id: 'doc-1',
      status: 'pending',
      token_expires_at: FUTURE,
      identity_check: 'none',
      identity_check_failures: 0,
      identity_checked_at: null,
      witnessed_by: null,
      ...party,
    },
    document: { id: 'doc-1', status: 'sent', expires_at: FUTURE, mode: 'sign', title: 'Booking contract', ...document },
  } as unknown as SigningPartyContext
}

function request(path: string, body?: unknown): NextRequest {
  return new NextRequest(`https://management.example.test/api/sign/${TOKEN}/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9', 'user-agent': 'test-agent', 'x-vercel-ip-city': 'Staines' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

const params = { params: Promise.resolve({ token: TOKEN }) }
const goodSignature = { typed_name: 'Sam Example', agreed: true, agreed_text: 'I agree.' }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.throttle.mockResolvedValue({ allowed: true, retryAfterSeconds: 0, remaining: 9 })
  mocks.getParty.mockResolvedValue(context())
  mocks.alert.mockResolvedValue(undefined)
})

describe('public signing endpoints fail closed', () => {
  it('tells the signer it was NOT saved, and alerts us, when the signature cannot be recorded', async () => {
    mocks.sign.mockRejectedValue(new Error('database unavailable'))
    const response = await signPost(request('sign', goodSignature), params)
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body.success).toBe(false)
    expect(body.error.code).toBe('SERVER_ERROR')
    expect(body.error.message).toContain('was not saved')
    expect(body.error.message).toContain('contact us')
    // Our fault is never dressed up as theirs, and no internals leak.
    expect(JSON.stringify(body)).not.toContain('database unavailable')
    expect(mocks.alert).toHaveBeenCalledWith(expect.stringContaining('sign'), expect.any(Error), expect.anything())
  })

  it('does the same when the link itself cannot be looked up', async () => {
    mocks.getParty.mockRejectedValue(new Error('connection reset'))
    for (const call of [
      () => signPost(request('sign', goodSignature), params),
      () => declinePost(request('decline', { reason: 'no' }), params),
      () => identityPost(request('identity', { date_of_birth: '2000-03-14' }), params),
      () => documentGet(request('document'), params),
    ]) {
      mocks.alert.mockClear()
      const response = await call()
      expect(response.status).toBe(500)
      expect((await response.json()).error.code).toBe('SERVER_ERROR')
      expect(mocks.alert).toHaveBeenCalledTimes(1)
    }
    expect(mocks.sign).not.toHaveBeenCalled()
    expect(mocks.decline).not.toHaveBeenCalled()
  })

  it('does the same when a refusal or a date of birth check cannot be recorded', async () => {
    mocks.decline.mockRejectedValue(new Error('database unavailable'))
    expect((await declinePost(request('decline', { reason: 'no' }), params)).status).toBe(500)

    mocks.getParty.mockResolvedValue(context({ identity_check: 'date_of_birth' }))
    mocks.identity.mockRejectedValue(new Error('database unavailable'))
    expect((await identityPost(request('identity', { date_of_birth: '2000-03-14' }), params)).status).toBe(500)
    expect(mocks.alert).toHaveBeenCalledTimes(2)
  })

  it('does not serve a document it could not verify or record as opened', async () => {
    mocks.view.mockRejectedValue(new Error('fingerprint mismatch'))
    const response = await documentGet(request('document'), params)
    expect(response.status).toBe(500)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(mocks.alert).toHaveBeenCalledTimes(1)
  })
})

describe('public signing endpoints give nothing away', () => {
  it('answers an unknown link the same on every endpoint, with no hint why', async () => {
    mocks.getParty.mockResolvedValue(null)
    const bodies: string[] = []
    for (const call of [
      () => signPost(request('sign', goodSignature), params),
      () => declinePost(request('decline', {}), params),
      () => identityPost(request('identity', { date_of_birth: '2000-03-14' }), params),
      () => documentGet(request('document'), params),
    ]) {
      const response = await call()
      expect(response.status).toBe(404)
      expect(response.headers.get('cache-control')).toContain('no-store')
      bodies.push(JSON.stringify(await response.json()))
    }
    expect(new Set(bodies).size).toBe(1)
    expect(bodies[0]).toContain('LINK_NOT_VALID')
    expect(mocks.alert).not.toHaveBeenCalled()
  })

  it('throttles before it looks anything up', async () => {
    mocks.throttle.mockResolvedValue({ allowed: false, retryAfterSeconds: 120, remaining: 0 })
    const response = await signPost(request('sign', goodSignature), params)
    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('120')
    expect(mocks.getParty).not.toHaveBeenCalled()
    expect(mocks.sign).not.toHaveBeenCalled()
  })

  it('refuses a dead document without touching it', async () => {
    for (const [changes, expected] of [
      [context({}, { status: 'voided' }), 'withdrawn'],
      [context({}, { status: 'superseded' }), 'replaced'],
      [context({}, { expires_at: '2020-01-01T00:00:00.000Z' }), 'expired'],
      [context({ token_expires_at: '2020-01-01T00:00:00.000Z' }), 'link has expired'],
      [context({ status: 'signed' }), 'already signed'],
    ] as const) {
      mocks.getParty.mockResolvedValue(changes)
      const response = await signPost(request('sign', goodSignature), params)
      expect(response.status).toBe(410)
      expect((await response.json()).error.message).toContain(expected)
    }
    expect(mocks.sign).not.toHaveBeenCalled()
  })
})

describe('signing', () => {
  it('records a valid signature with the evidence from the request', async () => {
    mocks.sign.mockResolvedValue({ ok: true, completed: true, documentId: 'doc-1' })
    const response = await signPost(request('sign', goodSignature), params)
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ success: true, signed: true, completed: true })
    expect(mocks.sign).toHaveBeenCalledWith(
      expect.objectContaining({
        typedName: 'Sam Example',
        agreedText: 'I agree.',
        via: 'link',
        evidence: expect.objectContaining({ ip: '203.0.113.9', userAgent: 'test-agent', city: 'Staines' }),
      })
    )
  })

  it('needs the tick box, the name and a body', async () => {
    for (const body of [{ ...goodSignature, agreed: false }, { ...goodSignature, typed_name: ' ' }, { agreed: true }, 'not json']) {
      const response = await signPost(request('sign', body), params)
      expect(response.status).toBe(400)
    }
    expect(mocks.sign).not.toHaveBeenCalled()
  })

  it('explains a refusal in plain words', async () => {
    for (const [reason, status, words] of [
      ['document_not_viewed', 409, 'open the document'],
      ['agreement_text_changed', 409, 'reload'],
      ['name_not_acceptable', 400, 'full name'],
      ['something_new', 409, 'contact us'],
    ] as const) {
      mocks.sign.mockResolvedValue({ ok: false, reason })
      const response = await signPost(request('sign', goodSignature), params)
      expect(response.status).toBe(status)
      expect((await response.json()).error.message).toContain(words)
    }
  })

  it('will not take a signature before the date of birth check', async () => {
    mocks.getParty.mockResolvedValue(context({ identity_check: 'date_of_birth' }))
    const response = await signPost(request('sign', goodSignature), params)
    expect(response.status).toBe(403)
    expect(mocks.sign).not.toHaveBeenCalled()

    const documentResponse = await documentGet(request('document'), params)
    expect(documentResponse.status).toBe(403)
    expect(mocks.view).not.toHaveBeenCalled()
  })
})

describe('date of birth check', () => {
  beforeEach(() => {
    mocks.getParty.mockResolvedValue(context({ identity_check: 'date_of_birth' }))
  })

  it('passes, fails with tries left, and locks', async () => {
    mocks.identity.mockResolvedValueOnce({ ok: true })
    expect((await identityPost(request('identity', { date_of_birth: '2000-03-14' }), params)).status).toBe(200)

    mocks.identity.mockResolvedValueOnce({ ok: false, reason: 'mismatch', attemptsLeft: 1 })
    const wrong = await identityPost(request('identity', { date_of_birth: '1999-01-01' }), params)
    expect(wrong.status).toBe(403)
    expect((await wrong.json()).error.message).toContain('1 try left')

    mocks.identity.mockResolvedValueOnce({ ok: false, reason: 'locked', attemptsLeft: 0 })
    expect((await identityPost(request('identity', { date_of_birth: '1999-01-01' }), params)).status).toBe(423)

    mocks.identity.mockResolvedValueOnce({ ok: false, reason: 'no_record', attemptsLeft: 5 })
    const noRecord = await identityPost(request('identity', { date_of_birth: '1999-01-01' }), params)
    expect(noRecord.status).toBe(409)
    expect((await noRecord.json()).error.message).toContain('in person')
  })

  it('rejects something that is not a date before checking anything', async () => {
    for (const body of [{ date_of_birth: '14/03/2000' }, { date_of_birth: '2000-02-31' }, {}]) {
      expect((await identityPost(request('identity', body), params)).status).toBe(400)
    }
    expect(mocks.identity).not.toHaveBeenCalled()
  })

  it('still lets someone who cannot pass it say no', async () => {
    mocks.decline.mockResolvedValue({ ok: true, completed: false, documentId: 'doc-1' })
    const response = await declinePost(request('decline', { reason: '  Not for me  ' }), params)
    expect(response.status).toBe(201)
    expect(mocks.decline).toHaveBeenCalledWith(expect.objectContaining({ reason: 'Not for me' }))
  })
})

describe('the document', () => {
  it('serves the PDF inline, uncached and unindexed', async () => {
    mocks.view.mockResolvedValue(Buffer.from('%PDF-1.7 test'))
    const response = await documentGet(request('document'), params)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/pdf')
    expect(response.headers.get('content-disposition')).toContain('inline')
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(response.headers.get('x-robots-tag')).toContain('noindex')
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe('%PDF-1.7 test')
  })

  it('stays available to someone who has signed, and to nobody on a withdrawn document', async () => {
    mocks.view.mockResolvedValue(Buffer.from('%PDF'))
    mocks.getParty.mockResolvedValue(context({ status: 'signed' }))
    expect((await documentGet(request('document'), params)).status).toBe(200)

    mocks.getParty.mockResolvedValue(context({}, { status: 'voided' }))
    expect((await documentGet(request('document'), params)).status).toBe(410)
  })
})
