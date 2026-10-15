import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

/**
 * Rejecting a shift writes two copies: the published shift staff see, then the draft rota that
 * the next publish is built from. When the draft write was refused, the published copy already
 * said the shift was open while the draft still had the employee on it, the employee was told
 * the rejection had gone through, and the next publish put them back on a shift they had turned
 * down. The published change is now put back and the employee is told to try again.
 */

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}))

vi.mock('next/server', () => ({
  after: vi.fn((fn: () => void) => fn()),
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
  createClient: vi.fn(),
}))

vi.mock('@/lib/rota/send-rota-emails', () => ({
  sendRotaWeekEmails: vi.fn(),
  sendRotaWeekChangeEmails: vi.fn(),
}))

vi.mock('@/lib/rota/manager-email', () => ({
  resolveRotaManagerEmail: vi.fn().mockResolvedValue({ email: 'manager@example.com' }),
}))

vi.mock('@/lib/email/emailService', () => ({
  sendEmail: vi.fn().mockResolvedValue({ success: true, messageId: 'msg-1' }),
}))

vi.mock('@/services/employee-reliability', () => ({
  recordShiftReliabilityEvent: vi.fn().mockResolvedValue(undefined),
  recordCouldntWorkReliabilityEvent: vi.fn().mockResolvedValue(undefined),
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { logAuditEvent } from '@/app/actions/audit'
import { sendEmail } from '@/lib/email/emailService'
import { recordShiftReliabilityEvent } from '@/services/employee-reliability'
import { rejectPortalShift } from '@/app/actions/rota'
import { argsOf, createRecordingSupabase, firstArgsOf, type RecordedQuery } from '../mocks/recordingSupabase'

const mockedCreateAdminClient = createAdminClient as unknown as Mock
const mockedCreateClient = createClient as unknown as Mock

const SHIFT_ID = '550e8400-e29b-41d4-a716-446655440001'
const EMPLOYEE_ID = '660e8400-e29b-41d4-a716-446655440001'
const ORIGINAL_PUBLISHED_AT = '2098-12-01T10:00:00.000Z'

const employee = {
  employee_id: EMPLOYEE_ID,
  first_name: 'Sam',
  last_name: 'Taylor',
  preferred_name: null,
  email_address: 'sam@example.com',
}

/** A pending shift far enough ahead to be outside the two-week acceptance cutoff. */
const publishedShift = {
  id: SHIFT_ID,
  week_id: '770e8400-e29b-41d4-a716-446655440001',
  employee_id: EMPLOYEE_ID,
  shift_date: '2099-01-01',
  start_time: '09:00',
  end_time: '17:00',
  unpaid_break_minutes: 30,
  department: 'bar',
  status: 'scheduled',
  notes: null,
  is_overnight: false,
  name: null,
  is_open_shift: false,
  acceptance_status: 'pending',
  acceptance_decided_at: null,
  acceptance_decided_by: null,
  acceptance_note: null,
  auto_accept_reason: null,
  auto_accept_warning_sent_at: null,
  published_at: ORIGINAL_PUBLISHED_AT,
  first_published_at: ORIGINAL_PUBLISHED_AT,
}

const REFUSED = { data: null, error: { message: 'new row violates check constraint', code: '23514' } }

function isUpdate(query: RecordedQuery): boolean {
  return query.calls.some(call => call.method === 'update')
}

/**
 * The published table answers its read with the shift, its first update with the opened row
 * and any later update (the restore) as `restore` says. The draft rota answers as `draft` says.
 */
function buildDatabase(options: { draft: 'ok' | 'refused'; restore?: 'ok' | 'refused' }) {
  let publishedUpdates = 0
  const db = createRecordingSupabase({
    tables: {
      employees: () => ({ data: employee, error: null }),
      rota_published_shifts: query => {
        if (!isUpdate(query)) return { data: publishedShift, error: null }
        publishedUpdates += 1
        if (publishedUpdates === 1) {
          return { data: { ...publishedShift, ...(firstArgsOf(query, 'update')?.[0] as object) }, error: null }
        }
        return options.restore === 'refused' ? REFUSED : { data: null, error: null }
      },
      rota_shifts: () => (options.draft === 'ok' ? { data: null, error: null } : REFUSED),
    },
  })
  const client = {
    ...db.client,
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1', email: 'sam@example.com' } }, error: null }),
    },
  }
  mockedCreateClient.mockResolvedValue(client)
  mockedCreateAdminClient.mockReturnValue(client)
  return db
}

function publishedUpdatesOf(db: ReturnType<typeof buildDatabase>): RecordedQuery[] {
  return db.queries.filter(q => q.table === 'rota_published_shifts' && isUpdate(q))
}

describe('rejectPortalShift when the draft rota write fails', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('puts the published shift back and tells the employee the rejection did not go through', async () => {
    const db = buildDatabase({ draft: 'refused' })

    const result = await rejectPortalShift({ shiftId: SHIFT_ID, note: 'Away at a family wedding' })

    expect(result).toEqual({
      success: false,
      error: 'Your rejection did not go through, so the shift is still yours. Please try again.',
    })

    const updates = publishedUpdatesOf(db)
    expect(updates).toHaveLength(2)
    const restore = updates[1]
    expect(firstArgsOf(restore, 'update')).toEqual([{
      employee_id: EMPLOYEE_ID,
      is_open_shift: false,
      acceptance_status: 'pending',
      acceptance_decided_at: null,
      acceptance_decided_by: null,
      acceptance_note: null,
      auto_accept_reason: null,
      auto_accept_warning_sent_at: null,
      published_at: ORIGINAL_PUBLISHED_AT,
    }])
    // Only the row this action opened is restored, never a later change to it.
    expect(argsOf(restore, 'eq')).toEqual(expect.arrayContaining([['id', SHIFT_ID]]))
    expect(argsOf(restore, 'is')).toEqual([['employee_id', null]])
    const openedAt = (firstArgsOf(updates[0], 'update')?.[0] as { published_at: string }).published_at
    expect(argsOf(restore, 'eq')).toEqual(expect.arrayContaining([['published_at', openedAt]]))

    // Nothing that says the rejection happened is recorded or sent.
    expect(db.queries.some(q => q.table === 'rota_shift_rejections')).toBe(false)
    expect(sendEmail).not.toHaveBeenCalled()
    expect(recordShiftReliabilityEvent).not.toHaveBeenCalled()
    expect(logAuditEvent).not.toHaveBeenCalled()
  })

  it('still returns an error, and reports the failed restore, when the published shift cannot be put back', async () => {
    const db = buildDatabase({ draft: 'refused', restore: 'refused' })

    const result = await rejectPortalShift({ shiftId: SHIFT_ID, note: 'Away at a family wedding' })

    expect(result).toEqual({
      success: false,
      error: 'Your rejection did not go through. Please let Billy know so he can check the shift.',
    })
    expect(publishedUpdatesOf(db)).toHaveLength(2)
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('[rota_published_shifts] Restoring the published shift'),
      expect.objectContaining({ shiftId: SHIFT_ID, code: '23514' }),
    )
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('rejects the shift as before when both writes succeed', async () => {
    const db = buildDatabase({ draft: 'ok' })

    const result = await rejectPortalShift({ shiftId: SHIFT_ID, note: 'Away at a family wedding' })

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data).toEqual(expect.objectContaining({
      id: SHIFT_ID,
      employee_id: null,
      is_open_shift: true,
      acceptance_status: 'rejected',
    }))
    expect(publishedUpdatesOf(db)).toHaveLength(1)
    expect(db.queries.some(q => q.table === 'rota_shift_rejections')).toBe(true)
    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ operation_type: 'reject', resource_id: SHIFT_ID }))
    expect(recordShiftReliabilityEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'shift_rejected' }))
  })
})
