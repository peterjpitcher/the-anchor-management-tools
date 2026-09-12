import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * What a candidate profile save does to `recruitment_candidates.phone_e164`.
 *
 * The "Edit candidate details" form on an application has a phone input but no phone_e164 input,
 * so the action sent phone_e164 as null and the save wrote it straight through. Every edit of a
 * candidate's name, location or notes therefore cleared the E.164 number that SMS sends to and
 * that duplicate matching compares. It now follows the phone the form sent, and a supplied
 * phone_e164 (the talent pool form has that input) still wins.
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
    sms_consent_at: '2026-06-01T09:00:00.000Z',
    future_recruitment_consent: true,
    future_recruitment_consent_at: '2026-06-01T09:00:00.000Z',
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

/** The fields the application-view edit form sends: a phone input, and no phone_e164 input. */
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

describe('candidate phone_e164 on a profile save', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps the E.164 number when the form carries no phone_e164 field', async () => {
    const { row } = buildDatabase()

    const result = await updateRecruitmentCandidateAction(null, editFormData({ notes: 'Weekends only' }))

    expect(result.success).toBe(true)
    expect(row.phone_e164).toBe('+447700900123')
    expect(row.notes).toBe('Weekends only')
  })

  it('moves the E.164 number with a corrected phone number', async () => {
    const { row } = buildDatabase()

    const result = await updateRecruitmentCandidateAction(null, editFormData({ phone: '07700 900456' }))

    expect(result.success).toBe(true)
    expect(row.phone).toBe('07700 900456')
    expect(row.phone_e164).toBe('+447700900456')
  })

  it('keeps a phone_e164 the form does send, for the talent pool form', async () => {
    const { row } = buildDatabase()

    const result = await updateRecruitmentCandidateAction(
      null,
      editFormData({ phone: '07700 900456', phone_e164: '+447700900999' })
    )

    expect(result.success).toBe(true)
    expect(row.phone_e164).toBe('+447700900999')
  })

  it('clears the E.164 number when the phone is cleared', async () => {
    const { row } = buildDatabase()

    const result = await updateRecruitmentCandidateAction(null, editFormData({ phone: '' }))

    expect(result.success).toBe(true)
    expect(row.phone).toBeNull()
    expect(row.phone_e164).toBeNull()
  })

  it('leaves the E.164 number unset when the phone cannot be read as a number', async () => {
    const { row } = buildDatabase({ phone: 'ask his mum', phone_e164: null })

    const result = await updateRecruitmentCandidateAction(null, editFormData({ phone: 'ask his mum' }))

    expect(result.success).toBe(true)
    expect(row.phone_e164).toBeNull()
  })
})
