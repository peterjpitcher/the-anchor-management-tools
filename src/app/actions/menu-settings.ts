'use server';

import { createClient } from '@/lib/supabase/server';
import { checkUserPermission } from '@/app/actions/rbac';
import { revalidatePath } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';

const MENU_TARGET_SETTING_KEY = 'menu_target_gp_pct';
const DEFAULT_MENU_TARGET = 0.7;

type AnySupabaseClient = SupabaseClient<any, any, any>;

function normaliseTargetValue(input: unknown): number | null {
  if (input == null) {
    return null;
  }

  if (typeof input === 'number' && Number.isFinite(input)) {
    return input;
  }

  if (typeof input === 'string') {
    const parsed = Number.parseFloat(input);
    return Number.isFinite(parsed) ? parsed : null;
  }

  if (typeof input === 'object') {
    const record = input as Record<string, unknown>;
    const candidateKeys = [
      'target_gp_pct',
      'target',
      'value',
      'gp',
      'standard_gp_pct',
      'default',
    ];
    for (const key of candidateKeys) {
      if (key in record) {
        const nested = normaliseTargetValue(record[key]);
        if (nested !== null) {
          return nested;
        }
      }
    }
  }

  return null;
}

function clampTarget(value: number | null | undefined): number {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : DEFAULT_MENU_TARGET;
  if (numeric <= 0) return DEFAULT_MENU_TARGET;
  if (numeric >= 1) return Math.min(numeric / 100, 0.95);
  return numeric;
}

export async function getMenuTargetGp(options: { client?: AnySupabaseClient } = {}): Promise<number> {
  const client = options.client ?? (await createClient());

  const { data } = await client
    .from('system_settings')
    .select('value')
    .eq('key', MENU_TARGET_SETTING_KEY)
    .maybeSingle();

  const parsed = normaliseTargetValue(data?.value);
  return clampTarget(parsed);
}

export async function updateMenuTargetGp(rawTarget: number) {
  const hasPermission = await checkUserPermission('menu_management', 'manage');
  if (!hasPermission) {
    return { error: 'You do not have permission to update the GP target.' };
  }

  if (!Number.isFinite(rawTarget)) {
    return { error: 'Enter a valid number for the GP target.' };
  }

  const numeric = rawTarget > 1 ? rawTarget / 100 : rawTarget;
  if (numeric <= 0 || numeric >= 0.95) {
    return { error: 'GP target must be between 1% and 95%.' };
  }

  const client = await createClient();

  const upsertPayload = {
    key: MENU_TARGET_SETTING_KEY,
    value: { target_gp_pct: numeric },
    description: 'Standard gross profit target applied to all dishes.',
  };

  const { error: upsertError } = await client.from('system_settings').upsert(upsertPayload);
  if (upsertError) {
    console.error('Failed to update menu target in system_settings:', upsertError);
    return { error: 'Failed to save the GP target. Please try again.' };
  }

  const { error: updateError } = await client
    .from('menu_dishes')
    .update({ target_gp_pct: numeric })
    .neq('id', '00000000-0000-0000-0000-000000000000');

  if (updateError) {
    console.error('Failed to propagate GP target to dishes:', updateError);
    return { error: 'Saved the target, but failed to update existing dishes.' };
  }

  revalidatePath('/menu-management/dishes');
  revalidatePath('/menu-management');
  revalidatePath('/settings/menu-target');
  revalidatePath('/api/menu-management/dishes');

  return { success: true, target: numeric };
}
