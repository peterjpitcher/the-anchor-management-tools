/**
 * The client statement and the mailbox switch (invoice email spec, 4 October 2026, R1a).
 *
 * A statement lists a client's invoices, so once `INVOICE_EMAIL_PROVIDER=graph` is set it
 * leaves from the same Orange Jelly mailbox they do. The spec asks for the pin and nothing
 * more: the statement's sender, reply-to and wording are untouched, and with the switch
 * unset the send is exactly what it was before the switch existed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  sendEmail: vi.fn(),
  generateStatementPDF: vi.fn(),
  checkUserPermission: vi.fn(),
  createClient: vi.fn(),
}))

vi.mock('@/lib/email/emailService', () => ({ sendEmail: mocks.sendEmail }))
vi.mock('@/lib/oj-statement', () => ({ generateStatementPDF: mocks.generateStatementPDF }))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: mocks.checkUserPermission }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn(async () => undefined) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }))

import { sendStatementEmail } from '@/app/actions/oj-projects/client-statement'

const VENDOR_ID = '11111111-1111-4111-8111-111111111111'

/** A session client for a client with one billing address and no invoices in the period. */
function sessionClient(): unknown {
  const from = (table: string) => {
    const chain: Record<string, unknown> = {}
    for (const method of ['select', 'eq', 'is', 'in', 'not', 'order', 'gte', 'lte', 'lt']) chain[method] = () => chain
    chain.single = async () => ({
      data: table === 'invoice_vendors'
        ? { id: VENDOR_ID, name: 'Golden Barrels Limited', email: 'accounts@example.com' }
        : null,
      error: null,
    })
    chain.insert = async () => ({ error: null })
    chain.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null }).then(resolve, reject)
    return chain
  }
  return { from, auth: { getUser: async () => ({ data: { user: { id: 'user-1', email: 'peter@example.com' } } }) } }
}

function sentPayload(): Record<string, unknown> {
  expect(mocks.sendEmail).toHaveBeenCalledTimes(1)
  return mocks.sendEmail.mock.calls[0][0] as Record<string, unknown>
}

const originalEnv = { ...process.env }

beforeEach(() => {
  vi.clearAllMocks()
  process.env = { ...originalEnv }
  delete process.env.INVOICE_EMAIL_PROVIDER
  mocks.checkUserPermission.mockResolvedValue(true)
  mocks.createClient.mockResolvedValue(sessionClient())
  mocks.generateStatementPDF.mockResolvedValue(Buffer.from('statement-pdf'))
  mocks.sendEmail.mockResolvedValue({ success: true, messageId: 'message-1' })
})

afterEach(() => {
  process.env = { ...originalEnv }
})

describe('sendStatementEmail and the mailbox switch', () => {
  it('passes no provider, sender or reply-to while the switch is unset, as before', async () => {
    const result = await sendStatementEmail(VENDOR_ID, '2026-09-01', '2026-09-30')

    expect(result).toEqual({ success: true })
    const payload = sentPayload()
    expect(payload).not.toHaveProperty('provider')
    expect(payload).not.toHaveProperty('from')
    expect(payload).not.toHaveProperty('replyTo')
    expect(payload.to).toBe('accounts@example.com')
  })

  it('pins Microsoft Graph, and changes nothing else, once the switch is set to graph', async () => {
    process.env.INVOICE_EMAIL_PROVIDER = 'graph'

    const result = await sendStatementEmail(VENDOR_ID, '2026-09-01', '2026-09-30')

    expect(result).toEqual({ success: true })
    const payload = sentPayload()
    expect(payload.provider).toBe('graph')
    expect(payload).not.toHaveProperty('from')
    expect(payload).not.toHaveProperty('replyTo')
    expect(payload.subject).toBe('Account Statement: Golden Barrels Limited, September 2026 to September 2026')
  })

  it('fails closed on a mistyped switch', async () => {
    process.env.INVOICE_EMAIL_PROVIDER = 'resend'

    await sendStatementEmail(VENDOR_ID, '2026-09-01', '2026-09-30')

    expect(sentPayload()).not.toHaveProperty('provider')
  })
})
