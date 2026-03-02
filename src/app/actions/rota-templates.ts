'use server';

import { createClient } from '@/lib/supabase/server';
import { checkUserPermission } from '@/app/actions/rbac';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

export type ShiftTemplate = {
  id: string;
  name: string;
  start_time: string;
  end_time: string;
  unpaid_break_minutes: number;
  department: string;
  colour: string | null;
  is_active: boolean;
  day_of_week: number | null;  // 0=Mon … 6=Sun; null = no scheduled day
  employee_id: string | null;  // if set, auto-populate assigns to this employee
  created_at: string;
  updated_at: string;
};

const TemplateSchema = z.object({
  name: z.string().min(1).max(80),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  unpaidBreakMinutes: z.number().int().min(0).default(0),
  department: z.string().min(1),
  colour: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
  dayOfWeek: z.number().int().min(0).max(6).nullable().optional(),
  employeeId: z.string().uuid().nullable().optional(),
});

export async function getShiftTemplates(): Promise<
  { success: true; data: ShiftTemplate[] } | { success: false; error: string }
> {
  const canView = await checkUserPermission('rota', 'view');
  if (!canView) return { success: false, error: 'Permission denied' };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('rota_shift_templates')
    .select('*')
    .eq('is_active', true)
    .order('department')
    .order('start_time');

  if (error) return { success: false, error: error.message };
  return { success: true, data: (data ?? []) as ShiftTemplate[] };
}

export async function createShiftTemplate(input: z.infer<typeof TemplateSchema>): Promise<
  { success: true; data: ShiftTemplate } | { success: false; error: string }
> {
  const canCreate = await checkUserPermission('rota', 'create');
  if (!canCreate) return { success: false, error: 'Permission denied' };

  const parsed = TemplateSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.message };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from('rota_shift_templates')
    .insert({
      name: parsed.data.name,
      start_time: parsed.data.startTime,
      end_time: parsed.data.endTime,
      unpaid_break_minutes: parsed.data.unpaidBreakMinutes,
      department: parsed.data.department,
      colour: parsed.data.colour ?? null,
      day_of_week: parsed.data.dayOfWeek ?? null,
      employee_id: parsed.data.employeeId ?? null,
      created_by: user?.id,
    })
    .select('*')
    .single();

  if (error) return { success: false, error: error.message };
  revalidatePath('/rota/templates');
  return { success: true, data: data as ShiftTemplate };
}

export async function updateShiftTemplate(
  templateId: string,
  input: Partial<z.infer<typeof TemplateSchema>>,
): Promise<{ success: true; data: ShiftTemplate } | { success: false; error: string }> {
  const canEdit = await checkUserPermission('rota', 'edit');
  if (!canEdit) return { success: false, error: 'Permission denied' };

  const supabase = await createClient();
  const updates: Record<string, unknown> = {};
  if (input.name !== undefined) updates.name = input.name;
  if (input.startTime !== undefined) updates.start_time = input.startTime;
  if (input.endTime !== undefined) updates.end_time = input.endTime;
  if (input.unpaidBreakMinutes !== undefined) updates.unpaid_break_minutes = input.unpaidBreakMinutes;
  if (input.department !== undefined) updates.department = input.department;
  if (input.colour !== undefined) updates.colour = input.colour;
  if ('dayOfWeek' in input) updates.day_of_week = input.dayOfWeek ?? null;
  if ('employeeId' in input) updates.employee_id = input.employeeId ?? null;

  const { data, error } = await supabase
    .from('rota_shift_templates')
    .update(updates)
    .eq('id', templateId)
    .select('*')
    .single();

  if (error) return { success: false, error: error.message };
  revalidatePath('/rota/templates');
  return { success: true, data: data as ShiftTemplate };
}

export async function deactivateShiftTemplate(templateId: string): Promise<
  { success: true } | { success: false; error: string }
> {
  const canEdit = await checkUserPermission('rota', 'edit');
  if (!canEdit) return { success: false, error: 'Permission denied' };

  const supabase = await createClient();
  const { error } = await supabase
    .from('rota_shift_templates')
    .update({ is_active: false })
    .eq('id', templateId);

  if (error) return { success: false, error: error.message };
  revalidatePath('/rota/templates');
  return { success: true };
}
