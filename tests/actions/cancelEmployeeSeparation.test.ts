// Cancelling a separation that has started (FF-23, profile half).
//
// There was no way back once a separation had started: the edit form's status change failed
// against employees_separation_shift_policy_check, which only allows the shift policy and start
// time while the status is Started Separation. cancelEmployeeSeparation clears them together
// with the status change, notes and audits it, and refuses anyone not in Started Separation.
//
// The note and toast say what starting the separation really did to their shifts. Under "work
// agreed shifts" the shifts up to the last day were kept, so telling the manager to reassign
// "their shifts" sent them after shifts the person still held. The date reads as on the page.
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

    expect(result).toEqual({
      success: true,
      message: 'Separation cancelled. They stay on as Active. Reassign any released shifts still wanted and add them back to their rota templates.',
    })
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
      note_text: 'Separation cancelled. They stay on as Active. The last working day of 20 November 2026 was cleared. '
        + 'Starting the separation released all their remaining shifts to open shifts and took them off every rota template. '
        + 'Neither comes back on its own: reassign any shifts still wanted and add them back to their templates.',
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

  it('says the shifts up to the last day are still theirs when they were working their notice', async () => {
    const { noteInsert } = adminFor({ ...ON_NOTICE, employment_end_date: '2026-12-05', separation_shift_policy: 'work_remaining' })

    const result = await cancelEmployeeSeparation(EMPLOYEE_ID)

    expect(result).toEqual({
      success: true,
      message: 'Separation cancelled. They stay on as Active and keep their shifts up to the old last working day. Reassign any later shifts still wanted and add them back to their rota templates.',
    })
    const note = noteInsert.mock.calls[0][0].note_text as string
    // A single-digit day, as the employee page writes it: "5 December", never 2026-12-05 or "05".
    expect(note).toContain('The last working day of 5 December 2026 was cleared.')
    expect(note).toContain('kept their shifts up to the last working day, which are still theirs, but released any later shifts')
    expect(note).toContain('took them off every rota template')
    expect(note).not.toContain('released all their remaining shifts')
  })

  it('claims nothing about which shifts went when no policy is stored', async () => {
    const { noteInsert } = adminFor({ ...ON_NOTICE, separation_shift_policy: null, separation_started_at: null })

    const result = await cancelEmployeeSeparation(EMPLOYEE_ID)

    expect(result).toEqual(expect.objectContaining({ success: true }))
    const note = noteInsert.mock.calls[0][0].note_text as string
    expect(note).toContain('Any shifts released when the separation started stay open')
    expect(note).not.toContain('released all their remaining shifts')
    expect(note).not.toContain('kept their shifts')
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
      error: 'This employee is no longer on notice. Refresh the page and try again.',
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
