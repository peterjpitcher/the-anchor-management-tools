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
      p_resource: 'employees',
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
