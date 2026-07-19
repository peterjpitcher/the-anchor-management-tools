// src/lib/checklists/rota.ts
// Published-shift reader for the checklists engine (spec 6). Applies the canonical
// published-shift filter (scheduled, not an open shift, has an employee) at the query level
// so accountability/coverage/mismatch all consume the same set. Service-role admin client.

import { createAdminClient } from '@/lib/supabase/admin'
import type { ShiftRow } from '@/lib/checklists/types'

/**
 * Published shifts for a business date, already narrowed to the canonical filter (spec 6):
 * `status = 'scheduled'`, `is_open_shift = false`, `employee_id IS NOT NULL`.
 */
export async function getPublishedShiftsForDate(businessDate: string): Promise<ShiftRow[]> {
  const db = createAdminClient()

  const { data, error } = await db
    .from('rota_published_shifts')
    .select('employee_id, shift_date, start_time, end_time, department, status, is_open_shift')
    .eq('shift_date', businessDate)
    .eq('status', 'scheduled')
    .eq('is_open_shift', false)
    .not('employee_id', 'is', null)

  if (error) throw error

  return (data ?? []).map((r) => ({
    employeeId: r.employee_id,
    shiftDate: r.shift_date,
    startTime: r.start_time,
    endTime: r.end_time,
    department: r.department,
    status: r.status,
    isOpenShift: r.is_open_shift,
  }))
}
