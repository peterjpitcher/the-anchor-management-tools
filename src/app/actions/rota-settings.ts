'use server';

import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { checkUserPermission } from '@/app/actions/rbac';
import { revalidatePath } from 'next/cache';
import { logAuditEvent } from '@/app/actions/audit';
import { isValidEmailAddress } from '@/lib/notifications/channel';

/**
 * The key the shared resolver in `src/lib/rota/manager-email.ts` reads. This screen
 * writes it, every rota notification path reads it through that resolver, so the
 * two must never drift apart.
 */
const MANAGER_EMAIL_SETTING_KEY = 'rota_manager_email';

export type RotaSettings = {
  holidayYearStartMonth: number; // 1–12
  holidayYearStartDay: number;   // 1–31
  defaultHolidayDays: number;
  managerEmail: string;
  accountantEmail: string;
  wageTargetPercent: number;
};

const DEFAULTS: RotaSettings = {
  // Deliberately 1 January, not the UK statutory 6 April: the owner's decision is
  // that the holiday year runs with the financial year. The live setting already
  // says 1 January, so this only matters when the setting is missing. Please do not
  // "correct" it back to 6 April.
  holidayYearStartMonth: 1,
  holidayYearStartDay: 1,
  defaultHolidayDays: 25,
  managerEmail: process.env.ROTA_MANAGER_EMAIL ?? '',
  accountantEmail: process.env.PAYROLL_ACCOUNTANT_EMAIL ?? '',
  wageTargetPercent: 25,
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

/**
 * A blank address is allowed: it clears the setting so the resolver falls back to
 * the environment variable. Anything else has to look like an address, because a
 * typo here silently sends every rota alert nowhere.
 */
function emailError(label: string, value: string): string | null {
  if (!value) return null;
  if (!isValidEmailAddress(value)) return `${label} is not a valid email address`;
  return null;
}

export async function getRotaSettings(): Promise<RotaSettings> {
  const supabase = createAdminClient();

  const [month, day, days, manager, accountant, wageTarget] = await Promise.all([
    readSetting(supabase, 'rota_holiday_year_start_month'),
    readSetting(supabase, 'rota_holiday_year_start_day'),
    readSetting(supabase, 'rota_default_holiday_days'),
    readSetting(supabase, MANAGER_EMAIL_SETTING_KEY),
    readSetting(supabase, 'payroll_accountant_email'),
    readSetting(supabase, 'rota_wage_target_percent'),
  ]);

  return {
    holidayYearStartMonth: (month?.value as number) ?? DEFAULTS.holidayYearStartMonth,
    holidayYearStartDay:   (day?.value as number)   ?? DEFAULTS.holidayYearStartDay,
    defaultHolidayDays:    (days?.value as number)  ?? DEFAULTS.defaultHolidayDays,
    // DB value takes precedence; fall back to env vars
    managerEmail:    ((manager?.value as string) || DEFAULTS.managerEmail),
    accountantEmail: ((accountant?.value as string) || DEFAULTS.accountantEmail),
    wageTargetPercent: Number(wageTarget?.value ?? DEFAULTS.wageTargetPercent),
  };
}

export async function updateRotaSettings(
  settings: Partial<RotaSettings>,
): Promise<{ success: true } | { success: false; error: string }> {
  const canManage = await checkUserPermission('settings', 'manage');
  if (!canManage) return { success: false, error: 'Permission denied' };
  const sessionClient = await createClient();
  const { data: { user } } = await sessionClient.auth.getUser();
  if (!user) return { success: false, error: 'Unauthorized' };

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
    const managerEmail = settings.managerEmail.trim();
    const managerEmailError = emailError('Rota manager alert email', managerEmail);
    if (managerEmailError) return { success: false, error: managerEmailError };
    upserts.push({ key: MANAGER_EMAIL_SETTING_KEY, value: { value: managerEmail } });
  }
  if (settings.accountantEmail !== undefined) {
    const accountantEmail = settings.accountantEmail.trim();
    const accountantEmailError = emailError('Payroll accountant email', accountantEmail);
    if (accountantEmailError) return { success: false, error: accountantEmailError };
    upserts.push({ key: 'payroll_accountant_email', value: { value: accountantEmail } });
  }
  if (settings.wageTargetPercent !== undefined) {
    upserts.push({ key: 'rota_wage_target_percent', value: { value: settings.wageTargetPercent } });
  }

  for (const row of upserts) {
    const { error } = await supabase
      .from('system_settings')
      .upsert({ key: row.key, value: row.value }, { onConflict: 'key' });
    if (error) return { success: false, error: error.message };
  }

  if (upserts.length > 0) {
    await logAuditEvent({
      user_id: user.id,
      ...(user.email && { user_email: user.email }),
      operation_type: 'update',
      resource_type: 'rota_settings',
      operation_status: 'success',
      new_values: {
        changed_keys: upserts.map(row => row.key),
      },
    }).catch(() => {});
  }

  revalidatePath('/settings/rota');
  revalidatePath('/rota');
  return { success: true };
}
