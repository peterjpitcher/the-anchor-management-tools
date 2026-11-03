import type { createAdminClient } from '@/lib/supabase/admin'
import { formatDate } from '@/lib/dateUtils'
import { isPastLastWorkingDay } from '@/lib/employees/current-staff'
import { displayName } from '@/lib/employees/display-name'

/**
 * Someone on notice cannot be put on a shift after their last working day.
 *
 * The database only refuses an assignment for someone released from their remaining shifts
 * (guard_released_separation_assignment). Someone working their notice stays assignable, so a
 * manager edit or an approved open-shift request could still give them a shift after they
 * leave, and finalising the separation then refused until a manager moved it. This is the
 * check for those paths, on the same rule as everything else about leavers
 * (src/lib/employees/current-staff.ts): the last working day itself is still fine.
 */
export interface ShiftAssignment {
  employeeId: string | null | undefined
  shiftDate: string | null | undefined
}

type AdminClient = ReturnType<typeof createAdminClient>

type OnNoticeRow = {
  employee_id: string
  first_name: string | null
  last_name: string | null
  preferred_name: string | null
  status: string | null
  employment_end_date: string | null
}

/**
 * A refusal a manager can act on, naming who and their last working day, or null when every
 * assignment is fine. A failed read refuses too: an assignment that cannot be checked is not
 * written.
 */
export async function shiftAfterLastWorkingDayRefusal(
  admin: AdminClient,
  assignments: ShiftAssignment[],
): Promise<string | null> {
  const named = assignments.filter(
    (row): row is { employeeId: string; shiftDate: string } => Boolean(row.employeeId && row.shiftDate),
  )
  if (named.length === 0) return null

  const { data, error } = await admin
    .from('employees')
    .select('employee_id, first_name, last_name, preferred_name, status, employment_end_date')
    .in('employee_id', [...new Set(named.map(row => row.employeeId))])
    .eq('status', 'Started Separation')

  if (error) {
    console.error('[rota] Failed to check last working days before a shift assignment:', {
      code: error.code,
      message: error.message,
    })
    return 'Could not check whether anyone on this shift is leaving, so nothing was saved. Please try again.'
  }

  const onNotice = new Map(((data ?? []) as OnNoticeRow[]).map(row => [row.employee_id, row]))
  const refused = new Map<string, OnNoticeRow>()
  for (const row of named) {
    const employee = onNotice.get(row.employeeId)
    if (employee && isPastLastWorkingDay(employee, row.shiftDate)) refused.set(employee.employee_id, employee)
  }
  if (refused.size === 0) return null

  const sentences = [...refused.values()]
    .map(employee =>
      `${displayName(employee, 'That employee')} is leaving, with ${formatDate(employee.employment_end_date as string)} as their last working day, so they cannot be given a shift after it`,
    )
    .sort()
  return `${sentences.join('. ')}.`
}
