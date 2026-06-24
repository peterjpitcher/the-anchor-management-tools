'use server';

import { createClient } from '@/lib/supabase/server';
import { checkUserPermission } from '@/app/actions/rbac';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { logAuditEvent } from '@/app/actions/audit';
import { normalizeNonWorkingWeekdays } from '@/lib/leave/working-days';

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

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

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
  if (existing.effective_from <= todayIsoDate()) {
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

  if (error && error.code !== 'PGRST116') return { success: false, error: error.message };
  return { success: true, data: (data ?? null) as EmployeePaySettings | null };
}

const PaySettingsSchema = z.object({
  employeeId: z.string().uuid(),
  payType: z.enum(['hourly', 'salaried']),
  maxWeeklyHours: z.number().positive().nullable().optional(),
  nonWorkingWeekdays: z.array(z.number().int().min(1).max(5)).max(5).optional(),
});

export async function upsertEmployeePaySettings(input: z.infer<typeof PaySettingsSchema>): Promise<
  { success: true; data: EmployeePaySettings } | { success: false; error: string }
> {
  const canManage = await checkUserPermission('employees', 'edit');
  if (!canManage) return { success: false, error: 'Permission denied' };

  const parsed = PaySettingsSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.message };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: existing } = await supabase
    .from('employee_pay_settings')
    .select('*')
    .eq('employee_id', parsed.data.employeeId)
    .maybeSingle();

  const nonWorkingWeekdays = normalizeNonWorkingWeekdays(parsed.data.nonWorkingWeekdays);
  const { data, error } = await supabase
    .from('employee_pay_settings')
    .upsert({
      employee_id: parsed.data.employeeId,
      pay_type: parsed.data.payType,
      max_weekly_hours: parsed.data.maxWeeklyHours ?? null,
      non_working_weekdays: nonWorkingWeekdays,
    }, { onConflict: 'employee_id' })
    .select('*')
    .single();

  if (error) return { success: false, error: error.message };
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

  if (error) return { success: false, error: error.message };
  return { success: true, data: (data ?? []) as EmployeeRateOverride[] };
}

const AddOverrideSchema = z.object({
  employeeId: z.string().uuid(),
  hourlyRate: z.number().positive().multipleOf(0.01),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function addEmployeeRateOverride(input: z.infer<typeof AddOverrideSchema>): Promise<
  { success: true; data: EmployeeRateOverride } | { success: false; error: string }
> {
  const canManage = await checkUserPermission('employees', 'edit');
  if (!canManage) return { success: false, error: 'Permission denied' };

  const parsed = AddOverrideSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.message };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

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

  if (error) return { success: false, error: error.message };
  revalidatePath(`/employees/${parsed.data.employeeId}`);
  return { success: true, data: data as EmployeeRateOverride };
}

export async function updateEmployeeRateOverride(input: z.infer<typeof UpdateRateSchema>): Promise<
  { success: true; data: EmployeeRateOverride } | { success: false; error: string }
> {
  const canManage = await checkUserPermission('employees', 'edit');
  if (!canManage) return { success: false, error: 'Permission denied' };

  const parsed = UpdateRateSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.message };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: existing, error: loadError } = await supabase
    .from('employee_rate_overrides')
    .select('*')
    .eq('id', parsed.data.id)
    .maybeSingle();

  if (loadError) return { success: false, error: loadError.message };
  if (!existing) return { success: false, error: 'Rate override not found' };
  if (existing.effective_from <= todayIsoDate()) {
    return { success: false, error: 'Historical or current overrides cannot be edited. Add a new future override instead.' };
  }

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

  if (error) return { success: false, error: error.message };
  await logAuditEvent({
    user_id: user?.id,
    operation_type: 'update',
    resource_type: 'employee_rate_override',
    resource_id: parsed.data.id,
    operation_status: 'success',
    old_values: existing as Record<string, unknown>,
    new_values: data as Record<string, unknown>,
  }).catch(() => {});
  revalidatePath(`/employees/${data.employee_id}`);
  return { success: true, data: data as EmployeeRateOverride };
}
