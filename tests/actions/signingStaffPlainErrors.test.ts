// @vitest-environment node
// Staff signing: what staff are told when something goes wrong (siblings#8).
//
// A policy whose link email failed showed the email provider's own text in the policies page
// toast ("Created, but the email failed: <provider text>"), and was listed as not sent even when
// the email may have gone. Any other failure returned its raw text too, for example "Could not
// read the employee: <Postgres message>". The detail now goes to the log and staff see plain words.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeDb } from '../helpers/fakeSupabaseDb'

const mocks = vi.hoisted(() => ({
  client: null as unknown,
  user: vi.fn(),
  canSend: vi.fn(),
  canView: vi.fn(),
  sendTemplate: vi.fn(),
  audit: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: mocks.audit }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => mocks.client }))
vi.mock('@/lib/signing/staff', () => ({
  getSigningStaffUser: mocks.user,
  canSendSigningKind: mocks.canSend,
  canViewSigningKind: mocks.canView,
}))
vi.mock('@/lib/signing/documents/worker-agreement', () => ({ loadWorkerAgreement: vi.fn() }))
vi.mock('@/lib/signing/documents/worker-agreement-slots', () => ({ applyWorkerAgreementSigningSlots: vi.fn() }))
vi.mock('@/lib/signing/prepare', () => ({ prepareSigningDocument: vi.fn() }))
vi.mock('@/lib/signing/send-template', () => ({ sendTemplateSigningRequest: mocks.sendTemplate }))
vi.mock('@/lib/signing/templates', () => ({ getSigningTemplateBySlug: vi.fn() }))

import { getPolicyTemplates, sendPolicyAcknowledgements, sendStaffTemplateDocument } from '@/app/actions/signing-staff'
import type { CreateSigningRequestResult, PartyDelivery } from '@/lib/signing/service'

const ACTIVE = '11111111-1111-4111-8111-111111111111'
const STAFF = { id: '99999999-9999-4999-8999-999999999999', email: 'billy@example.test', name: 'Billy Summers', position: 'General Manager' }
const PROVIDER_TEXT = '550 5.1.1 mailbox unavailable (resend: validation_error)'

const MAY_HAVE_GONE = 'Created, but we could not confirm the email went. It may have reached them, so check with them before sending again.'

let consoleError: ReturnType<typeof vi.spyOn>

let db: ReturnType<typeof createFakeDb>

function seedEmployees(): void {
  db = createFakeDb({
    employees: [
      { id: 'a', employee_id: ACTIVE, first_name: 'Amanda', last_name: 'Smith', preferred_name: 'Mandy', email_address: 'mandy@example.com', date_of_birth: '1990-05-01', status: 'Active' },
    ],
  })
  mocks.client = db.client
}

/** An admin client whose every read fails the way a timed-out query does. */
function failingClient(message: string): unknown {
  const failed = { data: null, error: { code: '57014', message } }
  const chain: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'order', 'range']) chain[method] = () => chain
  chain.maybeSingle = () => Promise.resolve(failed)
  chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(failed).then(resolve)
  return { from: () => chain }
}

/**
 * A failed link email in the shape the signing service returns it: every failed delivery says
 * whether the outcome is uncertain, and carries the email service's code when it gave one
 * (tests/lib/signing/service.test.ts pins that). Typed, so a field the service does not set
 * cannot be fed in.
 */
function emailFailed(fields: Pick<PartyDelivery, 'uncertain' | 'code'>): CreateSigningRequestResult {
  return {
    documentId: 'doc-1',
    version: 1,
    deliveries: [{ partyId: 'p1', name: 'Amanda Smith', email: 'mandy@example.com', email_status: 'failed', error: PROVIDER_TEXT, ...fields }],
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  seedEmployees()
  mocks.user.mockResolvedValue(STAFF)
  mocks.canSend.mockResolvedValue(true)
  mocks.canView.mockResolvedValue(true)
  mocks.audit.mockResolvedValue(undefined)
})

afterEach(() => {
  consoleError.mockRestore()
})

describe('a policy link email that did not go', () => {
  it('says it may have reached them, keeps the provider text out, and logs it', async () => {
    mocks.sendTemplate.mockResolvedValue(emailFailed({ uncertain: true }))

    const result = await sendPolicyAcknowledgements({ slug: 'allergens', employeeIds: [ACTIVE] })

    expect(result.data).toEqual({
      sent: 0,
      signInPerson: [],
      emailNotConfirmed: [{ name: 'Mandy (Amanda Smith)', reason: MAY_HAVE_GONE }],
      failed: [],
    })
    expect(JSON.stringify(result)).not.toContain('mailbox unavailable')
    expect(consoleError).toHaveBeenCalledWith('[policy send] Link email did not go:', expect.objectContaining({
      documentId: 'doc-1',
      partyId: 'p1',
      uncertain: true,
      message: PROVIDER_TEXT,
    }))
  })

  it('says email is switched off when the kill switch stopped it', async () => {
    mocks.sendTemplate.mockResolvedValue(emailFailed({ code: 'email_suspended', uncertain: false }))

    const result = await sendPolicyAcknowledgements({ slug: 'allergens', employeeIds: [ACTIVE] })

    expect(result.data?.emailNotConfirmed[0].reason).toBe(
      'Created, but email is switched off, so no link was emailed. They can confirm it in person.',
    )
  })

  it('says it was not sent only when the provider definitely refused it', async () => {
    mocks.sendTemplate.mockResolvedValue(emailFailed({ uncertain: false }))

    const result = await sendPolicyAcknowledgements({ slug: 'allergens', employeeIds: [ACTIVE] })

    expect(result.data?.emailNotConfirmed[0].reason).toBe(
      'Created, but the email was not sent. Use Send Again, or they can confirm it in person.',
    )
  })

  it('says what to check when the address has bounced before', async () => {
    mocks.sendTemplate.mockResolvedValue(emailFailed({ code: 'recipient_suppressed', uncertain: false }))

    const result = await sendPolicyAcknowledgements({ slug: 'allergens', employeeIds: [ACTIVE] })

    expect(result.data?.emailNotConfirmed[0].reason).toBe(
      'Created, but the email was not sent because their address has bounced before. Check the address on their record, or they can confirm it in person.',
    )
  })

  it('treats a delivery that does not say either way as possibly sent', async () => {
    mocks.sendTemplate.mockResolvedValue(emailFailed({}))

    const result = await sendPolicyAcknowledgements({ slug: 'allergens', employeeIds: [ACTIVE] })

    expect(result.data?.emailNotConfirmed[0].reason).toBe(MAY_HAVE_GONE)
  })
})

// A send that stopped part way was listed as "Not sent ... Something went wrong. Please try
// again." even when the request had been created and its link email had gone.
describe('a policy send that stops part way', () => {
  it('says it may have gone when the request was created before the failure', async () => {
    mocks.sendTemplate.mockImplementation(async () => {
      // The request is written and emailed, then writing the "sent" event fails.
      db.rows('signing_documents').push({
        id: 'doc-1',
        subject_type: 'employee',
        subject_id: ACTIVE,
        series_key: 'policy:allergens',
        status: 'sent',
        sent_at: new Date().toISOString(),
      })
      throw new Error('Could not write signing event sent: canceling statement due to statement timeout')
    })

    const result = await sendPolicyAcknowledgements({ slug: 'allergens', employeeIds: [ACTIVE] })

    expect(result.data).toEqual({
      sent: 0,
      signInPerson: [],
      emailNotConfirmed: [{ name: 'Mandy (Amanda Smith)', reason: MAY_HAVE_GONE }],
      failed: [],
    })
    expect(JSON.stringify(result)).not.toContain('statement timeout')
  })

  it('does not count an earlier request for the same person', async () => {
    db.rows('signing_documents').push({
      id: 'doc-0',
      subject_type: 'employee',
      subject_id: ACTIVE,
      series_key: 'policy:allergens',
      status: 'sent',
      sent_at: '2026-01-01T09:00:00.000Z',
    })
    mocks.sendTemplate.mockRejectedValue(new Error('Could not store the document: storage offline'))

    const result = await sendPolicyAcknowledgements({ slug: 'allergens', employeeIds: [ACTIVE] })

    expect(result.data?.failed).toEqual([{ name: 'Mandy (Amanda Smith)', reason: 'Something went wrong. Please try again.' }])
    expect(result.data?.emailNotConfirmed).toEqual([])
  })

  it('says it may have gone when it cannot tell whether the request was created', async () => {
    mocks.sendTemplate.mockImplementation(async () => {
      db.failNext({ table: 'signing_documents', operation: 'select', message: 'permission denied for table signing_documents' })
      throw new Error('Could not write signing event sent: timeout')
    })

    const result = await sendPolicyAcknowledgements({ slug: 'allergens', employeeIds: [ACTIVE] })

    expect(result.data?.emailNotConfirmed).toEqual([{ name: 'Mandy (Amanda Smith)', reason: MAY_HAVE_GONE }])
    expect(result.data?.failed).toEqual([])
  })

  it('still counts it as sent when the send cannot be recorded afterwards', async () => {
    mocks.sendTemplate.mockResolvedValue({
      documentId: 'doc-1',
      version: 1,
      deliveries: [{ partyId: 'p1', name: 'Amanda Smith', email: 'mandy@example.com', email_status: 'sent' }],
    })
    mocks.audit.mockRejectedValue(new Error('audit offline'))

    const result = await sendPolicyAcknowledgements({ slug: 'allergens', employeeIds: [ACTIVE] })

    expect(result.data).toEqual({ sent: 1, signInPerson: [], emailNotConfirmed: [], failed: [] })
  })
})

describe('other failures are plain words, with the detail in the log', () => {
  it('a policy send that cannot read the employee', async () => {
    mocks.client = failingClient('canceling statement due to statement timeout')

    const result = await sendPolicyAcknowledgements({ slug: 'allergens', employeeIds: [ACTIVE] })

    expect(result).toEqual({ error: 'The policy could not be sent. Refresh the page to see who has it, then try again.' })
    expect(consoleError).toHaveBeenCalledWith('Staff signing action failed:', expect.objectContaining({
      message: 'Could not read the employee: canceling statement due to statement timeout',
    }))
  })

  it('logs a thrown error itself, so its stack is kept', async () => {
    const bug = new TypeError("Cannot read properties of undefined (reading 'html')")
    mocks.sendTemplate.mockRejectedValue(bug)

    const result = await sendStaffTemplateDocument({ kind: 'working_time_opt_out', employeeId: ACTIVE })

    expect(result).toEqual({ error: 'Something went wrong. Please try again.' })
    expect(consoleError).toHaveBeenCalledWith('Staff signing action failed:', bug)
    expect((consoleError.mock.calls.find((call: unknown[]) => call[1] === bug)?.[1] as Error).stack).toContain('TypeError')
  })

  it('one person whose document could not be created', async () => {
    mocks.sendTemplate.mockRejectedValue(new Error('Could not store the document: The object exceeded the maximum allowed size'))

    const result = await sendPolicyAcknowledgements({ slug: 'allergens', employeeIds: [ACTIVE] })

    expect(result.data?.failed).toEqual([{ name: 'Mandy (Amanda Smith)', reason: 'Something went wrong. Please try again.' }])
  })

  it('a staff document send', async () => {
    mocks.sendTemplate.mockRejectedValue(new Error('Could not store the document: The object exceeded the maximum allowed size'))

    const result = await sendStaffTemplateDocument({
      kind: 'terms_variation',
      employeeId: ACTIVE,
      changeSummary: 'Your hourly rate goes up to £12.71.',
      effectiveDate: '2026-11-01',
    })

    expect(result).toEqual({ error: 'Something went wrong. Please try again.' })
  })

  it('the policies page load', async () => {
    mocks.client = failingClient('permission denied for table signing_templates')

    const result = await getPolicyTemplates()

    expect(result).toEqual({ error: 'Refresh the page to try again.' })
  })
})
