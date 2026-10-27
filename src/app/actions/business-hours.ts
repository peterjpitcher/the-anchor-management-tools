'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import { logAuditEvent } from '@/app/actions/audit'
import type { BusinessHours, SpecialHours, ServiceStatus, ServiceStatusOverride } from '@/types/business-hours'
import type { User as SupabaseUser } from '@supabase/supabase-js'
import { BusinessHoursService } from '@/services/business-hours'
import { getErrorMessage } from '@/lib/errors';
import { getActiveVersion, getVersionRows, listVersions } from '@/lib/business-hours/effective'
import { getTodayIsoDate, isValidIsoDate, shiftIsoDate } from '@/lib/dateUtils'
import { settleWrite } from '@/lib/supabase/settle-write'
import { checkHoursImpact, WEEKLY_HOURS_HORIZON_DAYS, type HoursImpact } from '@/services/hours-impact'

/**
 * What a save returns about the bookings it left outside the hours (review BK-076). Never fails the
 * save: the hours are already stored, so a check that could not run says so instead.
 */
type HoursImpactFields = { hoursImpact?: HoursImpact; hoursImpactError?: string }

async function hoursImpactFields(dates: Array<string | null | undefined>): Promise<HoursImpactFields> {
  const real = dates.filter((date): date is string => typeof date === 'string' && isValidIsoDate(date)).sort()
  if (real.length === 0) return {}
  const result = await checkHoursImpact(real[0], real[real.length - 1])
  return 'impact' in result ? { hoursImpact: result.impact } : { hoursImpactError: result.impactError }
}

/** Weekly hours apply from a date onwards, so the check runs a year ahead from it (or from today). */
async function weeklyHoursImpactFields(effectiveFrom?: string | null): Promise<HoursImpactFields> {
  const today = getTodayIsoDate()
  const from = effectiveFrom && isValidIsoDate(effectiveFrom) && effectiveFrom > today ? effectiveFrom : today
  return hoursImpactFields([from, shiftIsoDate(from, WEEKLY_HOURS_HORIZON_DAYS)])
}

type SettingsManagePermissionResult =
  | { error: string }
  | { user: SupabaseUser; admin: ReturnType<typeof createAdminClient> }

async function requireSettingsManagePermission(): Promise<SettingsManagePermissionResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Not authenticated' }
  }

  const admin = createAdminClient()
  const { data, error } = await admin.rpc('user_has_permission', {
    p_user_id: user.id,
    p_module_name: 'settings',
    p_action: 'manage',
  })

  if (error) {
    console.error('Settings manage permission check failed:', error)
    return { error: 'Failed to verify permissions' }
  }

  if (data !== true) {
    return { error: 'Insufficient permissions to manage business hours' }
  }

  return { user, admin }
}

export async function getBusinessHours(): Promise<{ data?: BusinessHours[], error?: string }> {
  try {
    const permission = await requireSettingsManagePermission()
    if ('error' in permission) {
      return { error: permission.error }
    }

    const data = await BusinessHoursService.getBusinessHours()
    return { data }
  } catch (error: unknown) {
    console.error('Error fetching business hours:', error)
    return { error: getErrorMessage(error) }
  }
}

export async function getBusinessHoursByDay(dayOfWeek: number): Promise<{ data?: BusinessHours, error?: string }> {
  try {
    const data = await BusinessHoursService.getBusinessHoursByDay(dayOfWeek)
    if (!data) return { error: 'Business hours not found for day' }
    return { data }
  } catch (error: unknown) {
    console.error('Error fetching business hours for day:', error)
    return { error: getErrorMessage(error) }
  }
}

export async function updateBusinessHours(formData: FormData) {
  try {
    const permission = await requireSettingsManagePermission()
    if ('error' in permission) {
      return { error: permission.error }
    }

    const { user } = permission
    const result = await BusinessHoursService.updateBusinessHours(formData)

    await logAuditEvent({
      user_id: user.id,
      ...(user.email && { user_email: user.email }),
      operation_type: 'update',
      resource_type: 'settings',
      resource_id: 'business_hours',
      operation_status: 'success',
      new_values: { updated_days: result.updatedCount },
    })

    revalidatePath('/settings/business-hours')
    revalidatePath('/api/business/hours')
    revalidatePath('/api/business-hours')

    return { success: true, ...(await weeklyHoursImpactFields()) }
  } catch (error: unknown) {
    console.error('Error updating business hours:', error)
    return { error: getErrorMessage(error) }
  }
}

async function getServiceStatuses(serviceCodes?: string[]): Promise<{ data?: ServiceStatus[], error?: string }> {
  try {
    const permission = await requireSettingsManagePermission()
    if ('error' in permission) {
      return { error: permission.error }
    }

    const data = await BusinessHoursService.getServiceStatuses(serviceCodes)
    return { data }
  } catch (error: unknown) {
    console.error('Error fetching service statuses:', error)
    return { error: getErrorMessage(error) }
  }
}

export async function getServiceStatusOverrides(
  serviceCode: string,
  startDate?: string,
  endDate?: string
): Promise<{ data?: ServiceStatusOverride[], error?: string }> {
  try {
    const permission = await requireSettingsManagePermission()
    if ('error' in permission) {
      return { error: permission.error }
    }

    const data = await BusinessHoursService.getServiceStatusOverrides(serviceCode, startDate, endDate)
    return { data }
  } catch (error: unknown) {
    console.error('Error fetching service status overrides:', error)
    return { error: getErrorMessage(error) }
  }
}

async function createServiceStatusOverride(
  serviceCode: string,
  formData: FormData
) {
  try {
    const permission = await requireSettingsManagePermission()
    if ('error' in permission) {
      return { error: permission.error }
    }

    const { user } = permission
    const { data, input } = await BusinessHoursService.createServiceStatusOverride(serviceCode, formData, user.id)

    await logAuditEvent({
      user_id: user.id,
      ...(user.email && { user_email: user.email }),
      operation_type: 'create',
      resource_type: 'service_status_override',
      resource_id: data.id,
      operation_status: 'success',
      new_values: {
        service_code: serviceCode,
        start_date: input?.start_date,
        end_date: input?.end_date,
        is_enabled: input?.is_enabled,
      },
    })

    revalidatePath('/settings/business-hours')
    revalidatePath('/api/business/hours')
    revalidatePath('/api/business-hours')

    return { success: true, data }
  } catch (error: unknown) {
    console.error('Error creating service status override:', error)
    return { error: getErrorMessage(error) }
  }
}

async function deleteServiceStatusOverride(
  overrideId: string
) {
  try {
    const permission = await requireSettingsManagePermission()
    if ('error' in permission) {
      return { error: permission.error }
    }

    const { user } = permission
    const override = await BusinessHoursService.deleteServiceStatusOverride(overrideId)

    await logAuditEvent({
      user_id: user.id,
      ...(user.email && { user_email: user.email }),
      operation_type: 'delete',
      resource_type: 'service_status_override',
      resource_id: overrideId,
      operation_status: 'success',
      old_values: {
        service_code: override.service_code,
        start_date: override.start_date,
        end_date: override.end_date,
        is_enabled: override.is_enabled,
      },
    })

    revalidatePath('/settings/business-hours')
    revalidatePath('/api/business/hours')
    revalidatePath('/api/business-hours')

    return { success: true }
  } catch (error: unknown) {
    console.error('Error deleting service status override:', error)
    return { error: getErrorMessage(error) }
  }
}

async function updateServiceStatus(
  serviceCode: string,
  payload: { is_enabled: boolean; message?: string | null }
) {
  try {
    const permission = await requireSettingsManagePermission()
    if ('error' in permission) {
      return { error: permission.error }
    }

    const { user } = permission
    const { updated, existing } = await BusinessHoursService.updateServiceStatus(serviceCode, payload, user.id)

    await logAuditEvent({
      user_id: user.id,
      ...(user.email && { user_email: user.email }),
      operation_type: 'update',
      resource_type: 'service_status',
      resource_id: serviceCode,
      operation_status: 'success',
      old_values: { is_enabled: existing?.is_enabled, message: existing?.message },
      new_values: { is_enabled: updated.is_enabled, message: updated.message },
    })

    revalidatePath('/settings/business-hours')
    revalidatePath('/api/business/hours')
    revalidatePath('/api/business-hours')

    return { success: true, data: updated }
  } catch (error: unknown) {
    console.error('Error updating service status:', error)
    return { error: getErrorMessage(error) }
  }
}

export async function getSpecialHours(startDate?: string, endDate?: string): Promise<{ data?: SpecialHours[], error?: string }> {
  try {
    const permission = await requireSettingsManagePermission()
    if ('error' in permission) {
      return { error: permission.error }
    }

    const data = await BusinessHoursService.getSpecialHours(startDate, endDate)
    return { data }
  } catch (error: unknown) {
    console.error('Error fetching special hours:', error)
    return { error: getErrorMessage(error) }
  }
}

export async function createSpecialHours(formData: FormData) {
  try {
    const permission = await requireSettingsManagePermission()
    if ('error' in permission) {
      return { error: permission.error }
    }

    const { user } = permission
    const { data: createdRecords, datesToCreate } = await BusinessHoursService.createSpecialHours(formData)

    await logAuditEvent({
      user_id: user.id,
      ...(user.email && { user_email: user.email }),
      operation_type: 'create',
      resource_type: 'settings',
      resource_id: 'special_hours',
      operation_status: 'success',
      new_values: {
        created_dates: datesToCreate,
        records: createdRecords
      }
    })

    revalidatePath('/settings/business-hours')
    revalidatePath('/api/business/hours')
    revalidatePath('/api/business-hours')
    
    return { success: true, data: createdRecords, ...(await hoursImpactFields(datesToCreate)) }
  } catch (error: unknown) {
    console.error('Error creating special hours:', error)
    return { error: getErrorMessage(error) }
  }
}

export async function updateSpecialHours(id: string, formData: FormData) {
  try {
    const permission = await requireSettingsManagePermission()
    if ('error' in permission) {
      return { error: permission.error }
    }

    const { user } = permission
    const { updated, oldData } = await BusinessHoursService.updateSpecialHours(id, formData)

    await logAuditEvent({
      user_id: user.id,
      ...(user.email && { user_email: user.email }),
      operation_type: 'update',
      resource_type: 'settings',
      resource_id: 'special_hours',
      operation_status: 'success',
      old_values: oldData,
      new_values: updated
    })

    revalidatePath('/settings/business-hours')
    revalidatePath('/api/business/hours')
    revalidatePath('/api/business-hours')
    
    return {
      success: true,
      data: updated,
      ...(await hoursImpactFields([
        (updated as { date?: string } | null)?.date,
        (oldData as { date?: string } | null)?.date,
      ])),
    }
  } catch (error: unknown) {
    console.error('Error updating special hours:', error)
    return { error: getErrorMessage(error) }
  }
}

export async function deleteSpecialHours(id: string) {
  try {
    const permission = await requireSettingsManagePermission()
    if ('error' in permission) {
      return { error: permission.error }
    }

    const { user } = permission
    const oldData = await BusinessHoursService.deleteSpecialHours(id)

    await logAuditEvent({
      user_id: user.id,
      ...(user.email && { user_email: user.email }),
      operation_type: 'delete',
      resource_type: 'settings',
      resource_id: 'special_hours',
      operation_status: 'success',
      old_values: oldData
    })

    revalidatePath('/settings/business-hours')
    revalidatePath('/api/business/hours')
    revalidatePath('/api/business-hours')
    
    // The day goes back to its weekly hours, which may be shorter than the exception was.
    return { success: true, ...(await hoursImpactFields([(oldData as { date?: string } | null)?.date])) }
  } catch (error: unknown) {
    console.error('Error deleting special hours:', error)
    return { error: getErrorMessage(error) }
  }
}

// ---------------------------------------------------------------------------
// Scheduled opening-hours versions
//
// A version is a dated set of seven weekday rows. Drafts are invisible to
// resolution, so a schedule can be prepared and checked before it affects any
// booking. Publishing is a single transactional RPC that refuses an incomplete
// week.
// ---------------------------------------------------------------------------

export interface HoursVersionSummary {
  id: string
  effectiveFrom: string
  status: 'draft' | 'published' | 'withdrawn'
  label: string | null
  isBaseline: boolean
  /** True for the version currently governing today. */
  isActive: boolean
  publishedAt: string | null
}

export async function listHoursVersions(): Promise<{ data?: HoursVersionSummary[]; error?: string }> {
  try {
    const permission = await requireSettingsManagePermission()
    if ('error' in permission) return { error: permission.error }

    const today = getTodayIsoDate()
    const [versions, active] = await Promise.all([
      listVersions(permission.admin),
      getActiveVersion(today, permission.admin),
    ])

    return {
      data: versions.map(v => ({
        id: v.id,
        effectiveFrom: v.effective_from,
        status: v.status,
        label: v.label,
        isBaseline: v.is_baseline,
        isActive: v.id === active?.id,
        publishedAt: v.published_at,
      })),
    }
  } catch (error: unknown) {
    console.error('Error listing opening-hours versions:', error)
    return { error: getErrorMessage(error) }
  }
}

export async function getHoursVersionRows(
  versionId: string,
): Promise<{ data?: BusinessHours[]; error?: string }> {
  try {
    const permission = await requireSettingsManagePermission()
    if ('error' in permission) return { error: permission.error }
    return { data: await getVersionRows(versionId, permission.admin) }
  } catch (error: unknown) {
    console.error('Error loading opening-hours version:', error)
    return { error: getErrorMessage(error) }
  }
}

/**
 * Start a scheduled change. The draft is cloned from the version in force the day
 * BEFORE it starts, not from today's, so a later change cannot silently revert an
 * earlier one that has already been scheduled.
 */
export async function createScheduledHoursVersion(
  effectiveFrom: string,
  label?: string,
): Promise<{ data?: { id: string }; error?: string }> {
  try {
    const permission = await requireSettingsManagePermission()
    if ('error' in permission) return { error: permission.error }
    const { user, admin } = permission

    if (!isValidIsoDate(effectiveFrom)) {
      return { error: 'Choose a real date in YYYY-MM-DD form.' }
    }
    if (effectiveFrom <= getTodayIsoDate()) {
      return { error: 'A scheduled change has to start on a future date. To change today, edit the current hours.' }
    }

    const { data: clash } = await admin
      .from('business_hours_versions')
      .select('id')
      .eq('effective_from', effectiveFrom)
      .neq('status', 'withdrawn')
      .maybeSingle()
    if (clash) {
      return { error: 'There is already a schedule starting on that date. Edit that one instead of creating a second.' }
    }

    const dayBefore = shiftIsoDate(effectiveFrom, -1)
    if (!dayBefore) return { error: 'Choose a real date in YYYY-MM-DD form.' }
    const source = await getActiveVersion(dayBefore, admin)
    if (!source) {
      return { error: 'Could not work out which hours apply the day before that date.' }
    }
    const sourceRows = await getVersionRows(source.id, admin)
    if (sourceRows.length !== 7) {
      return { error: 'The schedule it would be based on is incomplete, so it cannot be copied.' }
    }

    const { data: created, error: createError } = await admin
      .from('business_hours_versions')
      .insert({
        effective_from: effectiveFrom,
        status: 'draft',
        label: label?.trim() || null,
        created_by: user.id,
      })
      .select('id')
      .single()
    if (createError) throw createError

    const { error: rowsError } = await admin.from('business_hours').insert(
      sourceRows.map(row => ({
        version_id: created.id,
        day_of_week: row.day_of_week,
        opens: row.opens,
        closes: row.closes,
        kitchen_opens: row.kitchen_opens,
        kitchen_closes: row.kitchen_closes,
        is_closed: row.is_closed,
        is_kitchen_closed: row.is_kitchen_closed,
        schedule_config: row.schedule_config,
      })),
    )
    if (rowsError) {
      // Leave no half-built draft behind for someone to publish by accident.
      await settleWrite(admin.from('business_hours_versions').delete().eq('id', created.id), {
        table: 'business_hours_versions',
        what: 'Removing the half-built draft version',
        ids: { versionId: created.id },
        note: 'a rollback after its rows failed to save, so the draft may be left behind',
      })
      throw rowsError
    }

    await logAuditEvent({
      user_id: user.id,
      ...(user.email && { user_email: user.email }),
      operation_type: 'create',
      resource_type: 'settings',
      resource_id: `business_hours_version:${created.id}`,
      operation_status: 'success',
      new_values: { effective_from: effectiveFrom, copied_from: source.effective_from },
    })

    revalidatePath('/settings/business-hours')
    return { data: { id: created.id } }
  } catch (error: unknown) {
    console.error('Error creating scheduled hours version:', error)
    return { error: getErrorMessage(error) }
  }
}

export async function saveHoursVersionDraft(
  versionId: string,
  formData: FormData,
): Promise<{ success?: boolean; error?: string }> {
  try {
    const permission = await requireSettingsManagePermission()
    if ('error' in permission) return { error: permission.error }
    const { user, admin } = permission

    const { data: version } = await admin
      .from('business_hours_versions')
      .select('id, status')
      .eq('id', versionId)
      .maybeSingle()
    if (!version) return { error: 'That schedule no longer exists.' }
    if (version.status !== 'draft') {
      return { error: 'Only a draft can be edited. Published hours are changed by scheduling a new version.' }
    }

    const result = await BusinessHoursService.updateVersionRows(versionId, formData)

    await logAuditEvent({
      user_id: user.id,
      ...(user.email && { user_email: user.email }),
      operation_type: 'update',
      resource_type: 'settings',
      resource_id: `business_hours_version:${versionId}`,
      operation_status: 'success',
      new_values: { updated_days: result.updatedCount },
    })

    revalidatePath('/settings/business-hours')
    return { success: true }
  } catch (error: unknown) {
    console.error('Error saving scheduled hours draft:', error)
    return { error: getErrorMessage(error) }
  }
}

export async function publishHoursVersion(
  versionId: string,
): Promise<{ success?: boolean; error?: string } & HoursImpactFields> {
  try {
    const permission = await requireSettingsManagePermission()
    if ('error' in permission) return { error: permission.error }
    const { user, admin } = permission

    const { error } = await admin.rpc('publish_business_hours_version', {
      p_version_id: versionId,
      p_actor: user.id,
    })
    if (error) return { error: error.message }

    await logAuditEvent({
      user_id: user.id,
      ...(user.email && { user_email: user.email }),
      operation_type: 'update',
      resource_type: 'settings',
      resource_id: `business_hours_version:${versionId}`,
      operation_status: 'success',
      new_values: { status: 'published' },
    })

    revalidatePath('/settings/business-hours')
    revalidatePath('/api/business/hours')
    revalidatePath('/api/business-hours')
    revalidatePath('/api/business-hours')

    // The new hours apply from the version's date: check what is booked from then on (BK-076).
    const { data: version } = await admin
      .from('business_hours_versions')
      .select('effective_from')
      .eq('id', versionId)
      .maybeSingle()
    return { success: true, ...(await weeklyHoursImpactFields((version as { effective_from?: string } | null)?.effective_from)) }
  } catch (error: unknown) {
    console.error('Error publishing hours version:', error)
    return { error: getErrorMessage(error) }
  }
}

export async function withdrawHoursVersion(
  versionId: string,
): Promise<{ success?: boolean; error?: string }> {
  try {
    const permission = await requireSettingsManagePermission()
    if ('error' in permission) return { error: permission.error }
    const { user, admin } = permission

    // The database refuses to withdraw a version whose date has passed, so this
    // does not need to re-check it: the guard is where the mutation happens.
    const { error } = await admin
      .from('business_hours_versions')
      .update({ status: 'withdrawn' })
      .eq('id', versionId)
    if (error) return { error: error.message }

    await logAuditEvent({
      user_id: user.id,
      ...(user.email && { user_email: user.email }),
      operation_type: 'update',
      resource_type: 'settings',
      resource_id: `business_hours_version:${versionId}`,
      operation_status: 'success',
      new_values: { status: 'withdrawn' },
    })

    revalidatePath('/settings/business-hours')
    revalidatePath('/api/business/hours')
    revalidatePath('/api/business-hours')
    revalidatePath('/api/business-hours')
    return { success: true }
  } catch (error: unknown) {
    console.error('Error withdrawing hours version:', error)
    return { error: getErrorMessage(error) }
  }
}

/**
 * The manager has checked the bookings an hours change left outside the hours (review BK-076):
 * recorded on the audit log with the bookings listed. Contacting the guests is done from each
 * booking, or from the day's guest list.
 */
export async function acknowledgeHoursImpact(input: {
  from: string
  to: string
  items: Array<{ kind: string; id: string; date: string; reason: string }>
}): Promise<{ success?: boolean; error?: string }> {
  const permission = await requireSettingsManagePermission()
  if ('error' in permission) return { error: permission.error }
  if (!isValidIsoDate(input.from) || !isValidIsoDate(input.to) || !Array.isArray(input.items)) {
    return { error: 'Nothing was recorded: the list was not valid.' }
  }
  const items = input.items.slice(0, 500).map((item) => ({
    kind: String(item.kind).slice(0, 20),
    id: String(item.id).slice(0, 64),
    date: String(item.date).slice(0, 10),
    reason: String(item.reason).slice(0, 30),
  }))
  await logAuditEvent({
    user_id: permission.user.id,
    ...(permission.user.email && { user_email: permission.user.email }),
    operation_type: 'update',
    resource_type: 'settings',
    resource_id: 'business_hours_impact',
    operation_status: 'success',
    additional_info: { action: 'hours_change_bookings_checked', from: input.from, to: input.to, count: items.length, items },
  })
  return { success: true }
}
