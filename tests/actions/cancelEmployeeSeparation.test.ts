// Cancelling a separation that has started (FF-23, profile half).
//
// There was no way back once a separation had started: the edit form's status change failed
// against employees_separation_shift_policy_check, which only allows the shift policy and start
// time while the status is Started Separation. cancelEmployeeSeparation clears them together
// with the status change, notes and audits it, and refuses anyone not in Started Separation.
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/server', () => ({ after: vi.fn() }))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: vi.fn() }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn() }))
vi.mock('@/lib/audit-helpers', () => ({ getCurrentUser: vi.fn() }))
vi.mock('@/lib/email/employee-invite-emails', () => ({ sendSeparationStartedEmail: vi.fn() }))
vi.mock('@/lib/google-calendar-rota', () => ({ syncRotaWeekToCalendar: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))

import { revalidatePath } from 'next/cache'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from '@/app/actions/audit'
import { getCurrentUser } from '@/lib/audit-helpers'
import { createAdminClient } from '@/lib/supabase/admin'
import { cancelEmployeeSeparation } from '@/app/actions/employeeSeparation'

const mockedPermission = checkUserPermission as unknown as Mock
const mockedAudit = logAuditEvent as unknown as Mock
const mockedUser = getCurrentUser as unknown as Mock
const mockedAdmin = createAdminClient as unknown as Mock
const mockedRevalidate = revalidatePath as unknown as Mock

const EMPLOYEE_ID = '00000000-0000-4000-8000-000000000001'

const ON_NOTICE = {
  status: 'Started Separation',
  employment_end_date: '2026-11-20',
  separation_shift_policy: 'release_remaining',
  separation_started_at: '2026-11-01T10:00:00Z',
}

function adminFor(employee: Record<string, unknown> | null, updatedRows: unknown[] = [{ employee_id: EMPLOYEE_ID }]) {
  const statusFilter = vi.fn().mockReturnValue({
    select: vi.fn().mockResolvedValue({ data: updatedRows, error: null }),
  })
  const update = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ eq: statusFilter }) })
  const noteInsert = vi.fn().mockResolvedValue({ error: null })
  mockedAdmin.mockReturnValue({
    from: vi.fn((table: string) => {
      if (table === 'employees') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({ maybeSingle: vi.fn().mockResolvedValue({ data: employee, error: null }) }),
          }),
          update,
        }
      }
      if (table === 'employee_notes') return { insert: noteInsert }
      throw new Error(`Unexpected table: ${table}`)
    }),
  })
  return { update, statusFilter, noteInsert }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedPermission.mockResolvedValue(true)
  mockedUser.mockResolvedValue({ user_id: 'manager-1', user_email: 'manager@example.com' })
})

describe('cancelEmployeeSeparation', () => {
  it('puts the person back to Active and clears the separation fields in one update', async () => {
    const { update, statusFilter, noteInsert } = adminFor(ON_NOTICE)

    const result = await cancelEmployeeSeparation(EMPLOYEE_ID)

    expect(result).toEqual({ success: true })
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'Active',
      employment_end_date: null,
      separation_shift_policy: null,
      separation_started_at: null,
    }))
    // A separation finalised in the meantime is not silently undone.
    expect(statusFilter).toHaveBeenCalledWith('status', 'Started Separation')
    expect(noteInsert).toHaveBeenCalledWith(expect.objectContaining({
      employee_id: EMPLOYEE_ID,
      created_by_user_id: 'manager-1',
      note_text: expect.stringContaining('took them off every rota template'),
    }))
    expect(mockedAudit).toHaveBeenCalledWith(expect.objectContaining({
      operation_type: 'status_change',
      resource_type: 'employee',
      resource_id: EMPLOYEE_ID,
      old_values: expect.objectContaining({ status: 'Started Separation', employment_end_date: '2026-11-20' }),
      new_values: expect.objectContaining({ status: 'Active', employment_end_date: null }),
      additional_info: { action: 'cancel_separation' },
    }))
    expect(mockedRevalidate).toHaveBeenCalledWith(`/employees/${EMPLOYEE_ID}`)
  })

  it('refuses someone who is not in Started Separation', async () => {
    const { update } = adminFor({ ...ON_NOTICE, status: 'Former' })

    const result = await cancelEmployeeSeparation(EMPLOYEE_ID)

    expect(result).toEqual({
      success: false,
      error: 'Only a separation that has started can be cancelled. Refresh the page and try again.',
    })
    expect(update).not.toHaveBeenCalled()
    expect(mockedAudit).not.toHaveBeenCalled()
  })

  it('reports a separation finalised between loading and saving, without auditing a change', async () => {
    adminFor(ON_NOTICE, [])

    const result = await cancelEmployeeSeparation(EMPLOYEE_ID)

    expect(result).toEqual({
      success: false,
      error: 'This employee is no longer in Started Separation. Refresh the page and try again.',
    })
    expect(mockedAudit).not.toHaveBeenCalled()
  })

  it('refuses without employees edit permission', async () => {
    mockedPermission.mockResolvedValue(false)
    adminFor(ON_NOTICE)

    const result = await cancelEmployeeSeparation(EMPLOYEE_ID)

    expect(result).toEqual({ success: false, error: 'You do not have permission to perform this action.' })
    expect(mockedAdmin).not.toHaveBeenCalled()
  })
})
