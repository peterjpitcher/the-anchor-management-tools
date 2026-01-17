'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import { logAuditEvent } from '@/app/actions/audit'
import type { BusinessHours, SpecialHours, ServiceStatus, ServiceStatusOverride } from '@/types/business-hours'
import type { User as SupabaseUser } from '@supabase/supabase-js'
import { BusinessHoursService } from '@/services/business-hours'

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
  } catch (error: any) {
    console.error('Error fetching business hours:', error)
    return { error: error.message || 'Failed to fetch business hours' }
  }
}

export async function getBusinessHoursByDay(dayOfWeek: number): Promise<{ data?: BusinessHours, error?: string }> {
  try {
    const data = await BusinessHoursService.getBusinessHoursByDay(dayOfWeek)
    if (!data) return { error: 'Business hours not found for day' }
    return { data }
  } catch (error: any) {
    console.error('Error fetching business hours for day:', error)
    return { error: error.message || 'Failed to fetch business hours' }
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

    return { success: true }
  } catch (error: any) {
    console.error('Error updating business hours:', error)
    return { error: error.message || 'Failed to update business hours' }
  }
}

export async function getServiceStatuses(serviceCodes?: string[]): Promise<{ data?: ServiceStatus[], error?: string }> {
  try {
    const permission = await requireSettingsManagePermission()
    if ('error' in permission) {
      return { error: permission.error }
    }

    const data = await BusinessHoursService.getServiceStatuses(serviceCodes)
    return { data }
  } catch (error: any) {
    console.error('Error fetching service statuses:', error)
    return { error: error.message || 'Failed to fetch service statuses' }
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
  } catch (error: any) {
    console.error('Error fetching service status overrides:', error)
    return { error: error.message || 'Failed to fetch service status overrides' }
  }
}

export async function createServiceStatusOverride(
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

    return { success: true, data }
  } catch (error: any) {
    console.error('Error creating service status override:', error)
    return { error: error.message || 'Failed to create service status override' }
  }
}

export async function deleteServiceStatusOverride(
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

    return { success: true }
  } catch (error: any) {
    console.error('Error deleting service status override:', error)
    return { error: error.message || 'Failed to delete service status override' }
  }
}

export async function updateServiceStatus(
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

    return { success: true, data: updated }
  } catch (error: any) {
    console.error('Error updating service status:', error)
    return { error: error.message || 'Failed to update service status' }
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
  } catch (error: any) {
    console.error('Error fetching special hours:', error)
    return { error: error.message || 'Failed to fetch special hours' }
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
    
    return { success: true, data: createdRecords }
  } catch (error: any) {
    console.error('Error creating special hours:', error)
    return { error: error.message || 'Failed to create special hours' }
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
    
    return { success: true, data: updated }
  } catch (error: any) {
    console.error('Error updating special hours:', error)
    return { error: error.message || 'Failed to update special hours' }
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
    
    return { success: true }
  } catch (error: any) {
    console.error('Error deleting special hours:', error)
    return { error: error.message || 'Failed to delete special hours' }
  }
}
