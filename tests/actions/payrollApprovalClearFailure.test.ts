import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

/**
 * Every payroll edit clears the month's approval, so the approved snapshot cannot outlive the
 * figures it was taken from. When that delete is refused, the month used to stay approved with
 * the changed figures while the screen said the edit had saved. The edit has saved, so the user
 * is now told that, and told the approval is out of date, instead of seeing a plain success.
 */

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}))

vi.mock('@/app/actions/rbac', () => ({
  checkUserPermission: vi.fn().mockResolvedValue(true),
}))

vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/app/actions/timeclock', () => ({
  updateTimeclockSession: vi.fn().mockResolvedValue({ success: true }),
  createTimeclockSession: vi.fn().mockResolvedValue({ success: true }),
  deleteTimeclockSession: vi.fn().mockResolvedValue({ success: true }),
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { logAuditEvent } from '@/app/actions/audit'
import {
  deletePayrollRow,
  updatePayrollPeriod,
  updatePayrollRowTimes,
  upsertShiftNote,
} from '@/app/actions/payroll'
import { called, createRecordingSupabase, firstArgsOf } from '../mocks/recordingSupabase'

const mockedCreateAdminClient = createAdminClient as unknown as Mock
const mockedCreateClient = createClient as unknown as Mock
const mockedLogAuditEvent = logAuditEvent as unknown as Mock

const YEAR = 2026
const MONTH = 10

const OUT_OF_DATE =
  'but the payroll approval for October 2026 could not be cleared, so the approved figures are now out of date. Please try again to clear it, or tell the developer if this keeps happening.'

const REFUSED = { data: null, error: { message: 'permission denied for table payroll_month_approvals', code: '42501' } }

/** One database for both clients; the approval delete answers as `approvalDelete` says. */
function buildDatabase(approvalDelete: 'ok' | 'refused') {
  const db = createRecordingSupabase({
    tables: {
      payroll_month_approvals: () => (approvalDelete === 'ok' ? { data: null, error: null } : REFUSED),
      payroll_periods: () => ({
        data: { id: 'period-1', year: YEAR, month: MONTH, period_start: '2026-09-25', period_end: '2026-10-24' },
        error: null,
      }),
    },
  })
  const client = {
    ...db.client,
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1', email: 'manager@example.com' } }, error: null }),
    },
  }
  mockedCreateAdminClient.mockReturnValue(client)
  mockedCreateClient.mockResolvedValue(client)
  return db
}

describe('payroll edits when the month approval cannot be cleared', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  describe('upsertShiftNote', () => {
    it('tells the user the note saved but the approval is out of date', async () => {
      const db = buildDatabase('refused')

      const result = await upsertShiftNote('shift-1', 'Covered the late bar', YEAR, MONTH)

      expect(result).toEqual({ success: false, error: `The note change was saved, ${OUT_OF_DATE}` })
      const approvalDelete = db.queries.find(q => q.table === 'payroll_month_approvals')
      expect(approvalDelete && called(approvalDelete, 'delete')).toBe(true)
      expect(errorSpy).toHaveBeenCalled()
    })

    it('still succeeds when the approval clears', async () => {
      buildDatabase('ok')

      const result = await upsertShiftNote('shift-1', 'Covered the late bar', YEAR, MONTH)

      expect(result).toEqual({ success: true })
    })
  })

  describe('updatePayrollPeriod', () => {
    it('tells the user the dates saved but the approval is out of date', async () => {
      buildDatabase('refused')

      const result = await updatePayrollPeriod(YEAR, MONTH, '2026-09-25', '2026-10-24')

      expect(result).toEqual({ success: false, error: `The pay period dates were saved, ${OUT_OF_DATE}` })
    })

    it('still returns the saved period when the approval clears', async () => {
      buildDatabase('ok')

      const result = await updatePayrollPeriod(YEAR, MONTH, '2026-09-25', '2026-10-24')

      expect(result).toEqual({
        success: true,
        data: { id: 'period-1', year: YEAR, month: MONTH, period_start: '2026-09-25', period_end: '2026-10-24' },
      })
    })
  })

  describe('updatePayrollRowTimes', () => {
    it('tells the user the times saved but the approval is out of date', async () => {
      buildDatabase('refused')

      const result = await updatePayrollRowTimes('session-1', 'emp-1', '2026-10-03', '18:00', '23:00', YEAR, MONTH)

      expect(result).toEqual({ success: false, error: `The new times were saved, ${OUT_OF_DATE}` })
    })

    it('still succeeds when the approval clears', async () => {
      buildDatabase('ok')

      const result = await updatePayrollRowTimes('session-1', 'emp-1', '2026-10-03', '18:00', '23:00', YEAR, MONTH)

      expect(result).toEqual({ success: true })
    })
  })

  describe('deletePayrollRow', () => {
    it('tells the user the row was deleted but the approval is out of date, and still audits the delete', async () => {
      const db = buildDatabase('refused')

      const result = await deletePayrollRow(null, 'shift-1', YEAR, MONTH)

      expect(result).toEqual({ success: false, error: `The row was deleted, ${OUT_OF_DATE}` })
      const cancel = db.queries.find(q => q.table === 'rota_shifts')
      expect(cancel && firstArgsOf(cancel, 'update')).toEqual([{ status: 'cancelled' }])
      expect(mockedLogAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({ operation_type: 'delete', resource_type: 'rota_shift', resource_id: 'shift-1' }),
      )
    })

    it('still succeeds when the approval clears', async () => {
      buildDatabase('ok')

      const result = await deletePayrollRow(null, 'shift-1', YEAR, MONTH)

      expect(result).toEqual({ success: true })
      expect(mockedLogAuditEvent).toHaveBeenCalledTimes(1)
    })
  })
})
