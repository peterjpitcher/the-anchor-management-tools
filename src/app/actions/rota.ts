'use server';

import { createClient } from '@/lib/supabase/server';
import { checkUserPermission } from '@/app/actions/rbac';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { logAuditEvent } from '@/app/actions/audit';
import { sendRotaWeekEmails } from '@/lib/rota/send-rota-emails';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RotaWeek = {
  id: string;
  week_start: string;
  status: 'draft' | 'published';
  published_at: string | null;
  published_by: string | null;
  has_unpublished_changes: boolean;
  created_at: string;
  updated_at: string;
};

export type RotaShift = {
  id: string;
  week_id: string;
  employee_id: string | null;
  template_id: string | null;
  shift_date: string;
  start_time: string;
  end_time: string;
  unpaid_break_minutes: number;
  department: string;
  status: 'scheduled' | 'sick' | 'cancelled';
  notes: string | null;
  is_overnight: boolean;
  is_open_shift: boolean;
  name: string | null;
  reassigned_from_id: string | null;
  reassigned_at: string | null;
  reassigned_by: string | null;
  reassignment_reason: string | null;
  created_at: string;
  updated_at: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getMondayOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun,1=Mon,...
  const diff = day === 0 ? -6 : 1 - day; // adjust so Mon=0
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function toIsoDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

function addDaysIso(isoDate: string, days: number): string {
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

// ---------------------------------------------------------------------------
// Get or create a rota week row
// ---------------------------------------------------------------------------

export async function getOrCreateRotaWeek(weekStart: string): Promise<
  { success: true; data: RotaWeek } | { success: false; error: string }
> {
  const canView = await checkUserPermission('rota', 'view');
  if (!canView) return { success: false, error: 'Permission denied' };

  const supabase = await createClient();

  const { data: existing } = await supabase
    .from('rota_weeks')
    .select('*')
    .eq('week_start', weekStart)
    .single();

  if (existing) return { success: true, data: existing as RotaWeek };

  const { data: created, error } = await supabase
    .from('rota_weeks')
    .insert({ week_start: weekStart })
    .select('*')
    .single();

  if (error) return { success: false, error: error.message };
  return { success: true, data: created as RotaWeek };
}

// ---------------------------------------------------------------------------
// Load a week's shifts with employee data
// ---------------------------------------------------------------------------

export async function getWeekShifts(weekStart: string): Promise<
  { success: true; data: RotaShift[] } | { success: false; error: string }
> {
  const canView = await checkUserPermission('rota', 'view');
  if (!canView) return { success: false, error: 'Permission denied' };

  const supabase = await createClient();

  const monday = new Date(weekStart);
  const sunday = new Date(weekStart);
  sunday.setDate(sunday.getDate() + 6);

  const { data, error } = await supabase
    .from('rota_shifts')
    .select('*')
    .gte('shift_date', toIsoDate(monday))
    .lte('shift_date', toIsoDate(sunday))
    .order('shift_date')
    .order('start_time');

  if (error) return { success: false, error: error.message };
  return { success: true, data: (data ?? []) as RotaShift[] };
}

// ---------------------------------------------------------------------------
// Create a shift
// ---------------------------------------------------------------------------

const CreateShiftSchema = z.object({
  weekId: z.string().uuid(),
  employeeId: z.string().uuid().nullable().optional(),
  isOpenShift: z.boolean().default(false),
  templateId: z.string().uuid().nullable().optional(),
  name: z.string().nullable().optional(),
  shiftDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).transform(t => t.slice(0, 5)),
  endTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).transform(t => t.slice(0, 5)),
  unpaidBreakMinutes: z.number().int().min(0).default(0),
  department: z.string().min(1),
  notes: z.string().nullable().optional(),
  isOvernight: z.boolean().default(false),
}).refine(
  d => d.isOpenShift || !!d.employeeId,
  { message: 'employeeId is required unless isOpenShift is true', path: ['employeeId'] },
);

export async function createShift(input: z.infer<typeof CreateShiftSchema>): Promise<
  { success: true; data: RotaShift } | { success: false; error: string }
> {
  const canCreate = await checkUserPermission('rota', 'create');
  if (!canCreate) return { success: false, error: 'Permission denied' };

  const parsed = CreateShiftSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.message };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: week, error: weekError } = await supabase
    .from('rota_weeks')
    .select('week_start')
    .eq('id', parsed.data.weekId)
    .single();

  if (weekError || !week) return { success: false, error: 'Rota week not found' };

  const weekStart = week.week_start as string;
  const weekEnd = addDaysIso(weekStart, 6);
  if (parsed.data.shiftDate < weekStart || parsed.data.shiftDate > weekEnd) {
    return { success: false, error: `Shift date must be within this rota week (${weekStart} to ${weekEnd})` };
  }

  const { data, error } = await supabase
    .from('rota_shifts')
    .insert({
      week_id: parsed.data.weekId,
      employee_id: parsed.data.isOpenShift ? null : (parsed.data.employeeId ?? null),
      is_open_shift: parsed.data.isOpenShift,
      template_id: parsed.data.templateId ?? null,
      name: parsed.data.name ?? null,
      shift_date: parsed.data.shiftDate,
      start_time: parsed.data.startTime,
      end_time: parsed.data.endTime,
      unpaid_break_minutes: parsed.data.unpaidBreakMinutes,
      department: parsed.data.department,
      notes: parsed.data.notes ?? null,
      is_overnight: parsed.data.isOvernight,
      created_by: user?.id,
    })
    .select('*')
    .single();

  if (error) return { success: false, error: error.message };

  // Mark week as having changes (if published)
  await supabase
    .from('rota_weeks')
    .update({ has_unpublished_changes: true })
    .eq('id', parsed.data.weekId)
    .eq('status', 'published');

  void logAuditEvent({
    user_id: user?.id,
    operation_type: 'create',
    resource_type: 'rota_shift',
    resource_id: data.id,
    operation_status: 'success',
    new_values: { employee_id: parsed.data.employeeId, shift_date: parsed.data.shiftDate, department: parsed.data.department },
  });

  revalidatePath('/rota');
  return { success: true, data: data as RotaShift };
}

// ---------------------------------------------------------------------------
// Update a shift
// ---------------------------------------------------------------------------

export async function updateShift(
  shiftId: string,
  updates: Partial<Pick<RotaShift, 'start_time' | 'end_time' | 'unpaid_break_minutes' | 'notes' | 'status' | 'is_overnight' | 'department'>>,
): Promise<{ success: true; data: RotaShift } | { success: false; error: string }> {
  const canEdit = await checkUserPermission('rota', 'edit');
  if (!canEdit) return { success: false, error: 'Permission denied' };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from('rota_shifts')
    .update(updates)
    .eq('id', shiftId)
    .select('*')
    .single();

  if (error) return { success: false, error: error.message };

  // Mark week as having unpublished changes
  await supabase
    .from('rota_weeks')
    .update({ has_unpublished_changes: true })
    .eq('id', data.week_id)
    .eq('status', 'published');

  void logAuditEvent({
    user_id: user?.id,
    operation_type: 'update',
    resource_type: 'rota_shift',
    resource_id: shiftId,
    operation_status: 'success',
    new_values: updates as Record<string, unknown>,
  });

  revalidatePath('/rota');
  return { success: true, data: data as RotaShift };
}

// ---------------------------------------------------------------------------
// Delete a shift
// ---------------------------------------------------------------------------

export async function deleteShift(shiftId: string): Promise<
  { success: true } | { success: false; error: string }
> {
  const canDelete = await checkUserPermission('rota', 'delete');
  if (!canDelete) return { success: false, error: 'Permission denied' };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // Fetch to get week_id before deleting
  const { data: shift } = await supabase
    .from('rota_shifts')
    .select('week_id, employee_id, shift_date')
    .eq('id', shiftId)
    .single();

  const { error } = await supabase
    .from('rota_shifts')
    .delete()
    .eq('id', shiftId);

  if (error) return { success: false, error: error.message };

  if (shift?.week_id) {
    await supabase
      .from('rota_weeks')
      .update({ has_unpublished_changes: true })
      .eq('id', shift.week_id)
      .eq('status', 'published');
  }

  void logAuditEvent({
    user_id: user?.id,
    operation_type: 'delete',
    resource_type: 'rota_shift',
    resource_id: shiftId,
    operation_status: 'success',
    old_values: { employee_id: shift?.employee_id, shift_date: shift?.shift_date },
  });

  revalidatePath('/rota');
  return { success: true };
}

// ---------------------------------------------------------------------------
// Mark shift sick
// ---------------------------------------------------------------------------

export async function markShiftSick(shiftId: string): Promise<
  { success: true } | { success: false; error: string }
> {
  return updateShift(shiftId, { status: 'sick' });
}

// ---------------------------------------------------------------------------
// Reassign a shift to a different employee
// ---------------------------------------------------------------------------

export async function reassignShift(
  shiftId: string,
  newEmployeeId: string,
  reason?: string,
): Promise<{ success: true; data: RotaShift } | { success: false; error: string }> {
  const canEdit = await checkUserPermission('rota', 'edit');
  if (!canEdit) return { success: false, error: 'Permission denied' };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // Fetch current shift to capture original employee
  const { data: current, error: fetchError } = await supabase
    .from('rota_shifts')
    .select('*')
    .eq('id', shiftId)
    .single();

  if (fetchError || !current) return { success: false, error: 'Shift not found' };

  const { data, error } = await supabase
    .from('rota_shifts')
    .update({
      employee_id: newEmployeeId,
      original_employee_id: current.original_employee_id ?? current.employee_id,
      reassigned_from_id: current.employee_id,
      reassigned_at: new Date().toISOString(),
      reassigned_by: user?.id,
      reassignment_reason: reason ?? null,
    })
    .eq('id', shiftId)
    .select('*')
    .single();

  if (error) return { success: false, error: error.message };

  await supabase
    .from('rota_weeks')
    .update({ has_unpublished_changes: true })
    .eq('id', current.week_id)
    .eq('status', 'published');

  void logAuditEvent({
    user_id: user?.id,
    operation_type: 'reassign',
    resource_type: 'rota_shift',
    resource_id: shiftId,
    operation_status: 'success',
    old_values: { employee_id: current.employee_id },
    new_values: { employee_id: newEmployeeId, reason },
  });

  revalidatePath('/rota');
  return { success: true, data: data as RotaShift };
}

// ---------------------------------------------------------------------------
// Get shifts for a specific employee across published weeks
// ---------------------------------------------------------------------------

export async function getEmployeeShifts(
  employeeId: string,
  fromDate: string,
  toDate: string,
): Promise<{ success: true; data: RotaShift[] } | { success: false; error: string }> {
  const supabase = await createClient();

  // Read from the published snapshot — only what was explicitly published is visible to staff
  const { data, error } = await supabase
    .from('rota_published_shifts')
    .select('*')
    .eq('employee_id', employeeId)
    .gte('shift_date', fromDate)
    .lte('shift_date', toDate)
    .order('shift_date')
    .order('start_time');

  if (error) return { success: false, error: error.message };
  return { success: true, data: (data ?? []) as RotaShift[] };
}

// ---------------------------------------------------------------------------
// Open shifts visible to staff on the portal (published weeks only)
// ---------------------------------------------------------------------------

export async function getOpenShiftsForPortal(
  fromDate: string,
  toDate: string,
): Promise<{ success: true; data: RotaShift[] } | { success: false; error: string }> {
  const supabase = await createClient();

  // Read from the published snapshot — only what was explicitly published is visible to staff
  const { data, error } = await supabase
    .from('rota_published_shifts')
    .select('*')
    .eq('is_open_shift', true)
    .gte('shift_date', fromDate)
    .lte('shift_date', toDate)
    .order('shift_date')
    .order('start_time');

  if (error) return { success: false, error: error.message };
  return { success: true, data: (data ?? []) as RotaShift[] };
}

// ---------------------------------------------------------------------------
// Move an existing shift to a new employee / date (within same week)
// ---------------------------------------------------------------------------

export async function moveShift(
  shiftId: string,
  newEmployeeId: string | null, // null = make it an open shift
  newShiftDate: string,
): Promise<{ success: true; data: RotaShift } | { success: false; error: string }> {
  const canEdit = await checkUserPermission('rota', 'edit');
  if (!canEdit) return { success: false, error: 'Permission denied' };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: currentShift, error: shiftError } = await supabase
    .from('rota_shifts')
    .select('week_id')
    .eq('id', shiftId)
    .single();

  if (shiftError || !currentShift) return { success: false, error: 'Shift not found' };

  const { data: week, error: weekError } = await supabase
    .from('rota_weeks')
    .select('week_start')
    .eq('id', currentShift.week_id)
    .single();

  if (weekError || !week) return { success: false, error: 'Rota week not found' };

  const weekStart = week.week_start as string;
  const weekEnd = addDaysIso(weekStart, 6);
  if (newShiftDate < weekStart || newShiftDate > weekEnd) {
    return { success: false, error: `Shift date must stay within this rota week (${weekStart} to ${weekEnd})` };
  }

  const { data, error } = await supabase
    .from('rota_shifts')
    .update({
      employee_id: newEmployeeId,
      is_open_shift: newEmployeeId === null,
      shift_date: newShiftDate,
    })
    .eq('id', shiftId)
    .select('*')
    .single();

  if (error) return { success: false, error: error.message };

  await supabase
    .from('rota_weeks')
    .update({ has_unpublished_changes: true })
    .eq('id', (data as RotaShift).week_id)
    .eq('status', 'published');

  void logAuditEvent({
    user_id: user?.id,
    operation_type: 'move',
    resource_type: 'rota_shift',
    resource_id: shiftId,
    operation_status: 'success',
    new_values: { employee_id: newEmployeeId, shift_date: newShiftDate },
  });

  revalidatePath('/rota');
  return { success: true, data: data as RotaShift };
}

// ---------------------------------------------------------------------------
// Auto-populate a week from scheduled templates
// Creates open shifts (or assigned shifts) for each template that has a day_of_week,
// skipping dates that already have a shift from that template.
// ---------------------------------------------------------------------------

export async function autoPopulateWeekFromTemplates(
  weekId: string,
  _days: string[], // 7 ISO dates, index 0=Monday … 6=Sunday
): Promise<{ success: true; created: number; shifts: RotaShift[] } | { success: false; error: string }> {
  const canEdit = await checkUserPermission('rota', 'edit');
  if (!canEdit) return { success: false, error: 'Permission denied' };

  const supabase = await createClient();

  const { data: week, error: weekError } = await supabase
    .from('rota_weeks')
    .select('week_start')
    .eq('id', weekId)
    .single();

  if (weekError || !week) return { success: false, error: 'Rota week not found' };

  const canonicalDays = Array.from({ length: 7 }, (_, i) => addDaysIso(week.week_start as string, i));
  const dayList = canonicalDays;

  const { data: templates, error: tErr } = await supabase
    .from('rota_shift_templates')
    .select('*')
    .eq('is_active', true)
    .not('day_of_week', 'is', null);

  if (tErr) return { success: false, error: tErr.message };
  if (!templates?.length) return { success: true, created: 0, shifts: [] };

  // Existing shifts for this week (to avoid duplicates per template+date)
  const { data: existing } = await supabase
    .from('rota_shifts')
    .select('template_id, shift_date')
    .eq('week_id', weekId);

  const existingSet = new Set(
    (existing ?? []).map((s: { template_id: string | null; shift_date: string }) =>
      `${s.template_id}:${s.shift_date}`,
    ),
  );

  const { data: { user } } = await supabase.auth.getUser();
  const newShifts: RotaShift[] = [];

  for (const t of templates) {
    if (t.day_of_week === null || t.day_of_week === undefined) continue;
    const dayIndex = t.day_of_week as number;
    if (dayIndex < 0 || dayIndex > 6) continue;
    const date = dayList[dayIndex];
    if (!date) continue;
    if (existingSet.has(`${t.id}:${date}`)) continue;

    const { data, error } = await supabase.from('rota_shifts').insert({
      week_id: weekId,
      employee_id: t.employee_id ?? null,
      is_open_shift: !t.employee_id,
      template_id: t.id,
      name: t.name as string,
      shift_date: date,
      start_time: (t.start_time as string).slice(0, 5),
      end_time: (t.end_time as string).slice(0, 5),
      unpaid_break_minutes: t.unpaid_break_minutes,
      department: t.department,
      is_overnight: false,
      created_by: user?.id,
    }).select('*').single();

    if (!error && data) newShifts.push(data as RotaShift);
  }

  if (newShifts.length > 0) {
    await supabase
      .from('rota_weeks')
      .update({ has_unpublished_changes: true })
      .eq('id', weekId)
      .eq('status', 'published');
    revalidatePath('/rota');
  }
  return { success: true, created: newShifts.length, shifts: newShifts };
}

// ---------------------------------------------------------------------------
// Active employees for the rota grid
// ---------------------------------------------------------------------------

export type RotaEmployee = {
  employee_id: string;
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  max_weekly_hours: number | null;
  is_active: boolean;
};

export async function getActiveEmployeesForRota(weekStart?: string): Promise<
  { success: true; data: RotaEmployee[] } | { success: false; error: string }
> {
  const canView = await checkUserPermission('rota', 'view');
  if (!canView) return { success: false, error: 'Permission denied' };

  const supabase = await createClient();

  const { data: employees, error: empError } = await supabase
    .from('employees')
    .select('employee_id, first_name, last_name, job_title')
    .eq('status', 'Active')
    .order('first_name')
    .order('last_name');

  if (empError) return { success: false, error: empError.message };

  const activeList = employees ?? [];
  const activeIds = new Set(activeList.map((e: { employee_id: string }) => e.employee_id));

  // If a week is provided, also include any former employees who have shifts that week
  type EmpRow = { employee_id: string; first_name: string | null; last_name: string | null; job_title: string | null };
  let formerList: EmpRow[] = [];
  if (weekStart) {
    const weekEnd = new Date(weekStart + 'T00:00:00');
    weekEnd.setDate(weekEnd.getDate() + 6);
    const weekEndStr = weekEnd.toISOString().split('T')[0];

    const { data: weekShifts } = await supabase
      .from('rota_shifts')
      .select('employee_id')
      .gte('shift_date', weekStart)
      .lte('shift_date', weekEndStr)
      .eq('is_open_shift', false)
      .not('employee_id', 'is', null);

    const formerIds = [...new Set(
      (weekShifts ?? [])
        .map((s: { employee_id: string | null }) => s.employee_id)
        .filter((id): id is string => id !== null && !activeIds.has(id))
    )];

    if (formerIds.length > 0) {
      const { data: formerEmployees } = await supabase
        .from('employees')
        .select('employee_id, first_name, last_name, job_title')
        .in('employee_id', formerIds)
        .order('first_name')
        .order('last_name');
      formerList = formerEmployees ?? [];
    }
  }

  const allIds = [...activeIds, ...formerList.map((e: EmpRow) => e.employee_id)];
  const settingsMap: Record<string, number | null> = {};
  if (allIds.length > 0) {
    const { data: settings } = await supabase
      .from('employee_pay_settings')
      .select('employee_id, max_weekly_hours')
      .in('employee_id', allIds);
    (settings ?? []).forEach((s: { employee_id: string; max_weekly_hours: number | null }) => {
      settingsMap[s.employee_id] = s.max_weekly_hours ?? null;
    });
  }

  const mapEmployee = (e: EmpRow, isActive: boolean): RotaEmployee => ({
    employee_id: e.employee_id,
    first_name: e.first_name,
    last_name: e.last_name,
    job_title: e.job_title,
    max_weekly_hours: settingsMap[e.employee_id] ?? null,
    is_active: isActive,
  });

  return {
    success: true,
    data: [
      ...activeList.map((e: EmpRow) => mapEmployee(e, true)),
      ...formerList.map((e: EmpRow) => mapEmployee(e, false)),
    ],
  };
}

// ---------------------------------------------------------------------------
// Leave days for a week (overlay on rota grid)
// ---------------------------------------------------------------------------

export type LeaveDayWithRequest = {
  employee_id: string;
  leave_date: string;
  request_id: string;
  status: 'pending' | 'approved' | 'declined';
};

export async function getLeaveDaysForWeek(weekStart: string): Promise<
  { success: true; data: LeaveDayWithRequest[] } | { success: false; error: string }
> {
  const canView = await checkUserPermission('rota', 'view');
  if (!canView) return { success: false, error: 'Permission denied' };

  const supabase = await createClient();

  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  const weekEndStr = weekEnd.toISOString().split('T')[0];

  const { data, error } = await supabase
    .from('leave_days')
    .select('leave_date, request_id, leave_requests(employee_id, status)')
    .gte('leave_date', weekStart)
    .lte('leave_date', weekEndStr);

  if (error) return { success: false, error: error.message };

  // Supabase returns join as array when types are unresolved — normalise
  const rows = (data ?? []) as Array<{
    leave_date: string;
    request_id: string;
    leave_requests: { employee_id: string; status: string } | { employee_id: string; status: string }[] | null;
  }>;

  return {
    success: true,
    data: rows
      .map(d => {
        const lr = Array.isArray(d.leave_requests) ? d.leave_requests[0] : d.leave_requests;
        if (!lr) return null;
        return {
          employee_id: lr.employee_id,
          leave_date: d.leave_date,
          request_id: d.request_id,
          status: lr.status as LeaveDayWithRequest['status'],
        };
      })
      .filter((d): d is LeaveDayWithRequest => d !== null),
  };
}

// ---------------------------------------------------------------------------
// Publish a rota week
// ---------------------------------------------------------------------------

export async function publishRotaWeek(weekId: string): Promise<
  { success: true } | { success: false; error: string }
> {
  const canPublish = await checkUserPermission('rota', 'publish');
  if (!canPublish) return { success: false, error: 'Permission denied' };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { error } = await supabase
    .from('rota_weeks')
    .update({
      status: 'published',
      published_at: new Date().toISOString(),
      published_by: user?.id,
      has_unpublished_changes: false,
    })
    .eq('id', weekId);

  if (error) return { success: false, error: error.message };

  // Snapshot current shifts into rota_published_shifts so staff only see
  // what was published, not in-progress edits.
  const { data: currentShifts } = await supabase
    .from('rota_shifts')
    .select('id, week_id, employee_id, shift_date, start_time, end_time, unpaid_break_minutes, department, status, notes, is_overnight, is_open_shift, name')
    .eq('week_id', weekId)
    .neq('status', 'cancelled');

  // Replace the snapshot for this week atomically
  await supabase.from('rota_published_shifts').delete().eq('week_id', weekId);

  if (currentShifts?.length) {
    const now = new Date().toISOString();
    await supabase.from('rota_published_shifts').insert(
      currentShifts.map(s => ({ ...s, published_at: now })),
    );
  }

  void logAuditEvent({
    user_id: user?.id,
    operation_type: 'publish',
    resource_type: 'rota_week',
    resource_id: weekId,
    operation_status: 'success',
  });

  // Notify staff of their shifts — fire-and-forget, errors must not block publish
  const { data: weekRow } = await supabase
    .from('rota_weeks')
    .select('week_start')
    .eq('id', weekId)
    .single();
  if (weekRow?.week_start) {
    void sendRotaWeekEmails(weekId, weekRow.week_start);
  }

  revalidatePath('/rota');
  return { success: true };
}
