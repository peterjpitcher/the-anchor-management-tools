import { createAdminClient } from '@/lib/supabase/admin'

/**
 * The one training on/off setting: `training_emails_enabled` (build contract 0.8 and 5.6). While
 * it is off, which is the default, the daily job sends no staff reminder and no manager training
 * email; the assignment sweep, the confirmation finishing step and the certificate retry still run.
 *
 * Stored the way the app stores its other switches (kitchen pacing, table holds): one
 * `system_settings` row, key `training_emails_enabled`, value `{ "value": true }`. The row does
 * not exist until someone switches the emails on, so no migration or seed is needed. Only the
 * boolean true means on: a missing row, `false`, a string, a number or any other shape is off.
 *
 * A read that fails is reported as unreadable and treated as off by the daily job, which says so
 * in its run record: not knowing the setting is not a reason to email anyone.
 *
 * Server only (admin client). The permission-checked actions for the Training page switch are in
 * src/app/actions/training-settings.ts.
 */

export const TRAINING_EMAILS_SETTING_KEY = 'training_emails_enabled'

const TRAINING_EMAILS_SETTING_DESCRIPTION =
  'Staff training: staff reminder emails and the manager training email. Off unless set to true.'

type AdminClient = ReturnType<typeof createAdminClient>

export type TrainingEmailsSetting =
  | { readable: true; enabled: boolean; updatedAt: string | null }
  | { readable: false; enabled: false; error: string }

/** True only for the boolean true, stored bare or wrapped as `{ value: true }`. */
export function isTrainingEmailsValueOn(value: unknown): boolean {
  if (value === true) return true
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return (value as Record<string, unknown>).value === true
  }
  return false
}

/** The setting as stored. Never throws: a failed read comes back as `readable: false`. */
export async function readTrainingEmailsSetting(supabase?: AdminClient): Promise<TrainingEmailsSetting> {
  try {
    const client = supabase ?? createAdminClient()
    const { data, error } = await client
      .from('system_settings')
      .select('value, updated_at')
      .eq('key', TRAINING_EMAILS_SETTING_KEY)
      .maybeSingle()
    if (error) {
      return { readable: false, enabled: false, error: error.message || 'The setting could not be read' }
    }
    if (!data) return { readable: true, enabled: false, updatedAt: null }
    const row = data as { value: unknown; updated_at: string | null }
    return { readable: true, enabled: isTrainingEmailsValueOn(row.value), updatedAt: row.updated_at ?? null }
  } catch (error) {
    return { readable: false, enabled: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/** Whether training emails are on. Off when the row is missing or cannot be read. */
export async function getTrainingEmailsEnabled(supabase?: AdminClient): Promise<boolean> {
  const setting = await readTrainingEmailsSetting(supabase)
  return setting.enabled
}

/**
 * Writes the setting. The caller has already checked `training:publish`. Throws when the write
 * is refused, so the switch never says it moved when it did not.
 */
export async function setTrainingEmailsEnabled(
  enabled: boolean,
  supabase?: AdminClient
): Promise<{ enabled: boolean; updatedAt: string }> {
  if (typeof enabled !== 'boolean') {
    throw new Error('The training emails setting must be true or false')
  }
  const client = supabase ?? createAdminClient()
  const updatedAt = new Date().toISOString()
  const { error } = await client.from('system_settings').upsert(
    {
      key: TRAINING_EMAILS_SETTING_KEY,
      value: { value: enabled },
      description: TRAINING_EMAILS_SETTING_DESCRIPTION,
      updated_at: updatedAt,
    },
    { onConflict: 'key' }
  )
  if (error) {
    throw new Error(`The training emails setting could not be saved: ${error.message}`)
  }
  return { enabled, updatedAt }
}
