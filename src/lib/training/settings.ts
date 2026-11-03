import { createAdminClient } from '@/lib/supabase/admin'

/**
 * The two training on/off settings. Both ship off and are switched on the Courses page by
 * holders of `training:publish`.
 *
 * - `training_emails_enabled` (build contract 0.8 and 5.6). While it is off, the daily job sends no
 *   staff reminder and no manager training email; the assignment sweep, the confirmation
 *   finishing step and the certificate retry still run.
 * - `training_auto_assign_enabled` (owner decision, 3 November 2026: nothing is given to staff
 *   automatically until the owner says so). While it is off, the assignment sync creates no cycle
 *   of any reason (new starters, existing staff, a course added, refreshers, renewals, redos) and
 *   raises no date of birth flag. It still cancels open cycles (a leaver, a retired course, a group
 *   removed), releases waiting cycles a manager created, and ends pauses. A manager can still
 *   assign a course by hand on a person's Training tab.
 *
 * Stored the way the app stores its other switches (kitchen pacing, table holds): one
 * `system_settings` row per key, value `{ "value": true }`. A row does not exist until someone
 * switches it on, so no migration or seed is needed. Only the boolean true means on: a missing row,
 * `false`, a string, a number or any other shape is off.
 *
 * A read that fails is reported as unreadable and treated as off: not knowing the setting is not a
 * reason to email anyone or to give anyone a course.
 *
 * Server only (admin client). The permission-checked actions for the switches are in
 * src/app/actions/training-settings.ts.
 */

export const TRAINING_EMAILS_SETTING_KEY = 'training_emails_enabled'
export const TRAINING_AUTO_ASSIGN_SETTING_KEY = 'training_auto_assign_enabled'

const TRAINING_EMAILS_SETTING_DESCRIPTION =
  'Staff training: staff reminder emails and the manager training email. Off unless set to true.'
const TRAINING_AUTO_ASSIGN_SETTING_DESCRIPTION =
  'Staff training: give courses to staff automatically (new starters, new courses, refreshers, redos). Off unless set to true.'

type AdminClient = ReturnType<typeof createAdminClient>

/** One training switch as stored. */
export type TrainingSwitchSetting =
  | { readable: true; enabled: boolean; updatedAt: string | null }
  | { readable: false; enabled: false; error: string }

export type TrainingEmailsSetting = TrainingSwitchSetting
export type TrainingAutoAssignSetting = TrainingSwitchSetting

/** True only for the boolean true, stored bare or wrapped as `{ value: true }`. */
export function isTrainingEmailsValueOn(value: unknown): boolean {
  if (value === true) return true
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return (value as Record<string, unknown>).value === true
  }
  return false
}

async function readSwitch(key: string, supabase?: AdminClient): Promise<TrainingSwitchSetting> {
  try {
    const client = supabase ?? createAdminClient()
    const { data, error } = await client
      .from('system_settings')
      .select('value, updated_at')
      .eq('key', key)
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

async function writeSwitch(
  input: { key: string; description: string; what: string; enabled: boolean },
  supabase?: AdminClient
): Promise<{ enabled: boolean; updatedAt: string }> {
  if (typeof input.enabled !== 'boolean') {
    throw new Error(`The ${input.what} setting must be true or false`)
  }
  const client = supabase ?? createAdminClient()
  const updatedAt = new Date().toISOString()
  const { error } = await client.from('system_settings').upsert(
    {
      key: input.key,
      value: { value: input.enabled },
      description: input.description,
      updated_at: updatedAt,
    },
    { onConflict: 'key' }
  )
  if (error) {
    throw new Error(`The ${input.what} setting could not be saved: ${error.message}`)
  }
  return { enabled: input.enabled, updatedAt }
}

/** The emails setting as stored. Never throws: a failed read comes back as `readable: false`. */
export async function readTrainingEmailsSetting(supabase?: AdminClient): Promise<TrainingEmailsSetting> {
  return readSwitch(TRAINING_EMAILS_SETTING_KEY, supabase)
}

/** Whether training emails are on. Off when the row is missing or cannot be read. */
export async function getTrainingEmailsEnabled(supabase?: AdminClient): Promise<boolean> {
  const setting = await readTrainingEmailsSetting(supabase)
  return setting.enabled
}

/**
 * Writes the emails setting. The caller has already checked `training:publish`. Throws when the
 * write is refused, so the switch never says it moved when it did not.
 */
export async function setTrainingEmailsEnabled(
  enabled: boolean,
  supabase?: AdminClient
): Promise<{ enabled: boolean; updatedAt: string }> {
  return writeSwitch(
    { key: TRAINING_EMAILS_SETTING_KEY, description: TRAINING_EMAILS_SETTING_DESCRIPTION, what: 'training emails', enabled },
    supabase
  )
}

/** The automatic assignment setting as stored. Never throws: a failed read is `readable: false`. */
export async function readTrainingAutoAssignSetting(supabase?: AdminClient): Promise<TrainingAutoAssignSetting> {
  return readSwitch(TRAINING_AUTO_ASSIGN_SETTING_KEY, supabase)
}

/** Whether courses are given to staff automatically. Off when the row is missing or cannot be read. */
export async function getTrainingAutoAssignEnabled(supabase?: AdminClient): Promise<boolean> {
  const setting = await readTrainingAutoAssignSetting(supabase)
  return setting.enabled
}

/**
 * Writes the automatic assignment setting. The caller has already checked `training:publish`.
 * Throws when the write is refused, so the switch never says it moved when it did not.
 */
export async function setTrainingAutoAssignEnabled(
  enabled: boolean,
  supabase?: AdminClient
): Promise<{ enabled: boolean; updatedAt: string }> {
  return writeSwitch(
    {
      key: TRAINING_AUTO_ASSIGN_SETTING_KEY,
      description: TRAINING_AUTO_ASSIGN_SETTING_DESCRIPTION,
      what: 'automatic assignment',
      enabled,
    },
    supabase
  )
}
