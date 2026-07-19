// src/lib/checklists/settings.ts
// Reader for the singleton checklist_settings row (spec 3.8). Uses the service-role admin
// client because the checklist_* tables are deny-all under RLS; the anon client sees nothing.

import { createAdminClient } from '@/lib/supabase/admin'

/** camelCase view of the checklist_settings columns (spec 3.8). */
export interface ChecklistSettings {
  autumnWinterStart: string
  autumnWinterEnd: string
  spotChecksPerDay: number
  defaultGraceMinutes: number
  businessDayStartHour: number
  openLeadMinutes: number
  closeLeadMinutes: number
  mismatchThresholdMinutes: number
  mismatchEarlyThresholdMinutes: number
  moduleEnabled: boolean
  generationEnabled: boolean
  promptsEnabled: boolean
  emailsEnabled: boolean
}

/** Read the singleton settings row (id = 1) and map snake_case → camelCase. */
export async function getChecklistSettings(): Promise<ChecklistSettings> {
  const db = createAdminClient()
  const { data, error } = await db
    .from('checklist_settings')
    .select(
      'autumn_winter_start, autumn_winter_end, spot_checks_per_day, default_grace_minutes, business_day_start_hour, open_lead_minutes, close_lead_minutes, mismatch_threshold_minutes, mismatch_early_threshold_minutes, module_enabled, generation_enabled, prompts_enabled, emails_enabled',
    )
    .eq('id', 1)
    .single()

  if (error) throw error

  return {
    autumnWinterStart: data.autumn_winter_start,
    autumnWinterEnd: data.autumn_winter_end,
    spotChecksPerDay: data.spot_checks_per_day,
    defaultGraceMinutes: data.default_grace_minutes,
    businessDayStartHour: data.business_day_start_hour,
    openLeadMinutes: data.open_lead_minutes,
    closeLeadMinutes: data.close_lead_minutes,
    mismatchThresholdMinutes: data.mismatch_threshold_minutes,
    mismatchEarlyThresholdMinutes: data.mismatch_early_threshold_minutes,
    moduleEnabled: data.module_enabled,
    generationEnabled: data.generation_enabled,
    promptsEnabled: data.prompts_enabled,
    emailsEnabled: data.emails_enabled,
  }
}
