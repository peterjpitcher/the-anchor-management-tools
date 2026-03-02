'use server';

import { createClient } from '@/lib/supabase/server';
import { checkUserPermission } from '@/app/actions/rbac';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

export type Department = {
  name: string;
  label: string;
  sort_order: number;
};

export type DepartmentBudget = {
  id: string;
  department: string;
  budget_year: number;
  annual_hours: number;
  created_at: string;
  updated_at: string;
};

export async function getDepartmentBudgets(year?: number): Promise<
  { success: true; data: DepartmentBudget[] } | { success: false; error: string }
> {
  const supabase = await createClient();
  let query = supabase
    .from('department_budgets')
    .select('*')
    .order('budget_year', { ascending: false })
    .order('department');

  if (year) query = query.eq('budget_year', year);

  const { data, error } = await query;
  if (error) return { success: false, error: error.message };
  return { success: true, data: (data ?? []) as DepartmentBudget[] };
}

const BudgetSchema = z.object({
  department: z.string().min(1),
  budgetYear: z.number().int().min(2020).max(2100),
  annualHours: z.number().positive(),
});

export async function upsertDepartmentBudget(input: z.infer<typeof BudgetSchema>): Promise<
  { success: true; data: DepartmentBudget } | { success: false; error: string }
> {
  const canManage = await checkUserPermission('settings', 'manage');
  if (!canManage) return { success: false, error: 'Permission denied' };

  const parsed = BudgetSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.message };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from('department_budgets')
    .upsert({
      department: parsed.data.department,
      budget_year: parsed.data.budgetYear,
      annual_hours: parsed.data.annualHours,
      created_by: user?.id,
    }, { onConflict: 'department,budget_year' })
    .select('*')
    .single();

  if (error) return { success: false, error: error.message };
  revalidatePath('/settings/budgets');
  revalidatePath('/rota');
  return { success: true, data: data as DepartmentBudget };
}

export async function getDepartments(): Promise<
  { success: true; data: Department[] } | { success: false; error: string }
> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('departments')
    .select('name, label, sort_order')
    .order('sort_order')
    .order('name');
  if (error) return { success: false, error: error.message };
  return { success: true, data: (data ?? []) as Department[] };
}

const DepartmentSchema = z.object({
  name: z.string().min(1).max(50).regex(/^[a-z0-9_-]+$/, 'Name must be lowercase letters, numbers, hyphens or underscores only'),
  label: z.string().min(1).max(100),
});

export async function addDepartment(input: { name: string; label: string }): Promise<
  { success: true; data: Department } | { success: false; error: string }
> {
  const canManage = await checkUserPermission('settings', 'manage');
  if (!canManage) return { success: false, error: 'Permission denied' };

  const parsed = DepartmentSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.errors[0].message };

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from('departments')
    .select('sort_order')
    .order('sort_order', { ascending: false })
    .limit(1)
    .single();

  const nextSortOrder = existing ? existing.sort_order + 1 : 0;

  const { data, error } = await supabase
    .from('departments')
    .insert({ name: parsed.data.name, label: parsed.data.label, sort_order: nextSortOrder })
    .select('name, label, sort_order')
    .single();

  if (error) {
    if (error.code === '23505') return { success: false, error: 'A department with that name already exists' };
    return { success: false, error: error.message };
  }
  revalidatePath('/settings/budgets');
  revalidatePath('/rota');
  return { success: true, data: data as Department };
}

export async function deleteDepartment(name: string): Promise<
  { success: true } | { success: false; error: string }
> {
  const canManage = await checkUserPermission('settings', 'manage');
  if (!canManage) return { success: false, error: 'Permission denied' };

  const supabase = await createClient();

  // Check for any shifts using this department
  const { count } = await supabase
    .from('rota_shifts')
    .select('*', { count: 'exact', head: true })
    .eq('department', name);

  if (count && count > 0) {
    return { success: false, error: `Cannot delete — ${count} shift${count === 1 ? '' : 's'} use this department` };
  }

  const { error } = await supabase.from('departments').delete().eq('name', name);
  if (error) return { success: false, error: error.message };
  revalidatePath('/settings/budgets');
  revalidatePath('/rota');
  return { success: true };
}
