'use server'

import { checkUserPermission } from './rbac'
import { createAdminClient } from '@/lib/supabase/admin'

export interface MileageDriver {
  id: string
  displayName: string
  drivesOjProjects: boolean
}

/** Active drivers for the trip form. Needs mileage.view, like the rest of Mileage. */
export async function getMileageDrivers(): Promise<{ success?: boolean; error?: string; data?: MileageDriver[] }> {
  const canView = await checkUserPermission('mileage', 'view')
  if (!canView) return { error: 'Insufficient permissions' }

  // Drivers are a handful of rows set up by a script, so one request reads them all.
  const db = createAdminClient()
  const { data, error } = await db
    .from('mileage_drivers')
    .select('id, display_name, drives_oj_projects')
    .eq('is_active', true)
    .order('display_name')

  if (error) {
    console.error('[mileage] failed to load drivers', {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    })
    return { error: 'Failed to load drivers' }
  }

  return {
    success: true,
    data: (data ?? []).map((row) => ({
      id: row.id,
      displayName: row.display_name,
      drivesOjProjects: row.drives_oj_projects,
    })),
  }
}
