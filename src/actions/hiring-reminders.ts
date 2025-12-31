'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { checkUserPermission } from '@/app/actions/rbac'
import { createAdminClient } from '@/lib/supabase/admin'

const SETTINGS_KEY = 'hiring_stage_reminders'

const ThresholdSchema = z.object({
  new: z.number().int().min(1).optional(),
  screening: z.number().int().min(1).optional(),
  screened: z.number().int().min(1).optional(),
  in_conversation: z.number().int().min(1).optional(),
  interview_scheduled: z.number().int().min(1).optional(),
  interviewed: z.number().int().min(1).optional(),
  offer: z.number().int().min(1).optional(),
})

const ReminderConfigSchema = z.object({
  enabled: z.boolean(),
  recipients: z.array(z.string().email()).min(1),
  cooldownDays: z.number().int().min(1).max(365),
  thresholds: ThresholdSchema,
})

export async function updateHiringStageReminderConfigAction(input: z.infer<typeof ReminderConfigSchema>) {
  const allowed = await checkUserPermission('hiring', 'manage')
  if (!allowed) return { success: false, error: 'Unauthorized' }

  const parse = ReminderConfigSchema.safeParse(input)
  if (!parse.success) {
    return { success: false, error: parse.error.issues[0].message }
  }

  const payload = {
    enabled: parse.data.enabled,
    recipients: parse.data.recipients,
    cooldown_days: parse.data.cooldownDays,
    thresholds: parse.data.thresholds,
  }

  try {
    const admin = createAdminClient()
    const { error } = await admin
      .from('system_settings')
      .upsert({ key: SETTINGS_KEY, value: payload }, { onConflict: 'key' })

    if (error) {
      console.error('Failed to update hiring reminder config:', error)
      return { success: false, error: 'Failed to update reminder config' }
    }

    revalidatePath('/hiring/reminders')
    return { success: true }
  } catch (error: any) {
    console.error('Failed to update hiring reminder config:', error)
    return { success: false, error: error.message || 'Failed to update reminder config' }
  }
}
