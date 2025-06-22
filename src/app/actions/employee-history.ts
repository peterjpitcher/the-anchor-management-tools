'use server'

import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

const getEmployeeHistorySchema = z.object({
  employeeId: z.string().uuid(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional()
})

export async function getEmployeeChangesSummary(employeeId: string, startDate?: string, endDate?: string) {
  try {
    const supabase = await createClient()
    
    // Get the authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return { error: 'Unauthorized' }
    }

    // Check permission
    const { data: hasPermission } = await supabase.rpc('user_has_permission', {
      p_user_id: user.id,
      p_resource: 'employee_history',
      p_action: 'view'
    })

    if (!hasPermission) {
      return { error: 'Insufficient permissions to view employee history' }
    }

    // Validate input
    const validation = getEmployeeHistorySchema.safeParse({ employeeId, startDate, endDate })
    if (!validation.success) {
      return { error: 'Invalid parameters' }
    }

    // Get changes summary
    const { data, error } = await supabase.rpc('get_employee_changes_summary', {
      p_employee_id: employeeId,
      p_start_date: startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      p_end_date: endDate || new Date().toISOString()
    })

    if (error) {
      console.error('Error fetching employee changes:', error)
      return { error: 'Failed to fetch employee changes' }
    }

    return { success: true, data }
  } catch (error) {
    console.error('Unexpected error:', error)
    return { error: 'An unexpected error occurred' }
  }
}

export async function restoreEmployeeVersion(employeeId: string, versionNumber: number) {
  try {
    const supabase = await createClient()
    
    // Get the authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return { error: 'Unauthorized' }
    }

    // The database function will check permissions
    const { data, error } = await supabase.rpc('restore_employee_version', {
      p_employee_id: employeeId,
      p_version_number: versionNumber,
      p_user_id: user.id
    })

    if (error) {
      console.error('Error restoring employee version:', error)
      return { error: error.message || 'Failed to restore employee version' }
    }

    return { success: true, data }
  } catch (error) {
    console.error('Unexpected error:', error)
    return { error: 'An unexpected error occurred' }
  }
}

export async function compareEmployeeVersions(employeeId: string, version1: number, version2: number) {
  try {
    const supabase = await createClient()
    
    // Get the authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return { error: 'Unauthorized' }
    }

    // Check permission
    const { data: hasPermission } = await supabase.rpc('user_has_permission', {
      p_user_id: user.id,
      p_resource: 'employee_history',
      p_action: 'view'
    })

    if (!hasPermission) {
      return { error: 'Insufficient permissions to view employee history' }
    }

    // Compare versions
    const { data, error } = await supabase.rpc('compare_employee_versions', {
      p_employee_id: employeeId,
      p_version1: version1,
      p_version2: version2
    })

    if (error) {
      console.error('Error comparing versions:', error)
      return { error: 'Failed to compare employee versions' }
    }

    return { success: true, data }
  } catch (error) {
    console.error('Unexpected error:', error)
    return { error: 'An unexpected error occurred' }
  }
}