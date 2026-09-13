import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * What a candidate profile save does to the consent dates.
 *
 * `sms_consent_at` and `future_recruitment_consent_at` record WHEN consent was given. Both
 * candidate forms resend the tick on every save, and the save used to stamp the time whenever the
 * tick was on, so correcting a phone number or a note moved the consent date to today and the
 * original record of consent was lost. The date is now only stamped when consent is newly given,
 * and withdrawing consent still clears it.
 */

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}))

vi.mock('@/app/actions/rbac', () => ({
  checkUserPermission: vi.fn().mockResolvedValue(true),
}))

vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) },
  })),
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { updateRecruitmentCandidateAction } from '@/app/actions/recruitment'
import { called, createRecordingSupabase, firstArgsOf } from '../mocks/recordingSupabase'

const CONSENT_GIVEN_AT = '2026-06-01T09:00:00.000Z'

/** A database holding one candidate, applying any update to them. */
function buildDatabase(overrides: Record<string, unknown> = {}) {
  const row: Record<string, unknown> = {
    id: 'candidate-1',
    first_name: 'Sam',
    last_name: 'Green',
    email: 'sam.green@example.com',
    phone: '07700 900123',
    phone_e164: '+447700900123',
    location: 'Staines',
    notes: 'Available weekends',
    sms_consent: true,
    sms_consent_at: CONSENT_GIVEN_AT,
    future_recruitment_consent: true,
    future_recruitment_consent_at: CONSENT_GIVEN_AT,
    right_to_work_status: 'not_checked',
    ...overrides,
  }

  const db = createRecordingSupabase({
    tables: {
      recruitment_candidates: (query) => {
        if (called(query, 'update')) {
          Object.assign(row, firstArgsOf(query, 'update')?.[0])
        }
        return { data: { ...row }, error: null }
      },
    },
  })
  vi.mocked(createAdminClient).mockReturnValue(db.client as never)
  return { db, row }
}

/** The fields the application-view edit form sends, with both consent boxes ticked. */
function editFormData(overrides: Record<string, string> = {}): FormData {
  const formData = new FormData()
  formData.set('candidate_id', 'candidate-1')
  formData.set('first_name', 'Sam')
  formData.set('last_name', 'Green')
  formData.set('email', 'sam.green@example.com')
  formData.set('phone', '07700 900123')
  formData.set('location', 'Staines')
  formData.set('notes', 'Available weekends')
  formData.set('right_to_work_status', 'not_checked')
  formData.set('right_to_work_document_type', '')
  formData.set('right_to_work_checked_at', '')
  formData.set('sms_consent', 'on')
  formData.set('future_recruitment_consent', 'on')
  for (const [key, value] of Object.entries(overrides)) formData.set(key, value)
  return formData
}

/** An unticked checkbox is simply absent from the form data. */
function withoutConsent(formData: FormData, field: string): FormData {
  formData.delete(field)
  return formData
}

describe('candidate consent dates on a profile save', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps the original consent dates when an unrelated field is edited', async () => {
    const { row } = buildDatabase()

    const result = await updateRecruitmentCandidateAction(null, editFormData({ notes: 'Weekends only' }))

    expect(result.success).toBe(true)
    expect(row.sms_consent).toBe(true)
    expect(row.sms_consent_at).toBe(CONSENT_GIVEN_AT)
    expect(row.future_recruitment_consent_at).toBe(CONSENT_GIVEN_AT)
  })

  it('stamps the date when consent is newly given', async () => {
    const { row } = buildDatabase({
      sms_consent: false,
      sms_consent_at: null,
      future_recruitment_consent: false,
      future_recruitment_consent_at: null,
    })

    const before = Date.now()
    const result = await updateRecruitmentCandidateAction(null, editFormData())

    expect(result.success).toBe(true)
    expect(row.sms_consent).toBe(true)
    expect(Date.parse(row.sms_consent_at as string)).toBeGreaterThanOrEqual(before)
    expect(Date.parse(row.future_recruitment_consent_at as string)).toBeGreaterThanOrEqual(before)
  })

  it('clears the date when consent is withdrawn', async () => {
    const { row } = buildDatabase()

    const result = await updateRecruitmentCandidateAction(
      null,
      withoutConsent(editFormData(), 'sms_consent')
    )

    expect(result.success).toBe(true)
    expect(row.sms_consent).toBe(false)
    expect(row.sms_consent_at).toBeNull()
    // The other consent was left ticked, so its date is untouched.
    expect(row.future_recruitment_consent).toBe(true)
    expect(row.future_recruitment_consent_at).toBe(CONSENT_GIVEN_AT)
  })

  it('leaves an undated consent undated rather than inventing a date', async () => {
    const { row } = buildDatabase({ sms_consent: true, sms_consent_at: null })

    const result = await updateRecruitmentCandidateAction(null, editFormData())

    expect(result.success).toBe(true)
    expect(row.sms_consent).toBe(true)
    expect(row.sms_consent_at).toBeNull()
  })
})
