'use server';

import { createAdminClient } from '@/lib/supabase/admin';
import { checkUserPermission } from '@/app/actions/rbac';
import { revalidatePath } from 'next/cache';

export type RotaSettings = {
  holidayYearStartMonth: number; // 1–12
  holidayYearStartDay: number;   // 1–31
  defaultHolidayDays: number;
  managerEmail: string;
  accountantEmail: string;
};

const DEFAULTS: RotaSettings = {
  holidayYearStartMonth: 4,
  holidayYearStartDay: 6,
  defaultHolidayDays: 25,
  managerEmail: process.env.ROTA_MANAGER_EMAIL ?? '',
  accountantEmail: process.env.PAYROLL_ACCOUNTANT_EMAIL ?? '',
};

async function readSetting(
  supabase: ReturnType<typeof createAdminClient>,
  key: string,
): Promise<{ value: unknown } | null> {
  const { data } = await supabase
    .from('system_settings')
    .select('value')
    .eq('key', key)
    .single();
  return data ? (data.value as { value: unknown }) : null;
}

export async function getRotaSettings(): Promise<RotaSettings> {
  const supabase = createAdminClient();

  const [month, day, days, manager, accountant] = await Promise.all([
    readSetting(supabase, 'rota_holiday_year_start_month'),
    readSetting(supabase, 'rota_holiday_year_start_day'),
    readSetting(supabase, 'rota_default_holiday_days'),
    readSetting(supabase, 'rota_manager_email'),
    readSetting(supabase, 'payroll_accountant_email'),
  ]);

  return {
    holidayYearStartMonth: (month?.value as number) ?? DEFAULTS.holidayYearStartMonth,
    holidayYearStartDay:   (day?.value as number)   ?? DEFAULTS.holidayYearStartDay,
    defaultHolidayDays:    (days?.value as number)  ?? DEFAULTS.defaultHolidayDays,
    // DB value takes precedence; fall back to env vars
    managerEmail:    ((manager?.value as string) || DEFAULTS.managerEmail),
    accountantEmail: ((accountant?.value as string) || DEFAULTS.accountantEmail),
  };
}

export async function updateRotaSettings(
  settings: Partial<RotaSettings>,
): Promise<{ success: true } | { success: false; error: string }> {
  const canManage = await checkUserPermission('settings', 'manage');
  if (!canManage) return { success: false, error: 'Permission denied' };

  const supabase = createAdminClient();

  const upserts: { key: string; value: Record<string, unknown>; description?: string }[] = [];

  if (settings.holidayYearStartMonth !== undefined) {
    upserts.push({ key: 'rota_holiday_year_start_month', value: { value: settings.holidayYearStartMonth } });
  }
  if (settings.holidayYearStartDay !== undefined) {
    upserts.push({ key: 'rota_holiday_year_start_day', value: { value: settings.holidayYearStartDay } });
  }
  if (settings.defaultHolidayDays !== undefined) {
    upserts.push({ key: 'rota_default_holiday_days', value: { value: settings.defaultHolidayDays } });
  }
  if (settings.managerEmail !== undefined) {
    upserts.push({ key: 'rota_manager_email', value: { value: settings.managerEmail } });
  }
  if (settings.accountantEmail !== undefined) {
    upserts.push({ key: 'payroll_accountant_email', value: { value: settings.accountantEmail } });
  }

  for (const row of upserts) {
    const { error } = await supabase
      .from('system_settings')
      .upsert({ key: row.key, value: row.value }, { onConflict: 'key' });
    if (error) return { success: false, error: error.message };
  }

  revalidatePath('/settings/rota');
  return { success: true };
}
