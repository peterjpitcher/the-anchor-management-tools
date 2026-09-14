'use server'

import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { z } from 'zod'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from '@/app/actions/audit'
import { getCurrentUser } from '@/lib/audit-helpers'
import { formatDateFull, getTodayIsoDate, isValidIsoDate, whenLondonClockReaches } from '@/lib/dateUtils'
import {
  sendSeparationStartedEmail,
  type SeparationShiftSummary,
} from '@/lib/email/employee-invite-emails'
import { syncRotaWeekToCalendar } from '@/lib/google-calendar-rota'
import { createAdminClient } from '@/lib/supabase/admin'

export type SeparationShiftPolicy = 'work_remaining' | 'release_remaining'

export type EmployeeSeparationShift = SeparationShiftSummary & {
  id: string
  weekId: string
  name: string | null
  weekStatus: 'draft' | 'published'
  acceptanceStatus: 'pending' | 'accepted' | 'rejected' | 'auto_accepted' | null
}

export type EmployeeSeparationPreview = {
  employmentStartDate: string | null
  shifts: EmployeeSeparationShift[]
  futureLeaveDates: string[]
}

export type EmployeeSeparationPreviewResult =
  | { success: true; data: EmployeeSeparationPreview }
  | { success: false; error: string }

export type BeginEmployeeSeparationInput = {
  employmentEndDate: string
  shiftPolicy: SeparationShiftPolicy
  note?: string
}

export type BeginEmployeeSeparationResult =
  | {
      success: true
      retainedShiftCount: number
      releasedShiftCount: number
      warning?: string
    }
  | { success: false; error: string }

type SeparationEmployeeRow = {
  email_address: string
  first_name: string | null
  last_name: string | null
  employment_start_date: string | null
  status: string
}

type SeparationShiftRow = {
  id: string
  week_id: string
  shift_date: string
  start_time: string
  end_time: string
  department: string | null
  name: string | null
  acceptance_status: EmployeeSeparationShift['acceptanceStatus']
  rota_weeks: { status: string } | { status: string }[] | null
}

type SeparationRpcShift = {
  id: string
  week_id: string
  shift_date: string
  start_time: string
  end_time: string
  department: string | null
  name: string | null
  acceptance_status: EmployeeSeparationShift['acceptanceStatus']
  week_status: string
}

const beginSchema = z.object({
  employmentEndDate: z.string(),
  shiftPolicy: z.enum(['work_remaining', 'release_remaining']),
  note: z.string().trim().max(500, 'Separation note must be 500 characters or fewer.').optional(),
})

const rpcShiftSchema = z.object({
  id: z.string().uuid(),
  week_id: z.string().uuid(),
  shift_date: z.string(),
  start_time: z.string(),
  end_time: z.string(),
  department: z.string().nullable(),
  name: z.string().nullable(),
  acceptance_status: z.enum(['pending', 'accepted', 'rejected', 'auto_accepted']).nullable(),
  week_status: z.string(),
})

const rpcResultSchema = z.object({
  state: z.string(),
  reason: z.string().optional(),
  employment_start_date: z.string().optional(),
  retained_shifts: z.array(rpcShiftSchema).optional(),
  released_shifts: z.array(rpcShiftSchema).optional(),
  affected_published_week_ids: z.array(z.string().uuid()).optional(),
})

function mapShift(row: SeparationShiftRow | SeparationRpcShift): EmployeeSeparationShift {
  const weekStatus = 'rota_weeks' in row
    ? (Array.isArray(row.rota_weeks) ? row.rota_weeks[0]?.status : row.rota_weeks?.status)
    : row.week_status

  return {
    id: row.id,
    weekId: row.week_id,
    shiftDate: row.shift_date,
    startTime: row.start_time,
    endTime: row.end_time,
    department: row.department,
    name: row.name,
    weekStatus: weekStatus === 'published' ? 'published' : 'draft',
    acceptanceStatus: row.acceptance_status,
  }
}

function isNotStartedShift(shift: { shift_date: string; start_time: string }, now: Date): boolean {
  const start = whenLondonClockReaches(shift.shift_date, shift.start_time)
  return Boolean(start && start.getTime() > now.getTime())
}

async function resyncPublishedWeeks(weekIds: string[]): Promise<void> {
  if (weekIds.length === 0) return
  const admin = createAdminClient()

  for (const weekId of weekIds) {
    const { data, error } = await admin
      .from('rota_published_shifts')
      .select('id, week_id, employee_id, shift_date, start_time, end_time, department, status, notes, is_overnight, is_open_shift, name')
      .eq('week_id', weekId)

    if (error || !data) {
      console.error('[beginEmployeeSeparation] Failed to load published week for calendar sync:', {
        weekId,
        code: error?.code,
        message: error?.message,
        details: error?.details,
        hint: error?.hint,
      })
      continue
    }

    try {
      await syncRotaWeekToCalendar(weekId, data)
    } catch (error) {
      console.error('[beginEmployeeSeparation] Calendar sync failed:', {
        weekId,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }
}

export async function getEmployeeSeparationPreview(
  employeeId: string,
): Promise<EmployeeSeparationPreviewResult> {
  const canEdit = await checkUserPermission('employees', 'edit')
  if (!canEdit) return { success: false, error: 'You do not have permission to perform this action.' }

  const admin = createAdminClient()
  const today = getTodayIsoDate()
  const now = new Date()

  const [employeeResult, shiftsResult, leaveResult] = await Promise.all([
    admin
      .from('employees')
      .select('employment_start_date, status')
      .eq('employee_id', employeeId)
      .maybeSingle(),
    admin
      .from('rota_shifts')
      .select('id, week_id, shift_date, start_time, end_time, department, name, acceptance_status, rota_weeks(status)')
      .eq('employee_id', employeeId)
      .eq('status', 'scheduled')
      .eq('is_open_shift', false)
      .gte('shift_date', today)
      .order('shift_date', { ascending: true })
      .order('start_time', { ascending: true }),
    admin
      .from('leave_days')
      .select('leave_date, leave_requests!inner(status)')
      .eq('employee_id', employeeId)
      .gte('leave_date', today)
      .eq('leave_requests.status', 'approved')
      .order('leave_date', { ascending: true }),
  ])

  if (employeeResult.error) {
    return { success: false, error: 'Failed to load employee.' }
  }
  if (!employeeResult.data || employeeResult.data.status !== 'Active') {
    return { success: false, error: 'This employee is no longer in Active status. Refresh the page and try again.' }
  }
  if (shiftsResult.error) {
    return { success: false, error: 'Failed to load remaining scheduled shifts.' }
  }
  if (leaveResult.error) {
    return { success: false, error: 'Failed to load future booked leave.' }
  }

  const shifts = ((shiftsResult.data ?? []) as SeparationShiftRow[])
    .filter((shift) => isNotStartedShift(shift, now))
    .map(mapShift)

  const futureLeaveDates = [...new Set(
    (leaveResult.data ?? []).map((row: { leave_date: string }) => row.leave_date),
  )]

  return {
    success: true,
    data: {
      employmentStartDate: employeeResult.data.employment_start_date,
      shifts,
      futureLeaveDates,
    },
  }
}

function rpcStateError(result: z.infer<typeof rpcResultSchema>): string {
  if (result.state === 'not_found') return 'Employee not found.'
  if (result.state === 'status_conflict') {
    return 'This employee is no longer in Active status. Refresh the page and try again.'
  }
  if (result.state === 'invalid_end_date') {
    return result.employment_start_date
      ? `Last working day must be after ${formatDateFull(result.employment_start_date)}.`
      : 'Last working day is required.'
  }
  if (result.state === 'invalid_shift_policy') return 'Choose what should happen to the remaining shifts.'
  return 'The separation could not be started.'
}

export async function beginEmployeeSeparation(
  employeeId: string,
  input: BeginEmployeeSeparationInput,
): Promise<BeginEmployeeSeparationResult> {
  const canEdit = await checkUserPermission('employees', 'edit')
  if (!canEdit) return { success: false, error: 'You do not have permission to perform this action.' }

  const parsed = beginSchema.safeParse(input)
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid separation details.' }
  }
  if (!isValidIsoDate(parsed.data.employmentEndDate)) {
    return { success: false, error: 'Last working day must be a valid date.' }
  }

  const admin = createAdminClient()
  const { data: employee, error: employeeError } = await admin
    .from('employees')
    .select('email_address, first_name, last_name, employment_start_date, status')
    .eq('employee_id', employeeId)
    .maybeSingle()

  if (employeeError) return { success: false, error: 'Failed to load employee.' }
  if (!employee || (employee as SeparationEmployeeRow).status !== 'Active') {
    return { success: false, error: 'This employee is no longer in Active status. Refresh the page and try again.' }
  }

  const employeeRow = employee as SeparationEmployeeRow
  if (employeeRow.employment_start_date && parsed.data.employmentEndDate <= employeeRow.employment_start_date) {
    return {
      success: false,
      error: `Last working day must be after ${formatDateFull(employeeRow.employment_start_date)}.`,
    }
  }

  const actor = await getCurrentUser()
  const startedAt = new Date().toISOString()
  const { data: rawResult, error: rpcError } = await admin.rpc('begin_employee_separation', {
    p_employee_id: employeeId,
    p_employment_end_date: parsed.data.employmentEndDate,
    p_shift_policy: parsed.data.shiftPolicy,
    p_actor_user_id: actor.user_id,
    p_started_at: startedAt,
  })

  if (rpcError) {
    console.error('[beginEmployeeSeparation] Transaction failed:', {
      code: rpcError.code,
      message: rpcError.message,
      details: rpcError.details,
      hint: rpcError.hint,
    })
    return { success: false, error: 'Failed to start separation and update the rota.' }
  }

  const result = rpcResultSchema.safeParse(rawResult)
  if (!result.success) {
    console.error('[beginEmployeeSeparation] Unexpected transaction result:', result.error.flatten())
    return { success: false, error: 'The separation returned an unexpected result.' }
  }
  if (result.data.state !== 'started') {
    return { success: false, error: rpcStateError(result.data) }
  }

  const retainedShifts = (result.data.retained_shifts ?? []).map(mapShift)
  const releasedShifts = (result.data.released_shifts ?? []).map(mapShift)
  const affectedWeekIds = result.data.affected_published_week_ids ?? []
  const note = parsed.data.note?.trim()
  const noteText = [
    'Separation started.',
    `Last working day: ${parsed.data.employmentEndDate}.`,
    parsed.data.shiftPolicy === 'work_remaining'
      ? `${retainedShifts.length} remaining shift${retainedShifts.length === 1 ? '' : 's'} retained; ${releasedShifts.length} released to open shifts.`
      : `${releasedShifts.length} remaining shift${releasedShifts.length === 1 ? '' : 's'} released to open shifts.`,
    note ? `Note: ${note}` : null,
  ].filter(Boolean).join(' ')

  const { error: noteError } = await admin.from('employee_notes').insert({
    employee_id: employeeId,
    note_text: noteText,
    created_by_user_id: actor.user_id,
  })
  if (noteError) {
    console.error('[beginEmployeeSeparation] Failed to add separation note:', {
      code: noteError.code,
      message: noteError.message,
      details: noteError.details,
      hint: noteError.hint,
    })
  }

  try {
    await logAuditEvent({
      user_id: actor.user_id ?? undefined,
      user_email: actor.user_email ?? undefined,
      operation_type: 'status_change',
      resource_type: 'employee',
      resource_id: employeeId,
      operation_status: 'success',
      new_values: {
        status: 'Started Separation',
        employment_end_date: parsed.data.employmentEndDate,
        separation_shift_policy: parsed.data.shiftPolicy,
      },
      additional_info: {
        retained_shift_ids: retainedShifts.map((shift) => shift.id),
        released_shift_ids: releasedShifts.map((shift) => shift.id),
      },
    })
  } catch (auditError) {
    console.error('[beginEmployeeSeparation] Audit log failed:', auditError)
  }

  let warning: string | undefined
  try {
    const employeeName = [employeeRow.first_name, employeeRow.last_name].filter(Boolean).join(' ') || null
    await sendSeparationStartedEmail({
      email: employeeRow.email_address,
      employeeName,
      employmentEndDate: parsed.data.employmentEndDate,
      todayIso: getTodayIsoDate(),
      shiftPolicy: parsed.data.shiftPolicy,
      remainingShifts: retainedShifts,
    })
  } catch (emailError) {
    console.error('[beginEmployeeSeparation] Failed to send separation email:', emailError)
    warning = 'Separation was started and the rota was updated, but the employee email could not be sent. Send it manually.'
  }

  if (affectedWeekIds.length > 0) {
    after(() => resyncPublishedWeeks(affectedWeekIds))
  }

  revalidatePath('/employees')
  revalidatePath(`/employees/${employeeId}`)
  revalidatePath('/rota')
  revalidatePath('/portal/shifts')

  return {
    success: true,
    retainedShiftCount: retainedShifts.length,
    releasedShiftCount: releasedShifts.length,
    ...(warning ? { warning } : {}),
  }
}
