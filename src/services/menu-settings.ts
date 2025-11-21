import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { SupabaseClient } from '@supabase/supabase-js';

const MENU_TARGET_SETTING_KEY = 'menu_target_gp_pct';
const DEFAULT_MENU_TARGET = 0.7; // 70%

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

export class MenuSettingsService {
  static async getMenuTargetGp(options: { client?: AnySupabaseClient } = {}): Promise<number> {
    const client = options.client ?? (await createClient());

    const { data } = await client
      .from('system_settings')
      .select('value')
      .eq('key', MENU_TARGET_SETTING_KEY)
      .maybeSingle();

    const parsed = normaliseTargetValue(data?.value);
    return clampTarget(parsed);
  }

  static async updateMenuTargetGp(rawTarget: number, userId: string, userEmail?: string): Promise<{ success: boolean; target?: number; error?: string }> {
    if (!Number.isFinite(rawTarget)) {
      return { success: false, error: 'Enter a valid number for the GP target.' };
    }

    const numeric = rawTarget > 1 ? rawTarget / 100 : rawTarget;
    if (numeric <= 0 || numeric >= 0.95) {
      return { success: false, error: 'GP target must be between 1% and 95%.' };
    }

    const adminClient = createAdminClient();

    try {
      const { data, error } = await adminClient.rpc('update_menu_target_gp_transaction', {
        p_new_target_gp: numeric,
        p_user_id: userId,
        p_user_email: userEmail
      });

      if (error) {
        console.error('RPC update_menu_target_gp_transaction error:', error);
        throw new Error('Failed to save the GP target via transaction.');
      }

      // The RPC returns { success: true, new_target_gp: ... }
      return { success: data.success, target: data.new_target_gp };

    } catch (error: any) {
      console.error('Error in MenuSettingsService.updateMenuTargetGp:', error);
      return { success: false, error: error.message || 'Failed to update the GP target.' };
    }
  }
}
