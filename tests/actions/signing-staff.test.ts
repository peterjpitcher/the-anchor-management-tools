// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeDb, type FakeDb } from '../helpers/fakeSupabaseDb'

const mocks = vi.hoisted(() => ({
  client: null as unknown,
  user: vi.fn(),
  canSend: vi.fn(),
  canView: vi.fn(),
  loadAgreement: vi.fn(),
  applySlots: vi.fn(),
  prepare: vi.fn(),
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
// Where the signature panels go in the real agreement is pinned in tests/lib/signing/documents.test.ts.
vi.mock('@/lib/signing/documents/worker-agreement-slots', () => ({ applyWorkerAgreementSigningSlots: mocks.applySlots }))
vi.mock('@/lib/signing/prepare', () => ({ prepareSigningDocument: mocks.prepare }))
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
import { SigningError } from '@/lib/signing/service'

const ADULT = '11111111-1111-4111-8111-111111111111'
const MINOR = '22222222-2222-4222-8222-222222222222'
const NO_DOB = '33333333-3333-4333-8333-333333333333'
const STAFF = { id: '99999999-9999-4999-8999-999999999999', email: 'billy@example.test', name: 'Billy Summers', position: 'General Manager' }
const AGREEMENT = { html: '<p>agreement</p>', includesYoungWorkerSchedule: false, age: 36, agreementDate: '2026-10-12', missing: [] as string[] }
const ADULT_SLOTS = { 'agreement:company': 'company', 'agreement:worker': 'worker' }
const RENDER = { html: '<p>slotted</p>', profile: 'a4_css_page', slots: ADULT_SLOTS, hasInitials: true }

let db: FakeDb

function seed(): void {
  db = createFakeDb({
    employees: [
      { id: 'a', employee_id: ADULT, first_name: 'Sam', last_name: 'Example', email_address: 'sam@example.com', date_of_birth: '1990-05-01', status: 'Active' },
      { id: 'b', employee_id: MINOR, first_name: 'Robin', last_name: 'Young', email_address: 'robin@example.com', date_of_birth: '2010-06-01', status: 'Active' },
      { id: 'c', employee_id: NO_DOB, first_name: 'Alex', last_name: 'Unknown', email_address: null, date_of_birth: null, status: 'Active' },
      { id: 'd', employee_id: '44444444-4444-4444-8444-444444444444', first_name: 'Former', last_name: 'Person', email_address: 'f@example.com', date_of_birth: '1980-01-01', status: 'Former' },
    ],
  })
  mocks.client = db.client
}

function delivered(name: string) {
  return { documentId: 'doc-1', version: 1, deliveries: [{ partyId: 'p1', name, email: 'x@example.com', email_status: 'sent' }] }
}

beforeEach(() => {
  vi.clearAllMocks()
  seed()
  mocks.user.mockResolvedValue(STAFF)
  mocks.canSend.mockResolvedValue(true)
  mocks.canView.mockResolvedValue(true)
  mocks.audit.mockResolvedValue(undefined)
  mocks.createRequest.mockResolvedValue(delivered('Sam Example'))
  mocks.sendTemplate.mockResolvedValue(delivered('Sam Example'))
  mocks.loadAgreement.mockResolvedValue(AGREEMENT)
  mocks.applySlots.mockReturnValue({ html: '<p>slotted</p>', slots: ADULT_SLOTS })
  mocks.prepare.mockResolvedValue({ pdf: Buffer.from('%PDF'), render: RENDER })
})

describe('sending the worker agreement', () => {
  it('needs a signed-in member of staff with permission', async () => {
    mocks.user.mockResolvedValueOnce(null)
    expect(await sendEmploymentAgreement({ employeeId: ADULT })).toEqual({ error: 'Unauthorized' })
    mocks.canSend.mockResolvedValueOnce(false)
    expect(await sendEmploymentAgreement({ employeeId: ADULT })).toEqual({ error: 'Insufficient permissions' })
    expect(mocks.createRequest).not.toHaveBeenCalled()
  })

  it('refuses while the agreement would print a blank, and says what to fill in', async () => {
    mocks.loadAgreement.mockResolvedValue({ ...AGREEMENT, missing: ['job title', 'hourly rate (set it on the Pay tab)'] })
    const result = await sendEmploymentAgreement({ employeeId: ADULT })
    expect(result.error).toContain('job title')
    expect(result.error).toContain('hourly rate')
    expect(mocks.prepare).not.toHaveBeenCalled()
    expect(mocks.createRequest).not.toHaveBeenCalled()
  })

  it('sends to the worker, asks for their date of birth by link, and ticks the checklist as drafted', async () => {
    const result = await sendEmploymentAgreement({ employeeId: ADULT })
    expect(result.success).toBe(true)
    const request = mocks.createRequest.mock.calls[0][0]
    expect(request).toMatchObject({ kind: 'employment_agreement', subjectId: ADULT, createdBy: STAFF.id, createdByName: 'Billy Summers' })
    expect(request.parties).toEqual([
      { role: 'worker', name: 'Sam Example', email: 'sam@example.com', employeeId: ADULT, identityCheck: 'date_of_birth' },
    ])
    // The business signs as it sends: in the sender's own name and position, on the document too.
    expect(request.createdByPosition).toBe('General Manager')
    expect(mocks.prepare).toHaveBeenCalledWith({
      source: { html: '<p>slotted</p>', profile: 'a4_css_page', slots: ADULT_SLOTS, hasInitials: true },
      mode: 'sign',
      parties: [{ role: 'worker', name: 'Sam Example' }],
      sender: { name: 'Billy Summers', position: 'General Manager' },
    })
    // The source goes with the request, so the signed copy can show each signature in its place.
    expect(request.render).toBe(RENDER)
    expect(request.pdf.toString()).toBe('%PDF')
    expect(db.rows('employee_onboarding_checklist')[0]).toMatchObject({ employee_id: ADULT, employment_agreement_drafted: true })
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ operation_type: 'send', resource_type: 'signing_document', resource_id: 'doc-1' }))
  })

  it('makes a parent or guardian sign too when the worker is under 18', async () => {
    mocks.loadAgreement.mockResolvedValue({ ...AGREEMENT, age: 16, includesYoungWorkerSchedule: true })
    const refused = await sendEmploymentAgreement({ employeeId: MINOR })
    expect(refused.error).toContain('under 18')
    expect(mocks.createRequest).not.toHaveBeenCalled()

    const sent = await sendEmploymentAgreement({ employeeId: MINOR, guardianName: 'Pat Young', guardianEmail: 'pat@example.com' })
    expect(sent.success).toBe(true)
    expect(mocks.createRequest.mock.calls[0][0].parties).toEqual([
      expect.objectContaining({ role: 'worker', name: 'Robin Young' }),
      { role: 'guardian', name: 'Pat Young', email: 'pat@example.com' },
    ])
    expect(mocks.applySlots).toHaveBeenCalledWith('<p>agreement</p>', { includesYoungWorkerSchedule: true })
  })

  it('will not send an under-18 agreement that came out without the page the parent or guardian signs', async () => {
    mocks.loadAgreement.mockResolvedValue({ ...AGREEMENT, age: 16, includesYoungWorkerSchedule: false })
    const result = await sendEmploymentAgreement({ employeeId: MINOR, guardianName: 'Pat Young', guardianEmail: 'pat@example.com' })
    expect(result.error).toContain('Young Worker Schedule')
    expect(mocks.createRequest).not.toHaveBeenCalled()
  })

  it('rejects a malformed id or guardian email before doing anything', async () => {
    expect((await sendEmploymentAgreement({ employeeId: 'nope' })).error).toBeTruthy()
    expect((await sendEmploymentAgreement({ employeeId: MINOR, guardianName: 'Pat Young', guardianEmail: 'not-an-email' })).error).toContain('email')
    expect(mocks.loadAgreement).not.toHaveBeenCalled()
  })
})

describe('sending a template document to one employee', () => {
  it('sends a change to terms with the date written out', async () => {
    const result = await sendStaffTemplateDocument({ kind: 'terms_variation', employeeId: ADULT, changeSummary: 'Your hourly rate goes up to £12.71.', effectiveDate: '2026-11-01' })
    expect(result.success).toBe(true)
    expect(mocks.sendTemplate.mock.calls[0][0]).toMatchObject({
      kind: 'terms_variation',
      slug: 'terms-variation',
      subjectId: ADULT,
      mergeValues: { worker_name: 'Sam Example', change_summary: 'Your hourly rate goes up to £12.71.', effective_date: '1 November 2026' },
    })
  })

  it('will not offer the 48-hour opt-out to a worker under 18, or to one with no date of birth', async () => {
    expect((await sendStaffTemplateDocument({ kind: 'working_time_opt_out', employeeId: MINOR })).error).toContain('under 18')
    expect((await sendStaffTemplateDocument({ kind: 'working_time_opt_out', employeeId: NO_DOB })).error).toContain('date of birth')
    expect(mocks.sendTemplate).not.toHaveBeenCalled()
    expect((await sendStaffTemplateDocument({ kind: 'working_time_opt_out', employeeId: ADULT })).success).toBe(true)
  })

  it('sends guardian consent to the guardian, not the worker, and only for a worker under 18', async () => {
    expect((await sendStaffTemplateDocument({ kind: 'guardian_consent', employeeId: ADULT, guardianName: 'Pat Young', guardianEmail: 'pat@example.com' })).error).toContain('18 or over')
    await sendStaffTemplateDocument({ kind: 'guardian_consent', employeeId: MINOR, guardianName: 'Pat Young', guardianEmail: 'pat@example.com' })
    expect(mocks.sendTemplate.mock.calls[0][0].parties).toEqual([{ role: 'guardian', name: 'Pat Young', email: 'pat@example.com' }])
    expect(mocks.sendTemplate.mock.calls[0][0].mergeValues).toEqual({ worker_name: 'Robin Young', guardian_name: 'Pat Young' })
  })

  it('needs the deduction spelled out', async () => {
    expect((await sendStaffTemplateDocument({ kind: 'deduction_consent', employeeId: ADULT, deductionDetails: 'short' })).error).toContain('deducted')
    expect(mocks.sendTemplate).not.toHaveBeenCalled()
  })

  it('passes on the reason when the template is switched off', async () => {
    mocks.sendTemplate.mockRejectedValue(new SigningError('template_inactive', 'The "Change to your terms" template is switched off.'))
    const result = await sendStaffTemplateDocument({ kind: 'terms_variation', employeeId: ADULT, changeSummary: 'Your hourly rate goes up to £12.71.', effectiveDate: '2026-11-01' })
    expect(result.error).toContain('switched off')
  })
})

describe('policies', () => {
  const template = { id: 't1', kind: 'policy_acknowledgement', slug: 'allergens', title: 'Allergens policy', version: 3, is_active: true }

  it('shows where each active member of staff is with the current version', async () => {
    mocks.template.mockResolvedValue(template)
    const row = (id: string, subject: string, status: string, version: number, templateVersion: number) => ({
      id,
      subject_type: 'employee',
      subject_id: subject,
      series_key: 'policy:allergens',
      status,
      version,
      template_version: templateVersion,
      sent_at: '2026-10-01T09:00:00.000Z',
      completed_at: status === 'completed' ? '2026-10-02T09:00:00.000Z' : null,
    })
    db.rows('signing_documents').push(
      // Sam confirmed the current version.
      row('d1', ADULT, 'completed', 2, 3),
      row('d0', ADULT, 'superseded', 1, 2),
      // Robin confirmed an old version and has the new one waiting.
      row('d2', MINOR, 'completed', 1, 2),
      row('d3', MINOR, 'sent', 2, 3),
      // Another policy entirely must not count.
      { ...row('d4', NO_DOB, 'completed', 1, 3), series_key: 'policy:staff-handbook' }
    )

    const result = await getPolicyOverview('allergens')
    expect(result.data).toMatchObject({ slug: 'allergens', title: 'Allergens policy', version: 3, isActive: true })
    const states = Object.fromEntries((result.data?.staff ?? []).map((person) => [person.name, person.state]))
    expect(states).toEqual({ 'Sam Example': 'confirmed', 'Robin Young': 'waiting', 'Alex Unknown': 'not_sent' })
    // Someone who has left is not on the roll call.
    expect(states).not.toHaveProperty('Former Person')
  })

  it('calls an older confirmation out of date once the wording changes', async () => {
    mocks.template.mockResolvedValue({ ...template, version: 4 })
    db.rows('signing_documents').push({ id: 'd1', subject_type: 'employee', subject_id: ADULT, series_key: 'policy:allergens', status: 'completed', version: 1, template_version: 3, sent_at: '2026-10-01T09:00:00.000Z', completed_at: '2026-10-02T09:00:00.000Z' })
    const result = await getPolicyOverview('allergens')
    expect(result.data?.staff.find((person) => person.name === 'Sam Example')).toMatchObject({ state: 'outdated', confirmedVersion: 3 })
  })

  it('refuses an unknown policy and a template that is not a policy', async () => {
    mocks.template.mockResolvedValue(null)
    expect((await getPolicyOverview('allergens')).error).toBe('Policy not found.')
    mocks.template.mockResolvedValue({ ...template, kind: 'job_offer' })
    expect((await getPolicyOverview('allergens')).error).toBe('Policy not found.')
    expect((await getPolicyOverview('../etc')).error).toBe('Unknown policy.')
  })

  it('sends to each person in its own series, and one failure does not stop the rest', async () => {
    mocks.sendTemplate
      .mockResolvedValueOnce(delivered('Sam Example'))
      .mockRejectedValueOnce(new Error('pdf failed'))
      .mockResolvedValueOnce({ documentId: 'doc-3', version: 1, deliveries: [{ partyId: 'p3', name: 'Alex Unknown', email: 'a@example.com', email_status: 'failed', error: 'mailbox unavailable' }] })
    const result = await sendPolicyAcknowledgements({ slug: 'allergens', employeeIds: [ADULT, MINOR, NO_DOB] })
    expect(result.data?.sent).toBe(1)
    expect(result.data?.failed.map((failure) => failure.name)).toEqual(['Robin Young', 'Alex Unknown'])
    expect(result.data?.failed[1].reason).toContain('mailbox unavailable')
    expect(mocks.sendTemplate).toHaveBeenCalledTimes(3)
    expect(mocks.sendTemplate.mock.calls[0][0]).toMatchObject({ kind: 'policy_acknowledgement', slug: 'allergens', seriesKey: 'policy:allergens', subjectId: ADULT })
  })

  it('stops at once, with the reason, when the policy is switched off', async () => {
    mocks.sendTemplate.mockRejectedValue(new SigningError('template_inactive', 'The "Allergens policy" template is switched off.'))
    const result = await sendPolicyAcknowledgements({ slug: 'allergens', employeeIds: [ADULT, MINOR] })
    expect(result.error).toContain('switched off')
    expect(mocks.sendTemplate).toHaveBeenCalledTimes(1)
  })

  it('takes at most ten people in one call', async () => {
    const ids = Array.from({ length: 11 }, (_, index) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, '0')}`)
    expect((await sendPolicyAcknowledgements({ slug: 'allergens', employeeIds: ids })).error).toBeTruthy()
    expect((await sendPolicyAcknowledgements({ slug: 'allergens', employeeIds: [] })).error).toContain('at least one')
    expect(mocks.sendTemplate).not.toHaveBeenCalled()
  })
})
