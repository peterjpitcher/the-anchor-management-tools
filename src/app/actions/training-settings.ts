'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { logAuditEvent } from '@/app/actions/audit'
import { checkUserPermission } from '@/app/actions/rbac'
import { createClient } from '@/lib/supabase/server'
import { readTrainingEmailsSetting, setTrainingEmailsEnabled } from '@/lib/training/settings'
import type { TrainingActionResult } from '@/lib/training/types'

/**
 * The Training page switch for staff reminder emails and the manager training email
 * (`training_emails_enabled`, off by default; build contract 0.8 and 5.6). Reading it needs
 * `training:view`; changing it needs `training:publish`. Permission failures throw, as the rest
 * of the app's actions do. The setting itself lives in src/lib/training/settings.ts.
 */

export interface TrainingEmailsSwitch {
  enabled: boolean
  /** When the setting was last saved, or null when it has never been set (off). */
  updatedAt: string | null
  /** Whether the signed-in user may change it (`training:publish`). */
  canChange: boolean
}

const SetSwitchSchema = z.object({ enabled: z.boolean() }).strict()

async function currentUser(): Promise<{ id: string; email: string | null } | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user ? { id: user.id, email: user.email ?? null } : null
}

/** training:view. The switch as stored, and whether this user may change it. */
export async function getTrainingEmailsSwitch(): Promise<TrainingActionResult<TrainingEmailsSwitch>> {
  const user = await currentUser()
  if (!user) throw new Error('Unauthorized')
  if (!(await checkUserPermission('training', 'view', user.id))) throw new Error('Insufficient permissions')

  const setting = await readTrainingEmailsSetting()
  if (!setting.readable) {
    console.error('[training] Could not read the training emails setting:', setting.error)
    return { error: 'The training emails setting could not be read. Please try again.' }
  }
  const canChange = await checkUserPermission('training', 'publish', user.id)
  return { success: true, data: { enabled: setting.enabled, updatedAt: setting.updatedAt, canChange } }
}

/** training:publish. Switches staff reminder emails and the manager training email on or off. */
export async function setTrainingEmailsSwitch(input: { enabled: boolean }): Promise<TrainingActionResult<{ enabled: boolean }>> {
  const user = await currentUser()
  if (!user) throw new Error('Unauthorized')
  if (!(await checkUserPermission('training', 'publish', user.id))) throw new Error('Insufficient permissions')

  const parsed = SetSwitchSchema.safeParse(input)
  if (!parsed.success) return { error: 'Choose on or off.' }

  const before = await readTrainingEmailsSetting()
  try {
    await setTrainingEmailsEnabled(parsed.data.enabled)
  } catch (error) {
    console.error('[training] Could not save the training emails setting:', error)
    await logAuditEvent({
      user_id: user.id,
      ...(user.email ? { user_email: user.email } : {}),
      operation_type: 'update',
      resource_type: 'training_settings',
      resource_id: 'training_emails_enabled',
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
    resource_id: 'training_emails_enabled',
    operation_status: 'success',
    old_values: { enabled: before.readable ? before.enabled : null },
    new_values: { enabled: parsed.data.enabled },
  })
  revalidatePath('/employees/training')
  return { success: true, data: { enabled: parsed.data.enabled } }
}
