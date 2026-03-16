'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { checkUserPermission } from '@/app/actions/rbac';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { logAuditEvent } from '@/app/actions/audit';
import { sendRotaWeekEmails, sendRotaWeekChangeEmails, type DiffShiftRow } from '@/lib/rota/send-rota-emails';

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
  const day = d.getUTCDay(); // 0=Sun,1=Mon,...
  const diff = day === 0 ? -6 : 1 - day; // adjust so Mon=0
  d.setUTCDate(d.getUTCDate() + diff);
  d.setUTCHours(0, 0, 0, 0);
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

  // Validate that weekStart is a Monday (UTC day-of-week = 1)
  const dayOfWeek = new Date(weekStart + 'T00:00:00Z').getUTCDay();
  if (dayOfWeek !== 1) return { success: false, error: 'weekStart must be a Monday' };

  const supabase = await createClient();

  // Require edit permission before attempting insert
  const canCreate = await checkUserPermission('rota', 'edit');

  const WEEK_SELECT = 'id, week_start, status, published_at, published_by, has_unpublished_changes, created_at, updated_at';

  // Attempt insert first; if a unique violation occurs (concurrent insert), fall back to select
  const { data: created, error: insertError } = canCreate
    ? await supabase
        .from('rota_weeks')
        .insert({ week_start: weekStart })
        .select(WEEK_SELECT)
        .single()
    : { data: null, error: { code: '', message: 'Permission denied' } as { code: string; message: string } };

  if (!insertError) return { success: true, data: created as RotaWeek };

  // code 23505 = unique_violation — week already exists (concurrent insert)
  if (insertError.code === '23505' || insertError.code === '') {
    const { data: existing, error: selectError } = await supabase
      .from('rota_weeks')
      .select(WEEK_SELECT)
      .eq('week_start', weekStart)
      .single();

    if (selectError || !existing) {
      if (!canCreate) return { success: false, error: 'Permission denied' };
      return { success: false, error: selectError?.message ?? 'Rota week not found' };
    }
    return { success: true, data: existing as RotaWeek };
  }

  return { success: false, error: insertError.message };
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

  const sundayIso = addDaysIso(weekStart, 6);

  const { data, error } = await supabase
    .from('rota_shifts')
    .select('*')
    .gte('shift_date', weekStart)
    .lte('shift_date', sundayIso)
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

  // Fire-and-forget: audit logging failure should not block the operation
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

  // Fire-and-forget: audit logging failure should not block the operation
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

  // Fire-and-forget: audit logging failure should not block the operation
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

  // Fire-and-forget: audit logging failure should not block the operation
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

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Unauthorized' };

  const canView = await checkUserPermission('rota', 'view');
  if (!canView) {
    const { data: ownRecord } = await supabase
      .from('employees')
      .select('employee_id')
      .eq('employee_id', employeeId)
      .eq('auth_user_id', user.id)
      .maybeSingle();
    if (!ownRecord) return { success: false, error: 'Permission denied' };
  }

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

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Unauthorized' };

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

  // Fire-and-forget: audit logging failure should not block the operation
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
): Promise<{ success: true; created: number; shifts: RotaShift[] } | { success: false; error: string }> {
  const canEdit = await checkUserPermission('rota', 'edit');
  if (!canEdit) return { success: false, error: 'Permission denied' };

  const supabase = await createClient();

  // Parallelise: week, templates, existing shifts, and user auth all at once
  const [
    { data: week, error: weekError },
    { data: templates, error: tErr },
    { data: existing },
    { data: { user } },
  ] = await Promise.all([
    supabase.from('rota_weeks').select('week_start').eq('id', weekId).single(),
    supabase.from('rota_shift_templates').select('*').eq('is_active', true).not('day_of_week', 'is', null),
    supabase.from('rota_shifts').select('template_id, shift_date').eq('week_id', weekId),
    supabase.auth.getUser(),
  ]);

  if (weekError || !week) return { success: false, error: 'Rota week not found' };
  if (tErr) return { success: false, error: tErr.message };
  if (!templates?.length) return { success: true, created: 0, shifts: [] };

  const dayList = Array.from({ length: 7 }, (_, i) => addDaysIso(week.week_start as string, i));

  const existingSet = new Set(
    (existing ?? []).map((s: { template_id: string | null; shift_date: string }) =>
      `${s.template_id}:${s.shift_date}`,
    ),
  );

  // Build all inserts first, then batch insert in one round-trip (fixes N+1)
  const insertPayload: object[] = [];
  for (const t of templates) {
    if (t.day_of_week === null || t.day_of_week === undefined) continue;
    const dayIndex = t.day_of_week as number;
    if (dayIndex < 0 || dayIndex > 6) continue;
    const date = dayList[dayIndex];
    if (!date) continue;
    if (existingSet.has(`${t.id}:${date}`)) continue;

    insertPayload.push({
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
    });
  }

  if (insertPayload.length === 0) {
    return { success: true, created: 0, shifts: [] };
  }

  const { data: inserted, error: insertError } = await supabase
    .from('rota_shifts')
    .insert(insertPayload)
    .select('*');

  if (insertError) return { success: false, error: insertError.message };

  const newShifts = (inserted ?? []) as RotaShift[];

  if (newShifts.length > 0) {
    await supabase
      .from('rota_weeks')
      .update({ has_unpublished_changes: true })
      .eq('id', weekId)
      .eq('status', 'published');
    revalidatePath('/rota');
  }

  void logAuditEvent({
    user_id: user?.id,
    operation_type: 'create',
    resource_type: 'rota_week',
    resource_id: weekId,
    operation_status: 'success',
    additional_info: { action: 'auto_populate_from_templates', shifts_created: newShifts.length },
  });

  return { success: true, created: newShifts.length, shifts: newShifts };
}

// ---------------------------------------------------------------------------
// Add specific shifts from selected templates
// User picks template + date combinations from the AddShiftsModal.
// Server re-checks for duplicates (race condition safety) then batch-inserts.
// ---------------------------------------------------------------------------

export type ShiftSelection = { templateId: string; date: string }; // date = ISO "YYYY-MM-DD"

export async function addShiftsFromTemplates(
  weekId: string,
  selections: ShiftSelection[],
): Promise<
  { success: true; created: number; skipped: number; shifts: RotaShift[] } |
  { success: false; error: string }
> {
  const canEdit = await checkUserPermission('rota', 'edit');
  if (!canEdit) return { success: false, error: 'Permission denied' };
  if (!selections.length) return { success: false, error: 'No shifts selected' };

  const supabase = await createClient();

  const templateIds = [...new Set(selections.map(s => s.templateId))];

  const [
    { data: week, error: weekError },
    { data: templates, error: tErr },
    { data: existing },
    { data: { user } },
  ] = await Promise.all([
    supabase.from('rota_weeks').select('week_start').eq('id', weekId).single(),
    supabase.from('rota_shift_templates').select('*').in('id', templateIds),
    supabase.from('rota_shifts').select('template_id, shift_date').eq('week_id', weekId),
    supabase.auth.getUser(),
  ]);

  if (weekError || !week) return { success: false, error: 'Rota week not found' };
  if (tErr) return { success: false, error: tErr.message };

  type ShiftTemplate = { id: string; name: string; start_time: string; end_time: string; unpaid_break_minutes: number; department: string; employee_id: string | null };
  const templateMap = new Map((templates ?? []).map((t: ShiftTemplate) => [t.id, t]));

  // Server-side deduplication key: templateId:date
  const existingSet = new Set(
    (existing ?? []).map((s: { template_id: string | null; shift_date: string }) =>
      `${s.template_id}:${s.shift_date}`,
    ),
  );

  const insertPayload: object[] = [];
  for (const sel of selections) {
    if (existingSet.has(`${sel.templateId}:${sel.date}`)) continue;
    const t = templateMap.get(sel.templateId);
    if (!t) continue;

    insertPayload.push({
      week_id: weekId,
      employee_id: t.employee_id ?? null,
      is_open_shift: !t.employee_id,
      template_id: t.id,
      name: t.name as string,
      shift_date: sel.date,
      start_time: (t.start_time as string).slice(0, 5),
      end_time: (t.end_time as string).slice(0, 5),
      unpaid_break_minutes: t.unpaid_break_minutes,
      department: t.department,
      is_overnight: false,
      created_by: user?.id,
    });
  }

  // skipped = selections not in insertPayload (already existed server-side)
  const skipped = selections.length - insertPayload.length;

  if (insertPayload.length === 0) {
    return { success: true, created: 0, skipped, shifts: [] };
  }

  const { data: inserted, error: insertError } = await supabase
    .from('rota_shifts')
    .insert(insertPayload)
    .select('*');

  if (insertError) {
    void logAuditEvent({
      user_id: user?.id,
      operation_type: 'create',
      resource_type: 'rota_week',
      resource_id: weekId,
      operation_status: 'failure',
      additional_info: { action: 'add_shifts_from_selection', error: insertError.message },
    });
    return { success: false, error: insertError.message };
  }

  const newShifts = (inserted ?? []) as RotaShift[];

  if (newShifts.length > 0) {
    await supabase
      .from('rota_weeks')
      .update({ has_unpublished_changes: true })
      .eq('id', weekId)
      .eq('status', 'published');
    revalidatePath('/rota');
  }

  void logAuditEvent({
    user_id: user?.id,
    operation_type: 'create',
    resource_type: 'rota_week',
    resource_id: weekId,
    operation_status: 'success',
    additional_info: { action: 'add_shifts_from_selection', shifts_created: newShifts.length, shifts_skipped: skipped },
  });

  return { success: true, created: newShifts.length, skipped, shifts: newShifts };
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

  // Fetch week metadata early — needed to determine first vs. re-publish
  const { data: weekRow } = await supabase
    .from('rota_weeks')
    .select('week_start, status')
    .eq('id', weekId)
    .single();

  const isRepublish = weekRow?.status === 'published';

  // Snapshot current shifts into rota_published_shifts so staff only see
  // what was published, not in-progress edits.
  const { data: currentShifts } = await supabase
    .from('rota_shifts')
    .select('id, week_id, employee_id, shift_date, start_time, end_time, unpaid_break_minutes, department, status, notes, is_overnight, is_open_shift, name')
    .eq('week_id', weekId)
    .neq('status', 'cancelled');

  // Replace the snapshot atomically: delete the previous published snapshot for
  // this week, then insert the current state fresh. Using delete-then-insert is
  // simpler and more reliable than upsert + selective-delete; the sub-millisecond
  // empty window is acceptable for an internal management tool.
  // Must use the admin client — rota_published_shifts has no write RLS policies
  // for regular users (intentional: only the system should write to this table).
  const admin = createAdminClient();
  const now = new Date().toISOString();

  // For a re-publish, capture the previous snapshot BEFORE we overwrite it so we
  // can compute the per-employee diff and only email staff whose shifts changed.
  let previousPublishedShifts: DiffShiftRow[] = [];
  if (isRepublish) {
    const { data: prev } = await admin
      .from('rota_published_shifts')
      .select('id, employee_id, shift_date, start_time, end_time, department, name, is_open_shift')
      .eq('week_id', weekId);
    previousPublishedShifts = (prev ?? []) as DiffShiftRow[];
  }

  const { error: deleteError } = await admin
    .from('rota_published_shifts')
    .delete()
    .eq('week_id', weekId);
  if (deleteError) return { success: false, error: deleteError.message };

  if (currentShifts?.length) {
    const { error: insertError } = await admin
      .from('rota_published_shifts')
      .insert(currentShifts.map(s => ({ ...s, published_at: now })));
    if (insertError) return { success: false, error: insertError.message };
  }

  // Sync to management Google Calendar — fire-and-forget, must not block publish
  void (async () => {
    try {
      const { syncRotaWeekToCalendar } = await import('@/lib/google-calendar-rota');
      await syncRotaWeekToCalendar(weekId, currentShifts ?? []);
    } catch (err) {
      console.error('[RotaCalendar] Sync threw unexpectedly:', err);
    }
  })();

  // Only update status after snapshot succeeds
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

  // Fire-and-forget: audit logging failure should not block the operation
  void logAuditEvent({
    user_id: user?.id,
    operation_type: 'publish',
    resource_type: 'rota_week',
    resource_id: weekId,
    operation_status: 'success',
  });

  // Notify staff — fire-and-forget, errors must not block publish.
  // On first publish: everyone with shifts gets their full schedule.
  // On re-publish: only staff whose shifts changed get an update email.
  if (weekRow?.week_start) {
    if (isRepublish) {
      const newShiftsForDiff: DiffShiftRow[] = (currentShifts ?? []).map(s => ({
        id: s.id,
        employee_id: s.employee_id,
        shift_date: s.shift_date,
        start_time: s.start_time,
        end_time: s.end_time,
        department: s.department,
        name: s.name,
        is_open_shift: s.is_open_shift,
      }));
      void sendRotaWeekChangeEmails(weekId, weekRow.week_start, previousPublishedShifts, newShiftsForDiff);
    } else {
      void sendRotaWeekEmails(weekId, weekRow.week_start);
    }
  }

  revalidatePath('/rota');
  return { success: true };
}

/**
 * Re-sync all currently published rota weeks to the management Google Calendar.
 * Safe to call at any time — creates or updates events without sending staff emails.
 */
export async function resyncRotaCalendar(): Promise<
  { success: true; weeksSynced: number } | { success: false; error: string }
> {
  const canPublish = await checkUserPermission('rota', 'publish');
  if (!canPublish) return { success: false, error: 'Permission denied' };

  const admin = createAdminClient();

  const { data: weeks, error } = await admin
    .from('rota_weeks')
    .select('id')
    .eq('status', 'published');

  if (error) return { success: false, error: error.message };

  const { syncRotaWeekToCalendar } = await import('@/lib/google-calendar-rota');

  for (const week of weeks ?? []) {
    const { data: shifts } = await admin
      .from('rota_published_shifts')
      .select('id, week_id, employee_id, shift_date, start_time, end_time, department, status, notes, is_overnight, is_open_shift, name')
      .eq('week_id', week.id);

    try {
      await syncRotaWeekToCalendar(week.id, shifts ?? []);
    } catch (err) {
      console.error('[RotaCalendar] resync failed for week', week.id, err);
    }
  }

  return { success: true, weeksSynced: (weeks ?? []).length };
}
