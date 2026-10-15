// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The title a template request is filed under. Two requests of one kind on the same record (two
 * deposit deductions on a booking) are told apart by a suffix; every other kind is unchanged.
 */

const mocks = vi.hoisted(() => ({ render: vi.fn(), prepare: vi.fn(), create: vi.fn() }))

vi.mock('@/lib/signing/templates', () => ({ renderTemplateDocument: mocks.render }))
vi.mock('@/lib/signing/prepare', () => ({ prepareSigningDocument: mocks.prepare }))
vi.mock('@/lib/signing/service', () => ({ createSigningRequest: mocks.create }))

import { buildAgreedText } from '@/lib/signing/agreement-text'
import { sendTemplateSigningRequest } from '@/lib/signing/send-template'

const BOOKING = '33333333-3333-4333-8333-333333333333'
const DEDUCTION = '77777777-7777-4777-8777-777777777777'
const STAFF = { id: '99999999-9999-4999-8999-999999999999', email: 'peter@example.test', name: 'Peter Pitcher', position: 'Director' }

function send(extra: { titleSuffix?: string | null } = {}): ReturnType<typeof sendTemplateSigningRequest> {
  return sendTemplateSigningRequest({
    kind: 'deposit_deduction_agreement',
    slug: 'deposit-deduction-agreement',
    subjectId: BOOKING,
    mergeValues: { customer_name: 'Alex Host' },
    parties: [{ role: 'customer', name: 'Alex Host', email: 'alex@example.com' }],
    user: STAFF,
    seriesKey: `deduction:${DEDUCTION}`,
    context: { deduction_id: DEDUCTION },
    ...extra,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.render.mockResolvedValue({
    template: { id: 'template-1', version: 4 },
    title: 'Deposit deduction agreement',
    html: '<p>document</p>',
    slots: { 'doc:customer': 'customer' },
  })
  mocks.prepare.mockResolvedValue({ pdf: Buffer.from('%PDF'), render: { html: '<p>document</p>' } })
  mocks.create.mockResolvedValue({ documentId: 'doc-1', version: 1, deliveries: [] })
})

describe('the title of a template request', () => {
  it('is the template title when no suffix is given, as for every other kind', async () => {
    await send()

    expect(mocks.create.mock.calls[0][0].title).toBe('Deposit deduction agreement')
  })

  it('carries the suffix after a comma, and still files the request under its own series', async () => {
    await send({ titleSuffix: '£50.00' })

    const request = mocks.create.mock.calls[0][0]
    expect(request.title).toBe('Deposit deduction agreement, £50.00')
    expect(request.seriesKey).toBe(`deduction:${DEDUCTION}`)
    expect(request.context).toEqual({ template_slug: 'deposit-deduction-agreement', deduction_id: DEDUCTION })
    // The heading printed on the document is the template's own: the suffix is not passed to it.
    expect(mocks.render.mock.calls[0][0]).not.toHaveProperty('titleSuffix')
  })

  it('ignores a blank suffix', async () => {
    await send({ titleSuffix: '  ' })

    expect(mocks.create.mock.calls[0][0].title).toBe('Deposit deduction agreement')
  })

  it('reads well in the words the customer ticks, which quote the title', () => {
    expect(buildAgreedText({ mode: 'sign', title: 'Deposit deduction agreement, £50.00' })).toBe(
      'I have read "Deposit deduction agreement, £50.00" and I agree to it. I understand that typing my name here has the same effect as signing it by hand.'
    )
  })
})
