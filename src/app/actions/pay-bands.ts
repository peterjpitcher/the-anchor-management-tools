'use server';

import { createClient } from '@/lib/supabase/server';
import { checkUserPermission } from '@/app/actions/rbac';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { logAuditEvent } from '@/app/actions/audit';
import { getTodayIsoDate, isValidIsoDate } from '@/lib/dateUtils';

export type PayAgeBand = {
  id: string;
  label: string;
  min_age: number;
  max_age: number | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type PayBandRate = {
  id: string;
  band_id: string;
  hourly_rate: number;
  effective_from: string;
  created_at: string;
};

export type EmployeePaySettings = {
  id: string;
  employee_id: string;
  pay_type: 'hourly' | 'salaried';
  max_weekly_hours: number | null;
  holiday_allowance_days: number | null;
  non_working_weekdays: number[] | null;
  created_at: string;
  updated_at: string;
};

// ---------------------------------------------------------------------------
// Pay age bands
// ---------------------------------------------------------------------------

export async function getPayAgeBands(): Promise<
  { success: true; data: PayAgeBand[] } | { success: false; error: string }
> {
  const [canViewPayroll, canManageSettings] = await Promise.all([
    checkUserPermission('payroll', 'view'),
    checkUserPermission('settings', 'manage'),
  ]);
  if (!canViewPayroll && !canManageSettings) return { success: false, error: 'Permission denied' };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('pay_age_bands')
    .select('*')
    .order('sort_order')
    .order('min_age');

  if (error) return { success: false, error: error.message };
  return { success: true, data: (data ?? []) as PayAgeBand[] };
}

const AgeBandSchema = z.object({
  label: z.string().min(1).max(50),
  minAge: z.number().int().min(0).max(100),
  maxAge: z.number().int().min(1).max(100).nullable().optional(),
  sortOrder: z.number().int().min(0).default(0),
});

const UpdateAgeBandSchema = AgeBandSchema.extend({
  id: z.string().uuid(),
  isActive: z.boolean(),
});

export async function createPayAgeBand(input: z.infer<typeof AgeBandSchema>): Promise<
  { success: true; data: PayAgeBand } | { success: false; error: string }
> {
  const canManage = await checkUserPermission('settings', 'manage');
  if (!canManage) return { success: false, error: 'Permission denied' };

  const parsed = AgeBandSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.message };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('pay_age_bands')
    .insert({
      label: parsed.data.label,
      min_age: parsed.data.minAge,
      max_age: parsed.data.maxAge ?? null,
      sort_order: parsed.data.sortOrder,
    })
    .select('*')
    .single();

  if (error) return { success: false, error: error.message };
  revalidatePath('/settings/pay-bands');
  return { success: true, data: data as PayAgeBand };
}

export async function updatePayAgeBand(input: z.infer<typeof UpdateAgeBandSchema>): Promise<
  { success: true; data: PayAgeBand } | { success: false; error: string }
> {
  const canManage = await checkUserPermission('settings', 'manage');
  if (!canManage) return { success: false, error: 'Permission denied' };

  const parsed = UpdateAgeBandSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.message };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: existing } = await supabase
    .from('pay_age_bands')
    .select('*')
    .eq('id', parsed.data.id)
    .maybeSingle();

  const { data, error } = await supabase
    .from('pay_age_bands')
    .update({
      label: parsed.data.label,
      min_age: parsed.data.minAge,
      max_age: parsed.data.maxAge ?? null,
      sort_order: parsed.data.sortOrder,
      is_active: parsed.data.isActive,
    })
    .eq('id', parsed.data.id)
    .select('*')
    .single();

  if (error) return { success: false, error: error.message };
  await logAuditEvent({
    user_id: user?.id,
    operation_type: 'update',
    resource_type: 'pay_age_band',
    resource_id: parsed.data.id,
    operation_status: 'success',
    old_values: existing ? existing as Record<string, unknown> : undefined,
    new_values: data as Record<string, unknown>,
  }).catch(() => {});
  revalidatePath('/settings/pay-bands');
  return { success: true, data: data as PayAgeBand };
}

// ---------------------------------------------------------------------------
// Pay band rates (append-only)
// ---------------------------------------------------------------------------

export async function getPayBandRates(bandId: string): Promise<
  { success: true; data: PayBandRate[] } | { success: false; error: string }
> {
  const [canViewPayroll, canManageSettings] = await Promise.all([
    checkUserPermission('payroll', 'view'),
    checkUserPermission('settings', 'manage'),
  ]);
  if (!canViewPayroll && !canManageSettings) return { success: false, error: 'Permission denied' };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('pay_band_rates')
    .select('*')
    .eq('band_id', bandId)
    .order('effective_from', { ascending: false });

  if (error) return { success: false, error: error.message };
  return { success: true, data: (data ?? []) as PayBandRate[] };
}

const AddRateSchema = z.object({
  bandId: z.string().uuid(),
  hourlyRate: z.number().positive().multipleOf(0.01),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const UpdateRateSchema = z.object({
  id: z.string().uuid(),
  hourlyRate: z.number().positive().multipleOf(0.01),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function addPayBandRate(input: z.infer<typeof AddRateSchema>): Promise<
  { success: true; data: PayBandRate } | { success: false; error: string }
> {
  const canManage = await checkUserPermission('settings', 'manage');
  if (!canManage) return { success: false, error: 'Permission denied' };

  const parsed = AddRateSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.message };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from('pay_band_rates')
    .insert({
      band_id: parsed.data.bandId,
      hourly_rate: parsed.data.hourlyRate,
      effective_from: parsed.data.effectiveFrom,
      created_by: user?.id,
    })
    .select('*')
    .single();

  if (error) return { success: false, error: error.message };
  revalidatePath('/settings/pay-bands');
  return { success: true, data: data as PayBandRate };
}

export async function updatePayBandRate(input: z.infer<typeof UpdateRateSchema>): Promise<
  { success: true; data: PayBandRate } | { success: false; error: string }
> {
  const canManage = await checkUserPermission('settings', 'manage');
  if (!canManage) return { success: false, error: 'Permission denied' };

  const parsed = UpdateRateSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.message };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: existing, error: loadError } = await supabase
    .from('pay_band_rates')
    .select('*')
    .eq('id', parsed.data.id)
    .maybeSingle();

  if (loadError) return { success: false, error: loadError.message };
  if (!existing) return { success: false, error: 'Rate not found' };
  if (existing.effective_from <= getTodayIsoDate()) {
    return { success: false, error: 'Historical or current rates cannot be edited. Add a new future rate instead.' };
  }

  const { data, error } = await supabase
    .from('pay_band_rates')
    .update({
      hourly_rate: parsed.data.hourlyRate,
      effective_from: parsed.data.effectiveFrom,
      created_by: user?.id,
    })
    .eq('id', parsed.data.id)
    .select('*')
    .single();

  if (error) return { success: false, error: error.message };
  await logAuditEvent({
    user_id: user?.id,
    operation_type: 'update',
    resource_type: 'pay_band_rate',
    resource_id: parsed.data.id,
    operation_status: 'success',
    old_values: existing as Record<string, unknown>,
    new_values: data as Record<string, unknown>,
  }).catch(() => {});
  revalidatePath('/settings/pay-bands');
  return { success: true, data: data as PayBandRate };
}

// ---------------------------------------------------------------------------
// Employee pay settings (upsert)
// ---------------------------------------------------------------------------

export async function getEmployeePaySettings(employeeId: string): Promise<
  { success: true; data: EmployeePaySettings | null } | { success: false; error: string }
> {
  const canViewEmployees = await checkUserPermission('employees', 'view');
  const canViewPayroll = await checkUserPermission('payroll', 'view');
  if (!canViewEmployees && !canViewPayroll) return { success: false, error: 'Permission denied' };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('employee_pay_settings')
    .select('*')
    .eq('employee_id', employeeId)
    .single();

  if (error && error.code !== 'PGRST116') {
    // Both the Pay tab and the Holidays tab (the allowance lives here) show this message, and
    // it wins over the plain rate overrides one. Postgres text used to reach both tabs.
    console.error('[pay settings] Failed to load pay settings:', { code: error.code, message: error.message });
    return {
      success: false,
      error: 'The pay and holiday allowance settings could not be loaded. Refresh the page to try again.',
    };
  }
  return { success: true, data: (data ?? null) as EmployeePaySettings | null };
}

const PaySettingsSchema = z.object({
  employeeId: z.string().uuid(),
  payType: z.enum(['hourly', 'salaried']),
  maxWeeklyHours: z.number().positive().nullable().optional(),
});

export async function upsertEmployeePaySettings(input: z.infer<typeof PaySettingsSchema>): Promise<
  { success: true; data: EmployeePaySettings } | { success: false; error: string }
> {
  const canManage = await checkUserPermission('employees', 'edit');
  if (!canManage) return { success: false, error: 'Permission denied' };

  const parsed = PaySettingsSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'Check the pay settings and try again.' };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // A former employee's pay is closed, the same as their rate overrides (FF-45).
  const { data: employee, error: employeeError } = await supabase
    .from('employees')
    .select('status')
    .eq('employee_id', parsed.data.employeeId)
    .maybeSingle();
  if (employeeError) {
    console.error('[pay settings] Failed to load the employee:', { code: employeeError.code, message: employeeError.message });
    return { success: false, error: 'Could not check the employee record. Please try again.' };
  }
  if (!employee) return { success: false, error: 'Employee not found.' };
  if (employee.status === 'Former') {
    return { success: false, error: 'This person has left, so their pay can no longer be changed.' };
  }

  const { data: existing } = await supabase
    .from('employee_pay_settings')
    .select('*')
    .eq('employee_id', parsed.data.employeeId)
    .maybeSingle();

  // non_working_weekdays is deliberately no longer written. Holiday now counts every calendar
  // day of an allowance-consuming leave type, so there is no weekday exclusion to configure.
  // The column is left in place until a later migration drops it, so nothing reading old rows
  // breaks in the meantime.
  const { data, error } = await supabase
    .from('employee_pay_settings')
    .upsert({
      employee_id: parsed.data.employeeId,
      pay_type: parsed.data.payType,
      max_weekly_hours: parsed.data.maxWeeklyHours ?? null,
    }, { onConflict: 'employee_id' })
    .select('*')
    .single();

  if (error) {
    console.error('[pay settings] Write failed:', { code: error.code, message: error.message });
    return { success: false, error: 'The pay settings could not be saved. Please try again.' };
  }
  await logAuditEvent({
    user_id: user?.id,
    operation_type: existing ? 'update' : 'create',
    resource_type: 'employee_pay_settings',
    resource_id: parsed.data.employeeId,
    operation_status: 'success',
    old_values: existing ? existing as Record<string, unknown> : undefined,
    new_values: data as Record<string, unknown>,
  }).catch(() => {});
  revalidatePath(`/employees/${parsed.data.employeeId}`);
  return { success: true, data: data as EmployeePaySettings };
}

// ---------------------------------------------------------------------------
// Employee rate overrides (append-only)
// ---------------------------------------------------------------------------

export type EmployeeRateOverride = {
  id: string;
  employee_id: string;
  hourly_rate: number;
  effective_from: string;
  created_at: string;
};

export async function getEmployeeRateOverrides(employeeId: string): Promise<
  { success: true; data: EmployeeRateOverride[] } | { success: false; error: string }
> {
  const canViewEmployees = await checkUserPermission('employees', 'view');
  const canViewPayroll = await checkUserPermission('payroll', 'view');
  if (!canViewEmployees && !canViewPayroll) return { success: false, error: 'Permission denied' };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('employee_rate_overrides')
    .select('*')
    .eq('employee_id', employeeId)
    .order('effective_from', { ascending: false });

  if (error) {
    // The Pay tab shows this message; Postgres text ("permission denied for table ...") used to.
    console.error('[rate override] Failed to load overrides:', { code: error.code, message: error.message });
    return { success: false, error: 'The rate overrides could not be loaded. Refresh the page to try again.' };
  }
  return { success: true, data: (data ?? []) as EmployeeRateOverride[] };
}

const AddOverrideSchema = z.object({
  employeeId: z.string().uuid(),
  hourlyRate: z.number().positive().multipleOf(0.01),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

type SessionClient = Awaited<ReturnType<typeof createClient>>;

/**
 * A plain message for override input that failed validation. The raw Zod text (a JSON list of
 * issues) used to reach the toast.
 */
function rateOverrideInputError(error: z.ZodError): string {
  const field = error.issues[0]?.path[0];
  if (field === 'hourlyRate') return 'Enter an hourly rate above zero, in pounds and pence.';
  if (field === 'effectiveFrom') return 'Choose a valid effective-from date.';
  return 'Check the rate override details and try again.';
}

/**
 * A plain message for an override write the database refused. Postgres text used to reach the
 * toast, including the constraint name when a second override was added for the same date.
 */
function rateOverrideWriteError(error: { code?: string; message?: string }): string {
  if (error.code === '23505') {
    return 'There is already a rate override starting on that date. Edit that one, or choose another date.';
  }
  console.error('[rate override] Write failed:', { code: error.code, message: error.message });
  return 'The rate override could not be saved. Please try again.';
}

/**
 * The checks every override write makes before it is saved: the rate cannot start in the past
 * (London date), because pay already worked at the old rate would silently change, and a former
 * employee's pay is closed. Returns a message to show, or null when the write may go ahead.
 */
async function checkRateOverrideAllowed(
  supabase: SessionClient,
  employeeId: string,
  effectiveFrom: string,
): Promise<string | null> {
  if (!isValidIsoDate(effectiveFrom)) return 'Choose a valid effective-from date.';
  if (effectiveFrom < getTodayIsoDate()) {
    return 'A rate override cannot start in the past. Choose today or a later date.';
  }

  const { data: employee, error } = await supabase
    .from('employees')
    .select('status')
    .eq('employee_id', employeeId)
    .maybeSingle();
  if (error) {
    console.error('[rate override] Failed to load the employee:', { code: error.code, message: error.message });
    return 'Could not check the employee record. Please try again.';
  }
  if (!employee) return 'Employee not found.';
  if (employee.status === 'Former') return 'This person has left, so their pay can no longer be changed.';
  return null;
}

export async function addEmployeeRateOverride(input: z.infer<typeof AddOverrideSchema>): Promise<
  { success: true; data: EmployeeRateOverride } | { success: false; error: string }
> {
  const canManage = await checkUserPermission('employees', 'edit');
  if (!canManage) return { success: false, error: 'Permission denied' };

  const parsed = AddOverrideSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: rateOverrideInputError(parsed.error) };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const refusal = await checkRateOverrideAllowed(supabase, parsed.data.employeeId, parsed.data.effectiveFrom);
  if (refusal) return { success: false, error: refusal };

  const { data, error } = await supabase
    .from('employee_rate_overrides')
    .insert({
      employee_id: parsed.data.employeeId,
      hourly_rate: parsed.data.hourlyRate,
      effective_from: parsed.data.effectiveFrom,
      created_by: user?.id,
    })
    .select('*')
    .single();

  if (error) return { success: false, error: rateOverrideWriteError(error) };
  await logAuditEvent({
    user_id: user?.id,
    operation_type: 'create',
    resource_type: 'employee_rate_override',
    resource_id: data.id,
    operation_status: 'success',
    new_values: data as Record<string, unknown>,
  }).catch(() => {});
  // The employee's own audit trail only reads rows filed against the employee, so the change is
  // filed there too or it never shows on their record.
  await logAuditEvent({
    user_id: user?.id,
    operation_type: 'update',
    resource_type: 'employee',
    resource_id: parsed.data.employeeId,
    operation_status: 'success',
    new_values: { hourly_rate: data.hourly_rate, effective_from: data.effective_from },
    additional_info: {
      action: 'add_rate_override',
      rate_override_id: data.id,
      hourly_rate: data.hourly_rate,
      effective_from: data.effective_from,
    },
  }).catch(() => {});
  revalidatePath(`/employees/${parsed.data.employeeId}`);
  return { success: true, data: data as EmployeeRateOverride };
}

export async function updateEmployeeRateOverride(input: z.infer<typeof UpdateRateSchema>): Promise<
  { success: true; data: EmployeeRateOverride } | { success: false; error: string }
> {
  const canManage = await checkUserPermission('employees', 'edit');
  if (!canManage) return { success: false, error: 'Permission denied' };

  const parsed = UpdateRateSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: rateOverrideInputError(parsed.error) };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: existing, error: loadError } = await supabase
    .from('employee_rate_overrides')
    .select('*')
    .eq('id', parsed.data.id)
    .maybeSingle();

  if (loadError) {
    console.error('[rate override] Failed to load the override:', { code: loadError.code, message: loadError.message });
    return { success: false, error: 'Could not load the rate override. Please try again.' };
  }
  if (!existing) return { success: false, error: 'Rate override not found' };
  if (existing.effective_from <= getTodayIsoDate()) {
    return { success: false, error: 'Historical or current overrides cannot be edited. Add a new future override instead.' };
  }

  const refusal = await checkRateOverrideAllowed(supabase, existing.employee_id, parsed.data.effectiveFrom);
  if (refusal) return { success: false, error: refusal };

  const { data, error } = await supabase
    .from('employee_rate_overrides')
    .update({
      hourly_rate: parsed.data.hourlyRate,
      effective_from: parsed.data.effectiveFrom,
      created_by: user?.id,
    })
    .eq('id', parsed.data.id)
    .select('*')
    .single();

  if (error) return { success: false, error: rateOverrideWriteError(error) };
  await logAuditEvent({
    user_id: user?.id,
    operation_type: 'update',
    resource_type: 'employee_rate_override',
    resource_id: parsed.data.id,
    operation_status: 'success',
    old_values: existing as Record<string, unknown>,
    new_values: data as Record<string, unknown>,
  }).catch(() => {});
  await logAuditEvent({
    user_id: user?.id,
    operation_type: 'update',
    resource_type: 'employee',
    resource_id: data.employee_id,
    operation_status: 'success',
    old_values: { hourly_rate: existing.hourly_rate, effective_from: existing.effective_from },
    new_values: { hourly_rate: data.hourly_rate, effective_from: data.effective_from },
    additional_info: {
      action: 'update_rate_override',
      rate_override_id: data.id,
      hourly_rate: data.hourly_rate,
      effective_from: data.effective_from,
      previous_hourly_rate: existing.hourly_rate,
      previous_effective_from: existing.effective_from,
    },
  }).catch(() => {});
  revalidatePath(`/employees/${data.employee_id}`);
  return { success: true, data: data as EmployeeRateOverride };
}
