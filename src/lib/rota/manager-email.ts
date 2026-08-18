import { isValidEmailAddress } from '@/lib/notifications/channel';
import type { createAdminClient } from '@/lib/supabase/admin';

/**
 * The one place any rota code learns where manager alerts go. Server only: it
 * reads `system_settings` with the admin client and falls back to an environment
 * variable, so it must never be imported into a client component.
 *
 * Priority, in order:
 *   1. `system_settings.rota_manager_email`, when it is present and a valid address
 *   2. `process.env.ROTA_MANAGER_EMAIL`, when it is a valid address
 *   3. a logged configuration error
 *
 * There is deliberately no hard-coded address. Three notification paths used to
 * carry their own copy of the manager mailbox, which made the Rota Settings screen
 * lie about what it controlled.
 *
 * A failed read is not the same as an absent setting. If the query itself errors we
 * return that error rather than quietly using the environment variable, because a
 * transient database fault silently redirecting alerts is exactly the failure this
 * resolver exists to prevent.
 */

const SETTING_KEY = 'rota_manager_email';

export type RotaManagerEmailResult = { email: string } | { error: string };

/** `system_settings.value` is jsonb. Rota settings wrap it as `{ "value": "..." }`. */
function readSettingString(value: unknown): string | null {
  if (typeof value === 'string') {
    return value.trim() || null;
  }

  if (value && typeof value === 'object' && 'value' in value) {
    const inner = (value as { value: unknown }).value;
    if (typeof inner === 'string') {
      return inner.trim() || null;
    }
  }

  return null;
}

export async function resolveRotaManagerEmail(
  supabase: ReturnType<typeof createAdminClient>,
): Promise<RotaManagerEmailResult> {
  // maybeSingle, not single: an absent row must come back as `data: null` rather
  // than as an error, or "never configured" would be indistinguishable from
  // "the database is having a bad day".
  const { data, error } = await supabase
    .from('system_settings')
    .select('value')
    .eq('key', SETTING_KEY)
    .maybeSingle();

  if (error) {
    const message = `Could not read the ${SETTING_KEY} setting: ${error.message}`;
    console.error(`[rota] ${message}`);
    return { error: message };
  }

  const settingEmail = readSettingString(data?.value);
  if (settingEmail) {
    if (isValidEmailAddress(settingEmail)) {
      return { email: settingEmail };
    }
    console.error(
      `[rota] The ${SETTING_KEY} setting is not a valid email address, falling back to ROTA_MANAGER_EMAIL.`,
    );
  }

  const envEmail = process.env.ROTA_MANAGER_EMAIL?.trim() || null;
  if (envEmail) {
    if (isValidEmailAddress(envEmail)) {
      return { email: envEmail };
    }
    const message = 'ROTA_MANAGER_EMAIL is set but is not a valid email address.';
    console.error(`[rota] ${message}`);
    return { error: message };
  }

  const message =
    'No rota manager email is configured. Set one in Settings > Rota, or set ROTA_MANAGER_EMAIL.';
  console.error(`[rota] ${message}`);
  return { error: message };
}
