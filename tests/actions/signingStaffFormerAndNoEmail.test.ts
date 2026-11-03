// @vitest-environment node
// Staff signing: people who have left, people with no email address, and the names on the
// policies page.
//
// FF-45: staff documents could be sent to someone marked Former. FF-55: a policy "sent" to someone
// with no email address emailed nothing (email_status 'none') but was counted as sent, and the
// policies page listed everyone under their legal name.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeDb, type FakeDb } from '../helpers/fakeSupabaseDb'

const mocks = vi.hoisted(() => ({
  client: null as unknown,
  user: vi.fn(),
  canSend: vi.fn(),
  canView: vi.fn(),
  loadAgreement: vi.fn(),
  createRequest: vi.fn(),
  sendTemplate: vi.fn(),
  template: vi.fn(),
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
vi.mock('@/lib/signing/documents/worker-agreement', () => ({ loadWorkerAgreement: mocks.loadAgreement }))
vi.mock('@/lib/signing/documents/worker-agreement-slots', () => ({ applyWorkerAgreementSigningSlots: vi.fn() }))
vi.mock('@/lib/signing/prepare', () => ({ prepareSigningDocument: vi.fn() }))
vi.mock('@/lib/signing/send-template', () => ({ sendTemplateSigningRequest: mocks.sendTemplate }))
vi.mock('@/lib/signing/templates', () => ({ getSigningTemplateBySlug: mocks.template }))
vi.mock('@/lib/signing/service', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/signing/service')>()
  return { ...original, createSigningRequest: mocks.createRequest }
})

import {
  getPolicyOverview,
  sendEmploymentAgreement,
  sendPolicyAcknowledgements,
  sendStaffTemplateDocument,
} from '@/app/actions/signing-staff'

const ACTIVE = '11111111-1111-4111-8111-111111111111'
const NO_EMAIL = '33333333-3333-4333-8333-333333333333'
const FORMER = '44444444-4444-4444-8444-444444444444'
const STAFF = { id: '99999999-9999-4999-8999-999999999999', email: 'billy@example.test', name: 'Billy Summers', position: 'General Manager' }
const LEFT = 'This person has left, so documents can no longer be sent to them to sign.'

let db: FakeDb

beforeEach(() => {
  vi.clearAllMocks()
  db = createFakeDb({
    employees: [
      { id: 'a', employee_id: ACTIVE, first_name: 'Amanda', last_name: 'Smith', preferred_name: 'Mandy', email_address: 'mandy@example.com', date_of_birth: '1990-05-01', status: 'Active' },
      { id: 'c', employee_id: NO_EMAIL, first_name: 'Alex', last_name: 'Unknown', preferred_name: null, email_address: null, date_of_birth: '1991-05-01', status: 'Active' },
      { id: 'd', employee_id: FORMER, first_name: 'Former', last_name: 'Person', preferred_name: null, email_address: 'f@example.com', date_of_birth: '1980-01-01', status: 'Former' },
    ],
  })
  mocks.client = db.client
  mocks.user.mockResolvedValue(STAFF)
  mocks.canSend.mockResolvedValue(true)
  mocks.canView.mockResolvedValue(true)
  mocks.audit.mockResolvedValue(undefined)
})

describe('nothing new is sent to someone who has left (FF-45)', () => {
  it('refuses the worker agreement before building it', async () => {
    expect(await sendEmploymentAgreement({ employeeId: FORMER })).toEqual({ error: LEFT })
    expect(mocks.loadAgreement).not.toHaveBeenCalled()
    expect(mocks.createRequest).not.toHaveBeenCalled()
  })

  it('refuses a template document', async () => {
    const result = await sendStaffTemplateDocument({
      kind: 'terms_variation',
      employeeId: FORMER,
      changeSummary: 'Your hourly rate goes up to £12.71.',
      effectiveDate: '2026-11-01',
    })
    expect(result).toEqual({ error: LEFT })
    expect(mocks.sendTemplate).not.toHaveBeenCalled()
  })

  it('leaves them out of a policy send, names them, and still sends to the rest', async () => {
    mocks.sendTemplate.mockResolvedValue({
      documentId: 'doc-1',
      version: 1,
      deliveries: [{ partyId: 'p1', name: 'Amanda Smith', email: 'mandy@example.com', email_status: 'sent' }],
    })

    const result = await sendPolicyAcknowledgements({ slug: 'allergens', employeeIds: [FORMER, ACTIVE] })

    expect(result.data?.sent).toBe(1)
    expect(result.data?.failed).toEqual([{ name: 'Former Person', reason: LEFT }])
    expect(mocks.sendTemplate).toHaveBeenCalledTimes(1)
    expect(mocks.sendTemplate.mock.calls[0][0].subjectId).toBe(ACTIVE)
  })
})

describe('no email address means sign in person, not sent (FF-55)', () => {
  it('reports them apart from those emailed', async () => {
    mocks.sendTemplate
      .mockResolvedValueOnce({ documentId: 'doc-1', version: 1, deliveries: [{ partyId: 'p1', name: 'Amanda Smith', email: 'mandy@example.com', email_status: 'sent' }] })
      .mockResolvedValueOnce({ documentId: 'doc-2', version: 1, deliveries: [{ partyId: 'p2', name: 'Alex Unknown', email: null, email_status: 'none' }] })

    const result = await sendPolicyAcknowledgements({ slug: 'allergens', employeeIds: [ACTIVE, NO_EMAIL] })

    expect(result.data).toEqual({ sent: 1, signInPerson: [{ name: 'Alex Unknown' }], emailNotConfirmed: [], failed: [] })
  })

  it('still prints the legal name on the document and signs them as it', async () => {
    mocks.sendTemplate.mockResolvedValue({ documentId: 'doc-1', version: 1, deliveries: [{ partyId: 'p1', name: 'Amanda Smith', email: 'mandy@example.com', email_status: 'sent' }] })

    await sendPolicyAcknowledgements({ slug: 'allergens', employeeIds: [ACTIVE] })

    const request = mocks.sendTemplate.mock.calls[0][0]
    expect(request.mergeValues).toEqual({ worker_name: 'Amanda Smith' })
    expect(request.parties[0]).toMatchObject({ role: 'worker', name: 'Amanda Smith' })
  })
})

describe('the policies page names people as the team does (FF-55)', () => {
  it('shows the preferred name with the legal name alongside, and leaves out those who have left', async () => {
    mocks.template.mockResolvedValue({ id: 't1', kind: 'policy_acknowledgement', slug: 'allergens', title: 'Allergens policy', version: 1, is_active: true })

    const result = await getPolicyOverview('allergens')

    expect(result.data?.staff.map((row) => row.name)).toEqual(['Alex Unknown', 'Mandy (Amanda Smith)'])
  })
})

// Someone on notice has left once their last working day has passed, even before the nightly job
// marks them Former. On the last working day itself they are still staff.
describe('someone on notice past their last working day counts as having left', () => {
  const ON_NOTICE = '55555555-5555-4555-8555-555555555555'

  beforeEach(() => {
    db = createFakeDb({
      employees: [
        { id: 'a', employee_id: ACTIVE, first_name: 'Amanda', last_name: 'Smith', preferred_name: 'Mandy', email_address: 'mandy@example.com', date_of_birth: '1990-05-01', status: 'Active', employment_end_date: null },
        { id: 'e', employee_id: ON_NOTICE, first_name: 'Sam', last_name: 'Taylor', preferred_name: null, email_address: 'sam@example.com', date_of_birth: '1995-02-01', status: 'Started Separation', employment_end_date: '2026-11-07' },
      ],
    })
    mocks.client = db.client
    mocks.template.mockResolvedValue({ id: 't1', kind: 'policy_acknowledgement', slug: 'allergens', title: 'Allergens policy', version: 1, is_active: true })
    vi.useFakeTimers({ toFake: ['Date'] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('is still sent documents, and listed on the policies page, on the last working day', async () => {
    vi.setSystemTime(new Date('2026-11-07T20:00:00.000Z'))
    mocks.sendTemplate.mockResolvedValue({ documentId: 'doc-1', version: 1, deliveries: [{ partyId: 'p1', name: 'Sam Taylor', email: 'sam@example.com', email_status: 'sent' }] })

    const sent = await sendPolicyAcknowledgements({ slug: 'allergens', employeeIds: [ON_NOTICE] })
    const overview = await getPolicyOverview('allergens')

    expect(sent.data?.sent).toBe(1)
    expect(overview.data?.staff.map((row) => row.name)).toEqual(['Mandy (Amanda Smith)', 'Sam Taylor'])
  })

  it('is refused new documents, and left off the policies page, the day after', async () => {
    vi.setSystemTime(new Date('2026-11-08T00:30:00.000Z'))

    expect(await sendEmploymentAgreement({ employeeId: ON_NOTICE })).toEqual({ error: LEFT })
    expect(await sendStaffTemplateDocument({ kind: 'working_time_opt_out', employeeId: ON_NOTICE })).toEqual({ error: LEFT })
    const sent = await sendPolicyAcknowledgements({ slug: 'allergens', employeeIds: [ON_NOTICE] })
    const overview = await getPolicyOverview('allergens')

    expect(sent.data?.failed).toEqual([{ name: 'Sam Taylor', reason: LEFT }])
    expect(mocks.sendTemplate).not.toHaveBeenCalled()
    expect(mocks.loadAgreement).not.toHaveBeenCalled()
    expect(overview.data?.staff.map((row) => row.name)).toEqual(['Mandy (Amanda Smith)'])
  })
})
