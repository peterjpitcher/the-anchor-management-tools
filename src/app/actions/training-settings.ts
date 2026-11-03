'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { logAuditEvent } from '@/app/actions/audit'
import { checkUserPermission } from '@/app/actions/rbac'
import { createClient } from '@/lib/supabase/server'
import {
  readTrainingAutoAssignSetting,
  readTrainingEmailsSetting,
  setTrainingAutoAssignEnabled,
  setTrainingEmailsEnabled,
  type TrainingSwitchSetting,
} from '@/lib/training/settings'
import type { TrainingActionResult } from '@/lib/training/types'

/**
 * The two Training page switches, both off by default: staff reminder emails and the manager
 * training email (`training_emails_enabled`; build contract 0.8 and 5.6), and giving courses to
 * staff automatically (`training_auto_assign_enabled`; owner decision, 3 November 2026). Reading
 * either needs `training:view`; changing either needs `training:publish`, and every change is
 * audited. Permission failures throw, as the rest of the app's actions do. The settings
 * themselves live in src/lib/training/settings.ts.
 */

interface TrainingSwitch {
  enabled: boolean
  /** When the setting was last saved, or null when it has never been set (off). */
  updatedAt: string | null
  /** Whether the signed-in user may change it (`training:publish`). */
  canChange: boolean
}

export type TrainingEmailsSwitch = TrainingSwitch
export type TrainingAutoAssignSwitch = TrainingSwitch

interface SwitchSpec {
  key: 'training_emails_enabled' | 'training_auto_assign_enabled'
  /** For the logs and the refusal: "training emails", "automatic assignment". */
  what: string
  read: () => Promise<TrainingSwitchSetting>
  write: (enabled: boolean) => Promise<unknown>
}

const EMAILS_SWITCH: SwitchSpec = {
  key: 'training_emails_enabled',
  what: 'training emails',
  read: () => readTrainingEmailsSetting(),
  write: (enabled) => setTrainingEmailsEnabled(enabled),
}

const AUTO_ASSIGN_SWITCH: SwitchSpec = {
  key: 'training_auto_assign_enabled',
  what: 'automatic assignment',
  read: () => readTrainingAutoAssignSetting(),
  write: (enabled) => setTrainingAutoAssignEnabled(enabled),
}

const SetSwitchSchema = z.object({ enabled: z.boolean() }).strict()

async function currentUser(): Promise<{ id: string; email: string | null } | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user ? { id: user.id, email: user.email ?? null } : null
}

async function getSwitch(spec: SwitchSpec): Promise<TrainingActionResult<TrainingSwitch>> {
  const user = await currentUser()
  if (!user) throw new Error('Unauthorized')
  if (!(await checkUserPermission('training', 'view', user.id))) throw new Error('Insufficient permissions')

  const setting = await spec.read()
  if (!setting.readable) {
    console.error(`[training] Could not read the ${spec.what} setting:`, setting.error)
    return { error: `The ${spec.what} setting could not be read. Please try again.` }
  }
  const canChange = await checkUserPermission('training', 'publish', user.id)
  return { success: true, data: { enabled: setting.enabled, updatedAt: setting.updatedAt, canChange } }
}

async function setSwitch(spec: SwitchSpec, input: { enabled: boolean }): Promise<TrainingActionResult<{ enabled: boolean }>> {
  const user = await currentUser()
  if (!user) throw new Error('Unauthorized')
  if (!(await checkUserPermission('training', 'publish', user.id))) throw new Error('Insufficient permissions')

  const parsed = SetSwitchSchema.safeParse(input)
  if (!parsed.success) return { error: 'Choose on or off.' }

  const before = await spec.read()
  try {
    await spec.write(parsed.data.enabled)
  } catch (error) {
    console.error(`[training] Could not save the ${spec.what} setting:`, error)
    await logAuditEvent({
      user_id: user.id,
      ...(user.email ? { user_email: user.email } : {}),
      operation_type: 'update',
      resource_type: 'training_settings',
      resource_id: spec.key,
      operation_status: 'failure',
      error_message: error instanceof Error ? error.message : String(error),
      new_values: { enabled: parsed.data.enabled },
    })
    return { error: 'The setting could not be saved. Please try again.' }
  }

  await logAuditEvent({
    user_id: user.id,
    ...(user.email ? { user_email: user.email } : {}),
    operation_type: 'update',
    resource_type: 'training_settings',
    resource_id: spec.key,
    operation_status: 'success',
    old_values: { enabled: before.readable ? before.enabled : null },
    new_values: { enabled: parsed.data.enabled },
  })
  revalidatePath('/employees/training')
  return { success: true, data: { enabled: parsed.data.enabled } }
}

/** training:view. The emails switch as stored, and whether this user may change it. */
export async function getTrainingEmailsSwitch(): Promise<TrainingActionResult<TrainingEmailsSwitch>> {
  return getSwitch(EMAILS_SWITCH)
}

/** training:publish. Switches staff reminder emails and the manager training email on or off. */
export async function setTrainingEmailsSwitch(input: { enabled: boolean }): Promise<TrainingActionResult<{ enabled: boolean }>> {
  return setSwitch(EMAILS_SWITCH, input)
}

/** training:view. The automatic assignment switch as stored, and whether this user may change it. */
export async function getTrainingAutoAssignSwitch(): Promise<TrainingActionResult<TrainingAutoAssignSwitch>> {
  return getSwitch(AUTO_ASSIGN_SWITCH)
}

/**
 * training:publish. Switches automatic assignment on or off. While it is off, nobody is given a
 * course unless a manager assigns it on their Training tab.
 */
export async function setTrainingAutoAssignSwitch(input: { enabled: boolean }): Promise<TrainingActionResult<{ enabled: boolean }>> {
  return setSwitch(AUTO_ASSIGN_SWITCH, input)
}
